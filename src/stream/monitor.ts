import type { HlsPlaylistInfo } from '../scte/hls-cues';
import { parseInit, segmentTiming, type InitInfo, type SegmentTiming } from '../media/segment';
import { parseMpd, type MpdSummary } from './mpd';

/**
 * Collects what the stream checks need while the player runs: every HLS
 * media playlist refresh (to compare consecutive versions), the latest MPD,
 * and the timing of downloaded segments read from the media itself.
 */

export type Severity = 'error' | 'warn' | 'info';

export interface StreamIssue {
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  /** Playlist / representation / stream it concerns. */
  where: string;
  /** Presentation time, when it applies to a moment in the stream. */
  time?: number | null;
  /** When it was seen (events between refreshes). */
  at?: Date;
}

export interface PlaylistState {
  uri: string;
  label: string;
  live: boolean;
  targetDuration?: number;
  info: HlsPlaylistInfo;
  /** Wall-clock ms of the last fetch and of the last change in content. */
  lastFetchAt: number;
  lastChangeAt: number;
  refreshes: number;
  text: string;
  /** Media sequence number of each segment URI seen (bounded). */
  msnByUri: Map<string, number>;
  /** PROGRAM-DATE-TIME (ms) by media sequence number (bounded). */
  pdtByMsn: Map<number, number>;
}

export interface SegmentRecord {
  streamId: number;
  kind: 'video' | 'audio' | 'text' | 'other';
  label: string;
  uri: string;
  /** Presentation time (from the manifest). */
  declaredStart: number;
  declaredEnd: number;
  bytes: number;
  /** Read from the media; null when the format isn't understood. */
  actual: SegmentTiming | null;
}

export interface StreamInfo {
  id: number;
  kind: SegmentRecord['kind'];
  label: string;
  /** Codecs declared by the manifest. */
  declaredCodecs: string;
  /** Bandwidth declared for the variant (HLS) or representation (DASH), bits/s. */
  declaredBandwidth?: number;
  format: 'HLS' | 'DASH';
  width?: number;
  height?: number;
  init?: InitInfo | null;
}

const MAX_SEGMENTS = 2000;
const MAX_EVENTS = 500;
const MAX_MAP = 3000;

const bound = <K, V>(m: Map<K, V>) => {
  while (m.size > MAX_MAP) m.delete(m.keys().next().value as K);
};

export class StreamMonitor {
  readonly playlists = new Map<string, PlaylistState>();
  readonly segments: SegmentRecord[] = [];
  readonly streams = new Map<number, StreamInfo>();
  /** Problems seen between two versions of a playlist / MPD. */
  readonly events: StreamIssue[] = [];
  mpd: { summary: MpdSummary; fetchedAt: number; timelineEnds: Map<string, { end: number; changedAt: number }> } | null = null;
  version = 0;
  private labels = new Map<string, string>();
  /** Init segments by URI: Shaka may fetch them while parsing the manifest, before any stream asks. */
  private initsByUri = new Map<string, InitInfo | null>();
  private listeners = new Set<() => void>();

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  clear() {
    this.playlists.clear();
    this.segments.length = 0;
    this.streams.clear();
    this.events.length = 0;
    this.mpd = null;
    this.labels.clear();
    this.initsByUri.clear();
    this.emit();
  }

  setLabel(uri: string, label: string) {
    this.labels.set(uri, label);
    const p = this.playlists.get(uri);
    if (p) p.label = label;
  }

