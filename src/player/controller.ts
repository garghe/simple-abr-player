import shaka from 'shaka-player';
import { parseHlsCues, type HlsCue } from '../scte/hls-cues';
import { ScteMonitor, isScteScheme } from '../scte/monitor';
import { detectProxy, fromProxyUrl, isProxied, routeUri, type ProxyInfo, type ProxyMode } from './proxy';

export type StreamFormat = 'DASH' | 'HLS' | 'unknown';

export interface LoadOptions {
  url: string;
  proxyMode: ProxyMode;
  headers: Record<string, string>;
  lowLatency: boolean;
  startTime?: number;
}

export interface NetworkEntry {
  id: number;
  at: Date;
  type: string;
  uri: string;
  status: number | null;
  bytes: number;
  ms: number | null;
  proxied: boolean;
  fromCache?: boolean;
  error?: string;
}

export interface LogEntry {
  at: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface CapturedDocument {
  uri: string;
  kind: 'MPD' | 'Master playlist' | 'Media playlist' | 'Manifest';
  text: string;
  at: Date;
  size: number;
}

export interface Sample {
  t: number;
  estimatedBandwidth: number;
  streamBandwidth: number;
  bufferAhead: number;
}

type Handler = (e: Event & { detail?: unknown }) => void;

const REQUEST_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(shaka.net.NetworkingEngine.RequestType).map(([k, v]) => [v as number, k.toLowerCase()]),
);
const ADVANCED_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(shaka.net.NetworkingEngine.AdvancedRequestType).map(([k, v]) => [
    v as number,
    k.toLowerCase().replace(/_/g, ' '),
  ]),
);

const MAX_NETWORK = 400;
const MAX_LOG = 300;
const MAX_SAMPLES = 180;

/** shaka.util.Error codes that indicate a fetch failed (CORS shows up as these). */
const NETWORK_ERROR_CODES = new Set([1001, 1002, 1003]);

