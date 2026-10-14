import type { HlsCue } from './hls-cues';
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

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  clear() {
    this.events.clear();
    this.seq = 0;
    this.emit();
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

  private add(e: Omit<ScteEvent, 'seq' | 'receivedAt'>): boolean {
    if (this.events.has(e.key)) return false;
    this.events.set(e.key, { ...e, seq: ++this.seq, receivedAt: new Date() });
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
          // Only useful when joining mid-break: synthesise the OUT it implies.
          if (cue.elapsed === undefined) continue;
          const startOffset = cue.playlistOffset - cue.elapsed;
          const startDate = cue.date ? new Date(cue.date.getTime() - cue.elapsed * 1000) : undefined;
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
      if (this.events.has(key)) continue;
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
      });
    }
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
