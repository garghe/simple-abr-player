import type { HealthIssue } from './health';
import { groupSignals, type Signal } from './health';
import type { HlsPlaylistInfo } from './hls-cues';
import type { ScteEvent } from './monitor';

/**
 * Server-side ad insertion awareness. Inserted ads show up as content from
 * another origin: in HLS as discontinuity-separated runs of segments from a
 * different host or path, in DASH as periods served from elsewhere. HLS
 * Interstitials (client-side insertion) are listed too. Each ad pod is then
 * matched with the SCTE-35 break that should have triggered it.
 */

/** A stretch of content from one origin (between discontinuities / one DASH period). */
export interface ContentRun {
  key: string;
  /** HLS: an EXT-X-DISCONTINUITY starts the run (inserted content always has one). */
  discontinuity?: boolean;
  /** Host + directory of the segments, e.g. "ads.cdn.com/creatives/123". */
  origin: string;
  /** Presentation time, once known. */
  start: number | null;
  duration: number;
  /** Segments (HLS) or 1 (DASH period). */
  segments: number;
  /** Wall-clock start (HLS with PROGRAM-DATE-TIME). */
  date?: Date;
  /** HLS: seconds from the start of the playlist (VOD). */
  offset?: number;
  firstUri: string;
  source: 'HLS discontinuity' | 'DASH period';
  /** DASH period id. */
  periodId?: string;
}

export interface AdPod {
  start: number;
  duration: number;
  kind: 'inserted' | 'interstitial';
  /** Inserted runs (ads) in the pod, or the interstitial asset. */
  ads: { origin: string; duration: number; uri: string }[];
  source: string;
  /** Marker key of an interstitial. */
  key?: string;
}

export interface PodReport {
  pod: AdPod;
  /** The OUT signal at the start of the break that this pod fills. */
  signal?: Signal;
  /** Advertised (or OUT → IN) break length. */
  breakLength?: number;
  /** pod − break, seconds (negative = underfilled). */
  fill?: number;
}

