import type { HlsCue, HlsPlaylistInfo } from './hls-cues';
import { hlsRuns, type ContentRun } from './ssai';
import {
  cueDirection,
  cueDuration,
  parseScte35,
  summarizeScte35,
  type CueDirection,
  type SpliceInfoSection,
} from './scte35';

export type ScteSource =
  | 'DASH EventStream'
  | 'In-band emsg'
  | 'HLS DATERANGE'
  | 'HLS CUE-OUT'
  | 'HLS CUE-OUT-CONT'
  | 'HLS CUE-IN'
  | 'HLS EXT-X-SCTE35'
  | 'HLS OATCLS'
  | 'HLS SPLICEPOINT';

export interface ScteEvent {
  key: string;
  seq: number;
  source: ScteSource;
  schemeIdUri?: string;
  /** Wall-clock time the app first saw the marker. */
  receivedAt: Date;
  /** Presentation time in seconds, or null while it cannot be resolved. */
  startTime: number | null;
  duration?: number;
  direction: CueDirection;
  summary: string;
  eventId?: string;
  section?: SpliceInfoSection;
  /** Decoding error, if the payload could not be parsed. */
  error?: string;
  /** Raw payload / tag text for the detail view. */
  raw: string;
  /** Extra fields shown in the detail view. */
  meta: Record<string, string | number | undefined>;
  /** HLS only: used to resolve the presentation time later. */
  hls?: HlsCue;
  /** HLS: every media playlist the tag was found in. */
  seenIn: string[];
  /** Player state when the marker was first seen (for the lead time). */
  observed?: { live: boolean; availabilityEnd: number | null; bufferEnd: number | null };
  /** Where the marker falls relative to the video segment that contains it. */
  alignment?: SegmentAlignment;
  /** HLS CUE-OUT-CONT tags of this break: elapsed time they state vs the time actually elapsed. */
  contChecks?: { elapsed: number; actual: number; tag: string }[];
}

export interface SegmentAlignment {
  segmentStart: number;
  segmentEnd: number;
  /** Seconds after the start of the segment (0 = on the boundary). */
  offset: number;
}

/** What the player can tell the monitor about the stream (set by the controller). */
export interface MonitorContext {
  live: boolean;
  /** Newest media time available (live edge), or null. */
  availabilityEnd: number | null;
  /** End of the buffered media. */
  bufferEnd: number | null;
  /** Video segment containing a presentation time. */
  segmentAt(time: number): { start: number; end: number } | null;
}

export type PlaylistKind = 'video' | 'audio' | 'subtitles' | 'unknown';

/** A media playlist and the part of the timeline it has listed so far. */
export interface PlaylistCoverage {
  uri: string;
  label: string;
  kind: PlaylistKind;
  /** Covered wall-clock range (playlists with PROGRAM-DATE-TIME). */
  firstDate?: number;
  lastDate?: number;
  /** Covered playlist-offset range (VOD playlists). */
  duration?: number;
  live: boolean;
  targetDuration?: number;
}

export interface ActiveBreak {
  event: ScteEvent;
  start: number;
  end?: number;
  remaining?: number;
}

type Listener = () => void;

export type HlsTimeResolver = (cue: HlsCue) => number | null;

const SCHEME_SOURCES = ['urn:scte:scte35', 'scte35'];

export function isScteScheme(schemeIdUri: string): boolean {
  const s = schemeIdUri.toLowerCase();
  return SCHEME_SOURCES.some((p) => s.includes(p));
}