export function describeShakaError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as shaka.util.Error;
    const name =
      Object.entries(shaka.util.Error.Code).find(([, v]) => v === e.code)?.[0] ?? 'UNKNOWN';
    const data = Array.isArray(e.data) ? e.data.filter((d) => typeof d === 'string' || typeof d === 'number') : [];
    return `Shaka error ${e.code} ${name}${data.length ? ` (${data.slice(0, 3).join(', ')})` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps Shaka Player: loading, network filters (custom headers, CORS proxy
 * rewrite), network/manifest capture, SCTE-35 collection and a stats
 * time-series. The UI only talks to this class.
 */
export class PlayerController extends EventTarget {
  readonly player: shaka.Player;
  readonly scte = new ScteMonitor();
  readonly network: NetworkEntry[] = [];
  readonly log: LogEntry[] = [];
  readonly documents = new Map<string, CapturedDocument>();
  readonly samples: Sample[] = [];

  proxy: ProxyInfo | null = null;
  usingProxy = false;
  format: StreamFormat = 'unknown';
  loadedUrl: string | null = null;

  private options: LoadOptions | null = null;
  private warnedSegmentHosts = new Set<string>();
  private netSeq = 0;
  private tickTimer: number | undefined;

  constructor(
    readonly video: HTMLVideoElement,
    container?: HTMLElement,
  ) {
    super();
    shaka.polyfill.installAll();
    this.player = new shaka.Player();
    // With a container Shaka renders subtitles as DOM (UITextDisplayer), which
    // can be styled and moved clear of the control bar.
    if (container) this.player.setVideoContainer(container);
    this.scte.setHlsResolver((cue) => this.resolveHlsCueTime(cue));
    this.installFilters();
    this.installEvents();
  }

  async init(): Promise<void> {
    await this.player.attach(this.video);
    this.proxy = await detectProxy();
    this.info(`Shaka Player ${shaka.Player.version} ready · ${this.proxyDescription()}`);
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
  }

  get proxyAvailable(): boolean {
    return this.proxy !== null;
  }

  proxyDescription(): string {
    if (!this.proxy) return 'no CORS proxy on this server';
    const where = this.proxy.kind === 'cloudflare' ? 'Cloudflare CORS proxy' : 'local CORS proxy';
    return this.proxy.segments
      ? `${where} available (manifests and segments)`
      : `${where} available for manifests/playlists only; segments always load directly`;
  }

  static isBrowserSupported(): boolean {
    return shaka.Player.isBrowserSupported();
  }

  // ---------------------------------------------------------------- loading

  async load(options: LoadOptions): Promise<void> {
    this.options = options;
    this.resetSession();
    this.player.configure({
      streaming: { lowLatencyMode: options.lowLatency },
      // Surface every emsg box (HLS fMP4 and DASH without InbandEventStream too).
      mediaSource: { dispatchAllEmsgBoxes: true },
    });
    const wantProxy = options.proxyMode === 'always' && this.proxyAvailable;
    if (options.proxyMode === 'always' && !this.proxyAvailable) {
      this.warn('Proxy mode is "always" but the local proxy is not available (static build?). Loading directly.');
    }
    try {
      await this.attempt(options, wantProxy);
    } catch (err) {
      const code = (err as shaka.util.Error)?.code;
      const canRetry =
        !wantProxy && options.proxyMode === 'auto' && this.proxyAvailable && NETWORK_ERROR_CODES.has(code);
      if (!canRetry) throw err;
      this.warn(`${describeShakaError(err)} — retrying through the local CORS proxy`);
      this.resetSession();
      await this.attempt(options, true);
    }
  }

  private async attempt(options: LoadOptions, proxy: boolean) {
    this.usingProxy = proxy;
    // CORS failures are not transient: when a proxy retry is available, fail
    // the direct manifest request fast instead of retrying with backoff.
    const fastFail = !proxy && options.proxyMode === 'auto' && this.proxyAvailable;
    this.player.configure('manifest.retryParameters.maxAttempts', fastFail ? 1 : 2);
    this.info(`Loading ${options.url}${proxy ? ' via local proxy' : ''}`);
    const t0 = performance.now();
    await this.player.load(options.url, options.startTime ?? null);
    this.loadedUrl = options.url;
    const type = this.player.getManifestType();
    this.format = type === 'DASH' ? 'DASH' : type === 'HLS' ? 'HLS' : 'unknown';
    this.info(`Loaded ${this.format} ${this.player.isLive() ? 'live' : 'VOD'} stream in ${Math.round(performance.now() - t0)} ms`);
    this.emit('loaded');
  }

  async unload(): Promise<void> {
    await this.player.unload();
    this.resetSession();
    this.loadedUrl = null;
    this.emit('loaded');
  }

  private resetSession() {
    this.warnedSegmentHosts.clear();
    this.network.length = 0;
    this.documents.clear();
    this.samples.length = 0;
    this.scte.clear();
    this.format = 'unknown';
    this.usingProxy = false;
    this.emit('network');
    this.emit('documents');
  }

  // ---------------------------------------------------------------- filters

  private installFilters() {
    const net = this.player.getNetworkingEngine()!;

    const RT = shaka.net.NetworkingEngine.RequestType;
    net.registerRequestFilter((type, request) => {
      const headers = this.options?.headers ?? {};
      // Guardrail: only manifests/playlists (and the DASH timing source) are
      // proxied unless the proxy explicitly allows segments.
      const isManifest = type === RT.MANIFEST || type === RT.TIMING;
      request.uris = request.uris.map((u) =>
        routeUri(u, { useProxy: this.usingProxy, isManifest, segmentsAllowed: this.proxy?.segments ?? false }),
      );
      const proxied = request.uris.some((u) => isProxied(u));
      for (const [k, v] of Object.entries(headers)) {
        // Through the proxy, custom headers are forwarded as X-Proxy-Header-*.
        request.headers[proxied ? `X-Proxy-Header-${k}` : k] = v;
      }
    });

    net.registerResponseFilter((type, response, context) => {
      const uri = fromProxyUrl(response.uri);
      const advanced = context?.type;
      const typeName =
        advanced !== undefined && advanced !== null ? ADVANCED_TYPE_NAMES[advanced] : REQUEST_TYPE_NAMES[type];
      const bytes = response.data.byteLength;
      this.pushNetwork({
        type: typeName ?? String(type),
        uri,
        status: response.status ?? 200,
        bytes,
        ms: response.timeMs ?? null,
        proxied: isProxied(response.uri),
        fromCache: response.fromCache,
      });
      if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
        this.captureManifest(uri, response.data, advanced);
      }
    });

    this.player.addEventListener('downloadfailed', ((e: Event) => {
      const ev = e as Event & {
        request: shaka.extern.Request;
        requestType: number;
        error: shaka.util.Error | null;
        httpResponseCode: number;
        aborted: boolean;
      };
      if (ev.aborted) return;
      const failedUri = fromProxyUrl(ev.request?.uris?.[0] ?? '');
      if (
        ev.requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT &&
        this.usingProxy &&
        this.proxy &&
        !this.proxy.segments &&
        !this.warnedSegmentHosts.has(hostOf(failedUri))
      ) {
        this.warnedSegmentHosts.add(hostOf(failedUri));
        this.warn(
          `Segment from ${hostOf(failedUri)} failed. This proxy only carries manifests/playlists, so segments ` +
            'load directly and need CORS on their CDN. Fix: enable CORS on that CDN, use `npm run dev` locally, ' +
            'or set PROXY_SEGMENTS=true on the Worker (one Worker request per segment).',
        );
      }
      this.pushNetwork({
        type: REQUEST_TYPE_NAMES[ev.requestType] ?? 'request',
        uri: fromProxyUrl(ev.request?.uris?.[0] ?? ''),
        status: ev.httpResponseCode || null,
        bytes: 0,
        ms: null,
        proxied: isProxied(ev.request?.uris?.[0] ?? ''),
        error: ev.error ? describeShakaError(ev.error) : 'failed',
      });
    }) as EventListener);
  }

  private captureManifest(uri: string, data: ArrayBuffer | ArrayBufferView, advanced?: number | null) {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const text = new TextDecoder().decode(buf);
    const A = shaka.net.NetworkingEngine.AdvancedRequestType;
    let kind: CapturedDocument['kind'] = 'Manifest';
    if (advanced === A.MPD || text.includes('<MPD')) kind = 'MPD';
    else if (text.startsWith('#EXTM3U')) kind = text.includes('#EXT-X-STREAM-INF') ? 'Master playlist' : 'Media playlist';
    this.documents.set(uri, { uri, kind, text, at: new Date(), size: buf.byteLength });
    this.emit('documents');

    if (kind === 'Media playlist') {
      const info = parseHlsCues(text, uri);
      if (info.cues.length) this.scte.addHlsCues(info.cues);
    }
  }

  private pushNetwork(entry: Omit<NetworkEntry, 'id' | 'at'>) {
    this.network.push({ ...entry, id: ++this.netSeq, at: new Date() });
    if (this.network.length > MAX_NETWORK) this.network.splice(0, this.network.length - MAX_NETWORK);
    this.emit('network');
  }

  // ----------------------------------------------------------------- events

  private installEvents() {
    const on = (name: string, fn: Handler) => this.player.addEventListener(name, fn as EventListener);

    on('error', (e) => {
      const err = (e as unknown as { detail: shaka.util.Error }).detail;
      this.error(describeShakaError(err));
      this.emit('error', err);
    });
    on('trackschanged', () => this.emit('tracks'));
    on('variantchanged', () => {
      this.emit('tracks');
      const v = this.player.getVariantTracks().find((t) => t.active);
      if (v) this.info(`Variant changed → ${v.width ?? '?'}x${v.height ?? '?'} @ ${Math.round(v.bandwidth / 1000)} kbps`);
    });
    on('adaptation', () => {
      this.emit('tracks');
      const v = this.player.getVariantTracks().find((t) => t.active);
      if (v) this.info(`ABR switch → ${v.height ?? '?'}p @ ${Math.round(v.bandwidth / 1000)} kbps`);
    });
    on('audiotrackschanged', () => this.emit('tracks'));
    on('audiotrackchanged', () => this.emit('tracks'));
    on('textchanged', () => this.emit('tracks'));
    on('abrstatuschanged', () => this.emit('tracks'));
    on('buffering', (e) => {
      const buffering = (e as unknown as { buffering: boolean }).buffering;
      this.emit('buffering', buffering);
    });
    on('stalldetected', () => this.warn('Stall detected'));
    on('gapjumped', () => this.warn('Gap jumped'));
    on('manifestupdated', () => this.scte.resolvePending());

    on('timelineregionadded', (e) => {
      const region = (e as unknown as { detail: shaka.extern.TimelineRegionInfo }).detail;
      this.handleRegion(region);
    });
    on('emsg', (e) => {
      const emsg = (e as unknown as { detail: shaka.extern.EmsgInfo }).detail;
      this.scte.addEmsg(emsg);
    });

    this.scte.onChange(() => this.emit('scte'));
  }

  private handleRegion(region: shaka.extern.TimelineRegionInfo) {
    // HLS DATERANGE regions have no XML node; those tags are parsed from the
    // playlist text instead (see captureManifest).
    if (!region.eventNode || this.player.getManifestType() === 'HLS') return;
    if (!isScteScheme(region.schemeIdUri)) {
      this.scte.addTimelineRegion({ ...region, xmlSummary: region.eventNode ? xmlSummary(region.eventNode) : region.value });
      return;
    }
    const binary = region.eventNode ? findBinary(region.eventNode) : undefined;
    this.scte.addTimelineRegion({
      ...region,
      payload: binary,
      xmlSummary: region.eventNode ? xmlSummary(region.eventNode) : undefined,
    });
  }

  /** Map an HLS cue to presentation time. */
  private resolveHlsCueTime(cue: HlsCue): number | null {
    // 1. Program date time relative to the presentation start.
    const start = this.player.getPresentationStartTimeAsDate();
    if (cue.date && start) return (cue.date.getTime() - start.getTime()) / 1000;
    // 2. VOD: offset from the start of the playlist.
    if (this.loadedUrl && !this.player.isLive()) return cue.playlistOffset;
    // 3. Live without PDT: find the segment reference with the same URI.
    return cue.segmentUri ? this.findSegmentStart(cue.segmentUri) : null;
  }

  private findSegmentStart(uri: string): number | null {
    const manifest = this.player.getManifest();
    if (!manifest) return null;
    for (const variant of manifest.variants) {
      for (const stream of [variant.video, variant.audio]) {
        const index = stream?.segmentIndex;
        if (!index) continue;
        for (const ref of index as unknown as Iterable<shaka.media.SegmentReference>) {
          if (ref && ref.getUris().some((u) => fromProxyUrl(u) === uri)) return ref.getStartTime();
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ stats

  private tick() {
    if (!this.loadedUrl) return;
    // Emsg events fire on playhead entry; poll so markers show as soon as parsed.
    for (const r of this.player.getAllEmsgRegions()) this.scte.addEmsg(r.emsg);
    if (this.player.getManifestType() !== 'HLS') {
      for (const r of this.player.getAllTimelineRegions()) this.handleRegion(r);
    }
    this.scte.resolvePending();

    const stats = this.player.getStats();
    const buffered = this.player.getBufferedInfo().total;
    const t = this.video.currentTime;
    const range = buffered.find((r) => r.start <= t + 0.1 && r.end >= t);
    this.samples.push({
      t: Date.now(),
      estimatedBandwidth: stats.estimatedBandwidth || 0,
      streamBandwidth: stats.streamBandwidth || 0,
      bufferAhead: range ? Math.max(0, range.end - t) : 0,
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    this.emit('tick');
  }

  // ---------------------------------------------------------------- helpers

  info(message: string) {
    this.pushLog('info', message);
  }
  warn(message: string) {
    this.pushLog('warn', message);
  }
  error(message: string) {
    this.pushLog('error', message);
  }

  private pushLog(level: LogEntry['level'], message: string) {
    this.log.push({ at: new Date(), level, message });
    if (this.log.length > MAX_LOG) this.log.shift();
    this.emit('log');
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  on(name: string, fn: (detail: unknown) => void): () => void {
    const listener = (e: Event) => fn((e as CustomEvent).detail);
    this.addEventListener(name, listener);
    return () => this.removeEventListener(name, listener);
  }

  async destroy() {
    window.clearInterval(this.tickTimer);
    await this.player.destroy();
  }
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

type XmlNode = shaka.extern.xml.Node;

function children(node: XmlNode): XmlNode[] {
  return (node.children ?? []).filter((c): c is XmlNode => typeof c !== 'string');
}

function textOf(node: XmlNode): string {
  return (node.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

const localName = (node: XmlNode) => node.tagName.replace(/^.*:/, '');

/** Finds a <Binary> (SCTE 35 2014 xml+bin) or bare base64 event body. */
function findBinary(node: XmlNode): string | undefined {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (localName(n) === 'Binary') return textOf(n).trim();
    stack.push(...children(n));
  }
  const body = textOf(node).trim();
  return /^[A-Za-z0-9+/=\s]{16,}$/.test(body) && body.startsWith('/D') ? body : undefined;
}

/** Compact description of an XML-form SCTE event (urn:scte:scte35:2013:xml). */
function xmlSummary(node: XmlNode): string {
  const parts: string[] = [];
  const stack = [...children(node)];
  while (stack.length) {
    const n = stack.shift()!;
    const name = localName(n);
    if (!['Signal', 'SpliceInfoSection', 'Binary'].includes(name)) {
      const attrs = Object.entries(n.attributes ?? {})
        .filter(([k]) => !k.startsWith('xmlns'))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      parts.push(attrs ? `${name}(${attrs})` : name);
    }
    stack.push(...children(n));
  }
  return parts.join(' · ') || localName(node);
}