/** Host and directory of a segment URI: where the content comes from. */
export function originOf(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname.replace(/\/[^/]*$/, '')}`;
  } catch {
    return uri.replace(/\/[^/]*$/, '');
  }
}

/** Splits an HLS media playlist into runs at discontinuities and origin changes. */
export function hlsRuns(info: HlsPlaylistInfo): ContentRun[] {
  const runs: ContentRun[] = [];
  let cur: ContentRun | null = null;
  for (const s of info.segments) {
    const origin = originOf(s.uri);
    if (!cur || s.discontinuity || origin !== cur.origin) {
      cur = {
        key: s.date ? `d${Math.round(s.date.getTime() / 100)}` : `o${s.offset.toFixed(1)}`,
        origin,
        start: null,
        duration: 0,
        segments: 0,
        date: s.date,
        offset: s.offset,
        firstUri: s.uri,
        source: 'HLS discontinuity',
        discontinuity: s.discontinuity,
      };
      runs.push(cur);
    }
    cur.duration += s.duration;
    cur.segments++;
  }
  return runs;
}

/** xs:duration (PT1H2M3.5S) to seconds. */
export function isoDuration(v: string | undefined): number | undefined {
  const m = v?.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return undefined;
  const [, d, hh, mm, ss] = m.map((x) => (x ? Number(x) : 0));
  return d * 86400 + hh * 3600 + mm * 60 + ss;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

/** DASH periods with their start, duration and origin (from BaseURL / SegmentTemplate). */
export function dashRuns(mpd: string, mpdUri: string): ContentRun[] {
  const runs: ContentRun[] = [];
  const top = mpd.split(/<(?:\w+:)?Period\b/)[0];
  const mpdBase = new URL(top.match(/<(?:\w+:)?BaseURL[^>]*>([^<]+)</)?.[1]?.trim() ?? '', mpdUri).toString();
  const total = isoDuration(attr(top.match(/<(?:\w+:)?MPD\b[^>]*>/)?.[0] ?? '', 'mediaPresentationDuration'));
  const re = /<(?:\w+:)?Period\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Period>/g;
  const periods: { id?: string; start?: number; duration?: number; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mpd))) periods.push({ id: attr(m[1], 'id'), start: isoDuration(attr(m[1], 'start')), duration: isoDuration(attr(m[1], 'duration')), body: m[2] });
  let prevEnd = 0;
  periods.forEach((p, i) => {
    const start = p.start ?? prevEnd;
    const next = periods[i + 1]?.start;
    const duration = p.duration ?? (next !== undefined ? next - start : total !== undefined ? total - start : 0);
    prevEnd = start + duration;
    const base = new URL(p.body.match(/<(?:\w+:)?BaseURL[^>]*>([^<]+)</)?.[1]?.trim() ?? '', mpdBase).toString();
    const media = p.body.match(/<(?:\w+:)?SegmentTemplate\b[^>]*\bmedia="([^"]+)"/)?.[1] ?? p.body.match(/<(?:\w+:)?SegmentURL\b[^>]*\bmedia="([^"]+)"/)?.[1] ?? '';
    const first = new URL(media.replace(/\$[^$]*\$/g, '0'), base).toString();
    runs.push({
      key: `p${p.id ?? i}:${start.toFixed(2)}`,
      origin: originOf(first),
      start,
      duration,
      segments: 1,
      firstUri: first,
      source: 'DASH period',
      periodId: p.id,
    });
  });
  return runs;
}

/**
 * Ad pods: runs whose origin differs from the main content's (the origin
 * with the most playing time), merged when back to back; plus interstitials.
 */
export function findPods(runs: ContentRun[], events: ScteEvent[]): AdPod[] {
  const totals = new Map<string, number>();
  for (const r of runs) totals.set(r.origin, (totals.get(r.origin) ?? 0) + r.duration);
  const main = [...totals].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pods: AdPod[] = [];
  const timed = runs.filter((r) => r.start !== null).sort((a, b) => a.start! - b.start!);
  for (const r of timed) {
    // Another origin without a discontinuity is a path change (e.g. dated folders), not an insertion.
    if (totals.size < 2 || r.origin === main || (r.source === 'HLS discontinuity' && !r.discontinuity)) continue;
    const last = pods[pods.length - 1];
    if (last && last.kind === 'inserted' && Math.abs(last.start + last.duration - r.start!) < 0.5) {
      last.ads.push({ origin: r.origin, duration: r.duration, uri: r.firstUri });
      last.duration += r.duration;
    } else {
      pods.push({ start: r.start!, duration: r.duration, kind: 'inserted', ads: [{ origin: r.origin, duration: r.duration, uri: r.firstUri }], source: r.source });
    }
  }
  for (const e of events) {
    const a = e.hls?.attributes;
    if (e.startTime === null || a?.CLASS !== 'com.apple.hls.interstitial') continue;
    const duration = Number(a.DURATION ?? a['X-PLAYOUT-LIMIT'] ?? a['PLANNED-DURATION'] ?? 0) || 0;
    const uri = a['X-ASSET-URI'] ?? a['X-ASSET-LIST'] ?? '';
    pods.push({ start: e.startTime, duration, kind: 'interstitial', ads: [{ origin: uri ? originOf(uri) : '—', duration, uri }], source: 'HLS Interstitial', key: e.key });
  }
  return pods.sort((a, b) => a.start - b.start);
}

/** Matches pods with the OUT/IN break around them. */
export function reportPods(pods: AdPod[], events: ScteEvent[]): PodReport[] {
  const signals = groupSignals(events.filter((e) => e.startTime !== null));
  return pods.map((pod) => {
    const signal = signals.find((s) => s.direction === 'out' && Math.abs(s.time - pod.start) <= 2);
    if (!signal) return { pod };
    const i = signals.indexOf(signal);
    const inSig = signals.slice(i + 1).find((s) => s.direction === 'in');
    const nextOut = signals.slice(i + 1).find((s) => s.direction === 'out');
    const breakLength = signal.duration ?? (inSig && (!nextOut || inSig.time < nextOut.time) ? inSig.time - signal.time : undefined);
    return { pod, signal, breakLength, fill: breakLength !== undefined ? pod.duration - breakLength : undefined };
  });
}

/** Health issues about ad insertion. */
export function podIssues(reports: PodReport[], events: ScteEvent[], horizon: number | null): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const fmt = (s: number) => `${s.toFixed(1)} s`;
  for (const r of reports) {
    if (!r.signal) {
      issues.push({
        severity: 'info',
        code: 'pod-no-marker',
        title: 'Inserted content without a marker',
        detail: `${r.pod.source} at ${fmt(r.pod.start)} (${fmt(r.pod.duration)}, ${r.pod.ads.map((a) => a.origin).join(', ')}) has no SCTE OUT within 2 s.`,
        keys: r.pod.key ? [r.pod.key] : [],
        time: r.pod.start,
      });
    } else if (r.fill !== undefined && Math.abs(r.fill) > 1) {
      issues.push({
        severity: 'warn',
        code: 'pod-fill',
        title: r.fill < 0 ? 'Ad pod shorter than the break (underfill)' : 'Ad pod longer than the break (overfill)',
        detail: `Break ${fmt(r.breakLength!)}, inserted ${fmt(r.pod.duration)} (${r.fill < 0 ? `${fmt(-r.fill)} short` : `${fmt(r.fill)} over`}).`,
        keys: [r.signal.events[0].key],
        time: r.pod.start,
      });
    }
  }
  // Only meaningful once the stream is known to use insertion.
  if (reports.some((r) => r.pod.kind === 'inserted')) {
    const filled = reports.map((r) => r.signal?.time).filter((t): t is number => t !== undefined);
    for (const s of groupSignals(events.filter((e) => e.startTime !== null))) {
      if (s.direction !== 'out' || filled.some((t) => Math.abs(t - s.time) < 0.01) || (horizon !== null && s.time > horizon - 2)) continue;
      issues.push({
        severity: 'info',
        code: 'break-no-pod',
        title: 'Break without inserted content',
        detail: `The break at ${fmt(s.time)} kept the original content (no fill, or slate from the same origin).`,
        keys: [s.events[0].key],
        time: s.time,
      });
    }
  }
  return issues;
}