  private event(e: StreamIssue) {
    const dup = this.events.find((x) => x.code === e.code && x.where === e.where && x.detail === e.detail);
    if (dup) return;
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** A media playlist response: compares it with the previous version. */
  notePlaylist(uri: string, text: string, info: HlsPlaylistInfo, now = Date.now()) {
    if (info.isMaster) return;
    const prev = this.playlists.get(uri);
    const label = this.labels.get(uri) ?? shortName(uri);
    const at = new Date(now);
    const first = info.mediaSequence;
    const last = first + info.segments.length - 1;
    if (prev) {
      const p = prev.info;
      const pFirst = p.mediaSequence;
      const pLast = pFirst + p.segments.length - 1;
      if (p.targetDuration !== undefined && info.targetDuration !== undefined && p.targetDuration !== info.targetDuration) {
        this.event({ severity: 'error', code: 'td-changed', title: 'EXT-X-TARGETDURATION changed', detail: `${p.targetDuration} s → ${info.targetDuration} s between two refreshes (it must not change).`, where: label, at });
      }
      if (first < pFirst) {
        this.event({ severity: 'error', code: 'msn-back', title: 'Media sequence went backwards', detail: `EXT-X-MEDIA-SEQUENCE ${pFirst} → ${first}.`, where: label, at });
      } else if (prev.live && first > pLast + 1) {
        this.event({ severity: 'warn', code: 'msn-skip', title: 'Segments skipped between refreshes', detail: `The playlist moved from ${pFirst}–${pLast} to ${first}–${last}: ${first - pLast - 1} segment(s) were never listed to this player (playlist updated too fast, or reloaded too slowly).`, where: label, at });
      }
      // The same segment must keep its media sequence number.
      for (const [i, s] of info.segments.entries()) {
        const was = prev.msnByUri.get(s.uri);
        if (was !== undefined && was !== first + i) {
          this.event({ severity: 'error', code: 'msn-mismatch', title: 'Segment changed its media sequence number', detail: `${shortName(s.uri)} was ${was}, now ${first + i}.`, where: label, at });
          break;
        }
      }
      // Each discontinuity that slides out of the window increments the discontinuity sequence.
      if (first > pFirst && first <= pLast + 1) {
        const removed = p.segments.slice(0, first - pFirst).filter((s) => s.discontinuity).length;
        const expected = p.discontinuitySequence + removed;
        if (info.discontinuitySequence !== expected) {
          this.event({ severity: 'error', code: 'dsn', title: 'Discontinuity sequence is wrong', detail: `EXT-X-DISCONTINUITY-SEQUENCE is ${info.discontinuitySequence}; ${removed} discontinuit${removed === 1 ? 'y' : 'ies'} left the window, so ${expected} was expected.`, where: label, at });
        }
      }
      for (const [i, s] of info.segments.entries()) {
        const was = prev.pdtByMsn.get(first + i);
        if (was !== undefined && s.date && Math.abs(was - s.date.getTime()) > 100) {
          this.event({ severity: 'warn', code: 'pdt-changed', title: 'PROGRAM-DATE-TIME changed between refreshes', detail: `Segment ${first + i}: ${new Date(was).toISOString()} → ${s.date.toISOString()}.`, where: label, at });
          break;
        }
      }
      if (prev.live && !info.isLive) this.event({ severity: 'info', code: 'ended', title: 'Live stream ended', detail: 'The playlist now has EXT-X-ENDLIST.', where: label, at });
    }
    const state: PlaylistState = prev ?? { uri, label, live: info.isLive, info, lastFetchAt: now, lastChangeAt: now, refreshes: 0, text, msnByUri: new Map(), pdtByMsn: new Map() };
    if (prev && text !== prev.text) state.lastChangeAt = now;
    state.lastFetchAt = now;
    state.refreshes++;
    state.text = text;
    state.info = info;
    state.live = info.isLive;
    state.targetDuration = info.targetDuration;
    info.segments.forEach((s, i) => {
      state.msnByUri.set(s.uri, first + i);
      if (s.date) state.pdtByMsn.set(first + i, s.date.getTime());
    });
    bound(state.msnByUri);
    bound(state.pdtByMsn);
    this.playlists.set(uri, state);
    this.emit();
  }

  /** An MPD response: keeps the latest summary and when each timeline last grew. */
  noteMpd(text: string, now = Date.now()) {
    let summary: MpdSummary;
    try {
      summary = parseMpd(text);
    } catch {
      return;
    }
    const ends = this.mpd?.timelineEnds ?? new Map<string, { end: number; changedAt: number }>();
    for (const tl of summary.timelines) {
      const lastEntry = tl.entries[tl.entries.length - 1];
      if (!lastEntry) continue;
      const end = (lastEntry.t + lastEntry.d) / tl.timescale;
      const was = ends.get(tl.label);
      if (!was || end > was.end + 1e-6) ends.set(tl.label, { end, changedAt: now });
    }
    this.mpd = { summary, fetchedAt: now, timelineEnds: ends };
    this.emit();
  }

  /** An init segment read without a stream (during manifest parsing) that fits this stream. */
  private matchInit(s: StreamInfo): InitInfo | undefined {
    const handler = s.kind === 'video' ? 'vide' : 'soun';
    const family = s.declaredCodecs.split(',')[0]?.split('.')[0].toLowerCase();
    const inits = [...this.initsByUri.values()].filter((i): i is InitInfo => Boolean(i?.tracks.some((t) => t.handler === handler)));
    const track = (i: InitInfo) => i.tracks.find((t) => t.handler === handler)!;
    return (
      inits.find((i) => s.width !== undefined && track(i).width === s.width && track(i).height === s.height) ??
      inits.find((i) => track(i).codec.toLowerCase().startsWith(family ?? '\0'))
    );
  }

  /** Describes a stream once (codecs, bandwidth) for the checks. */
  noteStream(info: StreamInfo) {
    const was = this.streams.get(info.id);
    this.streams.set(info.id, { ...info, init: was?.init ?? info.init });
  }

  /** An init segment response, with or without a known stream. */
  noteInit(streamId: number | null, uri: string, data: Uint8Array) {
    let init: InitInfo | null;
    try {
      init = parseInit(data);
    } catch {
      init = null;
    }
    this.initsByUri.set(uri, init);
    const s = streamId !== null ? this.streams.get(streamId) : undefined;
    if (s) s.init = init;
    this.emit();
  }

  noteSegment(streamId: number, uri: string, declaredStart: number, declaredEnd: number, data: Uint8Array) {
    const s = this.streams.get(streamId);
    if (!s) return;
    s.init ??= this.matchInit(s);
    let actual: SegmentTiming | null = null;
    try {
      actual = segmentTiming(data, s.init);
    } catch {
      actual = null;
    }
    // Re-downloads (seeks, quality changes back) replace the earlier record.
    const i = this.segments.findIndex((r) => r.streamId === streamId && r.uri === uri && Math.abs(r.declaredStart - declaredStart) < 0.01);
    const rec: SegmentRecord = { streamId, kind: s.kind, label: s.label, uri, declaredStart, declaredEnd, bytes: data.byteLength, actual };
    if (i >= 0) this.segments[i] = rec;
    else this.segments.push(rec);
    if (this.segments.length > MAX_SEGMENTS) this.segments.shift();
    this.emit();
  }
}

export function shortName(uri: string): string {
  try {
    const parts = new URL(uri).pathname.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || uri;
  } catch {
    return uri;
  }
}