/** Decodes a payload, returning section + summary or an error message. */
function decode(payload: string | Uint8Array | undefined) {
  if (payload === undefined || payload === '') return {};
  try {
    const section = parseScte35(payload);
    return {
      section,
      summary: summarizeScte35(section),
      direction: cueDirection(section),
      duration: cueDuration(section),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Collects SCTE-35 / ad markers from all sources, removes duplicates (the
 * same marker shows up in every rendition playlist and on every live
 * refresh) and tracks whether playback is currently inside an ad break.
 */
export class ScteMonitor {
  private events = new Map<string, ScteEvent>();
  private listeners = new Set<Listener>();
  private seq = 0;
  private hlsResolver: HlsTimeResolver | null = null;
  private context: (() => MonitorContext) | null = null;
  readonly playlists = new Map<string, PlaylistCoverage>();
  private labels = new Map<string, { label: string; kind: PlaylistKind }>();
  /** Content runs of one video playlist (HLS) or the MPD periods (DASH), for ad insertion. */
  readonly runs = new Map<string, ContentRun>();
  private runsPlaylist: string | null = null;

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Increases on every change (for caching derived views). */
  version = 0;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  clear() {
    this.events.clear();
    this.playlists.clear();
    this.labels.clear();
    this.runs.clear();
    this.runsPlaylist = null;
    this.seq = 0;
    this.emit();
  }

  setContext(fn: (() => MonitorContext) | null) {
    this.context = fn;
  }

  /** Names a media playlist (from the master playlist), e.g. "video 1280×720". */
  setPlaylistLabel(uri: string, label: string, kind: PlaylistKind) {
    this.labels.set(uri, { label, kind });
    const p = this.playlists.get(uri);
    if (p) Object.assign(p, { label, kind });
  }

  /** Records which part of the timeline a media playlist lists (for missing-marker checks). */
  notePlaylist(uri: string, info: HlsPlaylistInfo) {
    if (info.isMaster || !info.segments.length) return;
    const named = this.labels.get(uri);
    const p = this.playlists.get(uri) ?? {
      uri,
      label: named?.label ?? shortName(uri),
      kind: named?.kind ?? 'unknown',
      live: info.isLive,
    };
    p.live = info.isLive;
    p.targetDuration = info.targetDuration;
    const first = info.segments[0];
    const last = info.segments[info.segments.length - 1];
    if (first.date && last.date) {
      const start = first.date.getTime();
      const end = last.date.getTime() + last.duration * 1000;
      p.firstDate = p.firstDate === undefined ? start : Math.min(p.firstDate, start);
      p.lastDate = p.lastDate === undefined ? end : Math.max(p.lastDate, end);
    }
    if (!info.isLive) p.duration = info.totalDuration;
    this.playlists.set(uri, p);
  }

  /** Records the content runs of one video playlist (refreshes extend them). */
  noteHlsRuns(uri: string, info: HlsPlaylistInfo) {
    const kind = this.labels.get(uri)?.kind ?? 'unknown';
    if (info.isMaster || kind === 'audio' || kind === 'subtitles') return;
    this.runsPlaylist ??= uri;
    if (uri !== this.runsPlaylist) return;
    let changed = false;
    for (const run of hlsRuns(info)) {
      const span = (r: ContentRun) => (r.date ? [r.date.getTime() / 1000, r.date.getTime() / 1000 + r.duration] : [r.offset ?? 0, (r.offset ?? 0) + r.duration]);
      const [a, b] = span(run);
      const same = [...this.runs.values()].find((r) => {
        if (r.origin !== run.origin || r.source !== run.source) return false;
        const [c, d] = span(r);
        // Overlap (the same run in a refreshed window); back-to-back runs stay separate ads.
        return a < d - 0.05 && b > c + 0.05 && Boolean(r.date) === Boolean(run.date);
      });
      if (same) {
        const [c, d] = span(same);
        const end = Math.max(b, d);
        if (end - c > same.duration + 0.01) {
          same.duration = end - c;
          changed = true;
        }
        continue;
      }
      run.start = this.resolveRun(run);
      this.runs.set(run.key, run);
      changed = true;
    }
    if (changed) this.emit();
  }

  /** Replaces the DASH periods (every MPD refresh lists the current ones). */
  noteDashRuns(runs: ContentRun[]) {
    for (const r of runs) this.runs.set(r.key, r);
    if (runs.length) this.emit();
  }

  private resolveRun(run: ContentRun): number | null {
    if (run.start !== null || !this.hlsResolver) return run.start;
    return this.hlsResolver({ kind: 'CUE-OUT', tag: '', attributes: {}, date: run.date, playlistOffset: run.offset ?? 0, mediaSequence: 0, segmentUri: run.firstUri });
  }

  /** Marks where the marker sits within its video segment, once its time is known. */
  private align(e: ScteEvent) {
    if (e.alignment || e.startTime === null || !this.context) return;
    const seg = this.context().segmentAt(e.startTime);
    if (seg) e.alignment = { segmentStart: seg.start, segmentEnd: seg.end, offset: e.startTime - seg.start };
  }

  setHlsResolver(fn: HlsTimeResolver | null) {
    this.hlsResolver = fn;
  }

  list(): ScteEvent[] {
    return [...this.events.values()].sort((a, b) => {
      const ta = a.startTime ?? Number.POSITIVE_INFINITY;
      const tb = b.startTime ?? Number.POSITIVE_INFINITY;
      return ta - tb || a.seq - b.seq;
    });
  }

  get size(): number {
    return this.events.size;
  }

  private add(e: Omit<ScteEvent, 'seq' | 'receivedAt' | 'seenIn'> & { seenIn?: string[] }): boolean {
    if (this.events.has(e.key)) return false;
    const ctx = this.context?.();
    const event: ScteEvent = {
      ...e,
      seenIn: e.seenIn ?? [],
      seq: ++this.seq,
      receivedAt: new Date(),
      observed: ctx ? { live: ctx.live, availabilityEnd: ctx.availabilityEnd, bufferEnd: ctx.bufferEnd } : undefined,
    };
    this.align(event);
    this.events.set(e.key, event);
    this.emit();
    return true;
  }

  /** DASH <EventStream> event or HLS DATERANGE surfaced by Shaka. */
  addTimelineRegion(region: {
    schemeIdUri: string;
    value: string;
    id: string;
    startTime: number;
    endTime: number;
    payload?: string;
    isHlsDateRange?: boolean;
    xmlSummary?: string;
  }) {
    if (region.isHlsDateRange) return; // handled by addHlsCues with richer data
    const d = decode(region.payload);
    const duration =
      d.duration ?? (Number.isFinite(region.endTime) && region.endTime > region.startTime
        ? region.endTime - region.startTime
        : undefined);
    this.add({
      key: `region:${region.schemeIdUri}:${region.id}:${region.startTime.toFixed(3)}`,
      source: 'DASH EventStream',
      schemeIdUri: region.schemeIdUri,
      startTime: region.startTime,
      duration,
      direction: d.direction ?? 'other',
      summary: d.summary ?? region.xmlSummary ?? (d.error ? `Undecodable: ${d.error}` : 'Event'),
      eventId: region.id,
      section: d.section,
      error: d.error,
      raw: region.payload ?? region.xmlSummary ?? '',
      meta: { value: region.value, endTime: region.endTime },
    });
  }

  /** In-band `emsg` box. */
  addEmsg(emsg: {
    schemeIdUri: string;
    value: string;
    id: number;
    startTime: number;
    endTime: number;
    eventDuration: number;
    timescale: number;
    messageData: Uint8Array | null;
  }) {
    const isScte = isScteScheme(emsg.schemeIdUri);
    const d = isScte && emsg.messageData ? decode(emsg.messageData) : {};
    const raw = emsg.messageData ? btoa(String.fromCharCode(...emsg.messageData)) : '';
    const advertised =
      emsg.eventDuration && emsg.eventDuration !== 0xffffffff
        ? emsg.eventDuration / (emsg.timescale || 1)
        : undefined;
    this.add({
      key: `emsg:${emsg.schemeIdUri}:${emsg.id}:${emsg.startTime.toFixed(2)}`,
      source: 'In-band emsg',
      schemeIdUri: emsg.schemeIdUri,
      startTime: emsg.startTime,
      duration: d.duration ?? advertised,
      direction: d.direction ?? 'other',
      summary: d.summary ?? (d.error ? `Undecodable: ${d.error}` : `emsg ${emsg.schemeIdUri}`),
      eventId: String(emsg.id),
      section: d.section,
      error: d.error,
      raw,
      meta: { value: emsg.value, timescale: emsg.timescale },
    });
  }

  addHlsCues(cues: HlsCue[]) {
    for (const cue of cues) {
      // Audio and video playlists put the same tag on slightly different
      // segment boundaries, so bucket the time to half a second.
      const when = cue.date
        ? `d${Math.round(cue.date.getTime() / 500)}`
        : `o${Math.round(cue.playlistOffset * 2)}`;
      let key: string;
      let source: ScteSource;
      let direction: CueDirection = 'other';
      let summary: string;
      switch (cue.kind) {
        case 'DATERANGE':
          key = `dr:${cue.id}:${cue.scte35Attribute ?? ''}`;
          source = 'HLS DATERANGE';
          direction =
            cue.scte35Attribute === 'SCTE35-OUT' ? 'out' : cue.scte35Attribute === 'SCTE35-IN' ? 'in' : 'other';
          summary = `DATERANGE ${cue.id ?? ''}${cue.attributes.CLASS ? ` (${cue.attributes.CLASS})` : ''}`;
          break;
        case 'CUE-OUT':
          key = `cueout:${when}`;
          source = 'HLS CUE-OUT';
          direction = 'out';
          summary = 'CUE-OUT';
          break;
        case 'CUE-OUT-CONT': {
          // Synthesises the OUT it implies when joining mid-break; otherwise
          // checks the elapsed time it states against its CUE-OUT.
          if (cue.elapsed === undefined) continue;
          const startOffset = cue.playlistOffset - cue.elapsed;
          const startDate = cue.date ? new Date(cue.date.getTime() - cue.elapsed * 1000) : undefined;
          const out = this.cueOutBefore(cue);
          if (out?.hls) {
            const actual = cue.date && out.hls.date ? (cue.date.getTime() - out.hls.date.getTime()) / 1000 : cue.playlistOffset - out.hls.playlistOffset;
            const checks = (out.contChecks ??= []);
            if (actual >= 0 && checks.length < 200 && !checks.some((c) => c.tag === cue.tag && Math.abs(c.actual - actual) < 0.01)) {
              checks.push({ elapsed: cue.elapsed, actual, tag: cue.tag });
            }
          }
          const hasOut = [...this.events.values()].some(
            (e) =>
              e.direction === 'out' &&
              e.hls &&
              (startDate && e.hls.date
                ? Math.abs(e.hls.date.getTime() - startDate.getTime()) < 1500
                : Math.abs(e.hls.playlistOffset - startOffset) < 1.5),
          );
          if (hasOut) continue;
          key = `cueout:${startDate ? Math.round(startDate.getTime() / 1000) : `o${startOffset.toFixed(0)}`}:cont`;
          source = 'HLS CUE-OUT-CONT';
          direction = 'out';
          summary = `Joined mid-break (CUE-OUT-CONT ${cue.elapsed}s elapsed)`;
          cue.playlistOffset = startOffset;
          cue.date = startDate;
          break;
        }
        case 'CUE-IN':
          key = `cuein:${when}`;
          source = 'HLS CUE-IN';
          direction = 'in';
          summary = 'CUE-IN';
          break;
        case 'SCTE35':
          key = `x-scte35:${cue.id ?? ''}:${when}`;
          source = 'HLS EXT-X-SCTE35';
          summary = 'EXT-X-SCTE35';
          break;
        case 'OATCLS-SCTE35':
          key = `oatcls:${when}`;
          source = 'HLS OATCLS';
          summary = 'EXT-OATCLS-SCTE35';
          break;
        case 'SPLICEPOINT-SCTE35':
          key = `splicepoint:${when}`;
          source = 'HLS SPLICEPOINT';
          summary = 'EXT-X-SPLICEPOINT-SCTE35';
          break;
      }
      const existing = this.events.get(key);
      if (existing) {
        if (cue.playlistUri && !existing.seenIn.includes(cue.playlistUri)) {
          existing.seenIn.push(cue.playlistUri);
          this.emit();
        }
        continue;
      }
      const d = decode(cue.scte35);
      this.add({
        key,
        source,
        startTime: this.hlsResolver?.(cue) ?? null,
        duration: cue.duration ?? d.duration,
        direction: d.direction && d.direction !== 'other' ? d.direction : direction,
        summary: d.summary ? `${summary} · ${d.summary}` : d.error ? `${summary} · Undecodable: ${d.error}` : summary,
        eventId: cue.id,
        section: d.section,
        error: d.error,
        raw: cue.tag,
        meta: {
          date: cue.date?.toISOString(),
          segment: cue.segmentUri,
          mediaSequence: cue.mediaSequence,
        },
        hls: cue,
        seenIn: cue.playlistUri ? [cue.playlistUri] : [],
      });
    }
  }

  /** The latest HLS CUE-OUT at or before a CUE-OUT-CONT (same playlist timeline). */
  private cueOutBefore(cue: HlsCue): ScteEvent | undefined {
    let best: ScteEvent | undefined;
    for (const e of this.events.values()) {
      if (e.source !== 'HLS CUE-OUT' || !e.hls) continue;
      const before = cue.date && e.hls.date ? e.hls.date <= cue.date : e.hls.playlistOffset <= cue.playlistOffset;
      if (!before) continue;
      const t = (x: ScteEvent) => x.hls!.date?.getTime() ?? x.hls!.playlistOffset;
      if (!best || t(e) > t(best)) best = e;
    }
    return best;
  }

  /** Retries presentation-time resolution for HLS cues that had none. */
  resolvePending(): void {
    if (!this.hlsResolver) return;
    let changed = false;
    for (const e of this.events.values()) {
      if (e.startTime === null && e.hls) {
        const t = this.hlsResolver(e.hls);
        if (t !== null) {
          e.startTime = t;
          changed = true;
        }
      }
      if (!e.alignment && e.startTime !== null) {
        this.align(e);
        if (e.alignment) changed = true;
      }
    }
    for (const r of this.runs.values()) {
      if (r.start === null) {
        r.start = this.resolveRun(r);
        if (r.start !== null) changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** The ad break that contains `time`, if any. */
  activeBreak(time: number): ActiveBreak | null {
    let current: ActiveBreak | null = null;
    for (const e of this.list()) {
      if (e.startTime === null || e.startTime > time + 0.05) continue;
      if (e.direction === 'out') {
        const end = e.duration !== undefined ? e.startTime + e.duration : undefined;
        current = end === undefined || end > time ? { event: e, start: e.startTime, end } : null;
      } else if (e.direction === 'in') {
        current = null;
      }
    }
    if (current?.end !== undefined) current.remaining = Math.max(0, current.end - time);
    return current;
  }
}

/** Last two path parts of a URI, e.g. "720p/index.m3u8". */
function shortName(uri: string): string {
  try {
    const parts = new URL(uri).pathname.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || uri;
  } catch {
    return uri;
  }
}
