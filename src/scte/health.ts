import type { PlaylistCoverage, ScteEvent } from './monitor';
import { SEGMENTATION_TYPES, type SegmentationDescriptor } from './scte35';
import { DEFAULT_MIN_LEAD, markerTiming, median, ptsDiff } from './timing';

/**
 * Health checks over all markers seen so far: break pairing and durations,
 * segmentation start/end pairs, IDs, CRC, markers missing from renditions,
 * and splice timing (lead time, segment alignment, PTS consistency).
 * Pure function of the markers, so it re-runs whenever the list changes.
 */

export type Severity = 'error' | 'warn' | 'info';

export interface HealthIssue {
  severity: Severity;
  /** Stable identifier of the check, e.g. "break-no-in". */
  code: string;
  title: string;
  detail: string;
  /** Markers involved (first one is where to jump). */
  keys: string[];
  time: number | null;
}

export interface HealthContext {
  live: boolean;
  /** Latest presentation time the stream has reached (live edge / duration). */
  horizon: number | null;
  playlists: PlaylistCoverage[];
  /** Warn when a marker arrives less than this many seconds before its splice. */
  minLead?: number;
  /** Video frame duration, for alignment tolerance. */
  frameDuration?: number;
}

/** Seconds of difference tolerated between an advertised and an actual break length. */
const DURATION_TOLERANCE = 1;
/** Signals of the same break from different sources (e.g. DATERANGE + CUE-OUT) within this window are merged. */
const SAME_SIGNAL = 0.5;

const fmt = (s: number) => `${s.toFixed(s < 10 ? 2 : 1)} s`;
const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const typeName = (id: number) => `${SEGMENTATION_TYPES[id] ?? 'Type'} (${hex(id)})`;

/** Segmentation start types and the end types that close them. */
export const SEGMENT_PAIRS = new Map<number, number[]>([
  [0x10, [0x11, 0x12]],
  [0x20, [0x21]],
  [0x22, [0x23]],
  [0x24, [0x25]],
  [0x26, [0x27]],
  [0x50, [0x51]],
]);
for (let t = 0x30; t <= 0x46; t += 2) SEGMENT_PAIRS.set(t, [t + 1]);
const END_TYPES = new Set([...SEGMENT_PAIRS.values()].flat());

export interface Signal {
  time: number;
  direction: 'out' | 'in';
  events: ScteEvent[];
  duration?: number;
  spliceIds: number[];
}

/** splice_insert (or plain HLS tags): the classic OUT/IN break signalling. */
function isBreakSignal(e: ScteEvent): boolean {
  if (e.direction === 'other' || e.startTime === null) return false;
  const cmd = e.section?.command;
  if (cmd) return cmd.type === 'splice_insert' && !cmd.cancel;
  return !e.error; // CUE-OUT / CUE-IN / DATERANGE without a payload
}

export function groupSignals(events: ScteEvent[]): Signal[] {
  const out: Signal[] = [];
  for (const e of events.filter(isBreakSignal).sort((a, b) => a.startTime! - b.startTime!)) {
    const dir = e.direction as 'out' | 'in';
    const last = [...out].reverse().find((s) => s.direction === dir);
    const cmd = e.section?.command;
    const id = cmd?.type === 'splice_insert' ? cmd.spliceEventId : undefined;
    if (last && e.startTime! - last.time <= SAME_SIGNAL && out[out.length - 1] === last) {
      last.events.push(e);
      if (last.duration === undefined) last.duration = e.duration;
      if (id !== undefined && !last.spliceIds.includes(id)) last.spliceIds.push(id);
      continue;
    }
    out.push({ time: e.startTime!, direction: dir, events: [e], duration: e.duration, spliceIds: id !== undefined ? [id] : [] });
  }
  return out;
}

export function checkScteHealth(all: ScteEvent[], ctx: HealthContext): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const add = (severity: Severity, code: string, title: string, detail: string, events: ScteEvent[]) =>
    issues.push({ severity, code, title, detail, keys: events.map((e) => e.key), time: events[0]?.startTime ?? null });
  const events = all.filter((e) => e.source !== 'HLS CUE-OUT-CONT' || e.direction === 'out');

  // ---------------------------------------------------------------- messages
  for (const e of events) {
    if (e.error) add('error', 'undecodable', 'Message cannot be decoded', e.error, [e]);
    else if (e.section && !e.section.crcValid) add('error', 'crc', 'CRC mismatch', 'The CRC-32 at the end of the message does not match its contents: the message was altered or truncated.', [e]);
    if (e.section?.encrypted) add('info', 'encrypted', 'Encrypted message', 'The splice command is encrypted, so it cannot be checked.', [e]);
    const cmd = e.section?.command;
    if (cmd?.type === 'splice_insert' && cmd.cancel) {
      const target = events.find((x) => x !== e && x.section?.command.type === 'splice_insert' && (x.section.command as { spliceEventId: number }).spliceEventId === cmd.spliceEventId);
      add('info', 'cancel', `Splice event #${cmd.spliceEventId} cancelled`, target ? 'An earlier marker with this event ID is withdrawn.' : 'No earlier marker with this event ID was seen.', target ? [e, target] : [e]);
    }
    for (const d of segDescriptors(e)) {
      if (d.cancel) add('info', 'cancel', `Segmentation event #${d.segmentationEventId} cancelled`, 'A segmentation descriptor with the cancel flag set.', [e]);
      if (d.segmentsExpected && d.segmentNum !== undefined && d.segmentNum > d.segmentsExpected) {
        add('warn', 'segment-num', 'Segment number out of range', `${typeName(d.segmentationTypeId!)}: segment_num ${d.segmentNum} of ${d.segmentsExpected} expected.`, [e]);
      }
      if (d.subSegmentsExpected && d.subSegmentNum !== undefined && d.subSegmentNum > d.subSegmentsExpected) {
        add('warn', 'segment-num', 'Sub-segment number out of range', `${typeName(d.segmentationTypeId!)}: sub_segment_num ${d.subSegmentNum} of ${d.subSegmentsExpected} expected.`, [e]);
      }
    }
  }

  // ---------------------------------------------------------- OUT/IN breaks
  const signals = groupSignals(events);
  let open: Signal | null = null;
  const firstSignal = signals[0];
  for (const sig of signals) {
    const durations = [...new Set(sig.events.map((e) => e.duration).filter((d): d is number => d !== undefined).map((d) => d.toFixed(1)))];
    if (durations.length > 1) {
      add('warn', 'duration-disagree', 'Signals of one break disagree on its length', `${sig.events.map((e) => `${e.source}: ${e.duration !== undefined ? fmt(e.duration) : '—'}`).join(' · ')}`, sig.events);
    }
    if (sig.direction === 'out') {
      if (open) {
        const endByDuration = open.duration !== undefined ? open.time + open.duration : undefined;
        if (endByDuration === undefined || endByDuration > sig.time + DURATION_TOLERANCE) {
          add(
            'warn',
            'break-overlap',
            'New break starts before the previous one ended',
            `OUT at ${fmt(sig.time)} while the break from ${fmt(open.time)} is still open${endByDuration !== undefined ? ` (advertised until ${fmt(endByDuration)})` : ' (no IN and no duration)'}.`,
            [sig.events[0], open.events[0]],
          );
        }
      }
      open = sig;
    } else {
      if (!open) {
        const joined = ctx.live && sig === firstSignal;
        add(
          joined ? 'info' : 'warn',
          'in-without-out',
          'IN without an OUT',
          joined ? 'The first marker seen is an IN: playback probably joined during a break.' : `IN at ${fmt(sig.time)} with no open break before it.`,
          sig.events,
        );
        continue;
      }
      if (open.duration !== undefined) {
        const actual = sig.time - open.time;
        const diff = actual - open.duration;
        if (Math.abs(diff) > DURATION_TOLERANCE) {
          add(
            'warn',
            'duration-mismatch',
            'Break length differs from the advertised duration',
            `Advertised ${fmt(open.duration)}, IN after ${fmt(actual)} (${diff < 0 ? `${fmt(-diff)} early` : `${fmt(diff)} late`}).`,
            [open.events[0], sig.events[0]],
          );
        }
      }
      open = null;
    }
  }
  if (open && open.duration === undefined) {
    const finished = !ctx.live && ctx.horizon !== null;
    add(
      finished ? 'warn' : 'info',
      'break-no-in',
      finished ? 'OUT without an IN' : 'Break open',
      finished ? `The break from ${fmt(open.time)} has no IN and no duration, so it never ends.` : `No duration given: the break from ${fmt(open.time)} lasts until an IN arrives.`,
      open.events,
    );
  }

  // Event IDs reused for different breaks.
  const byId = new Map<number, Signal[]>();
  for (const s of signals.filter((x) => x.direction === 'out')) for (const id of s.spliceIds) byId.set(id, [...(byId.get(id) ?? []), s]);
  for (const [id, list] of byId) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      if (list[i].time - prev.time > (prev.duration ?? 0) + 2) {
        add('info', 'id-reused', `Splice event #${id} reused`, `The same splice_event_id starts breaks at ${fmt(prev.time)} and ${fmt(list[i].time)}. IDs should be unique while a break can still be referenced.`, [list[i].events[0], prev.events[0]]);
      }
    }
  }

  // ------------------------------------------------------- segmentation pairs
  checkSegmentation(events, ctx, add);

  // ------------------------------------------------------------- HLS details
  for (const e of events) {
    const a = e.hls?.attributes;
    if (e.source === 'HLS DATERANGE' && a) {
      const start = a['START-DATE'] ? Date.parse(a['START-DATE']) : NaN;
      const end = a['END-DATE'] ? Date.parse(a['END-DATE']) : NaN;
      const dur = a.DURATION !== undefined ? Number(a.DURATION) : NaN;
      if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(dur) && Math.abs((end - start) / 1000 - dur) > 0.1) {
        add('warn', 'daterange-end', 'DATERANGE END-DATE and DURATION disagree', `END-DATE is ${fmt((end - start) / 1000)} after START-DATE, DURATION says ${fmt(dur)}.`, [e]);
      }
      const planned = a['PLANNED-DURATION'] !== undefined ? Number(a['PLANNED-DURATION']) : NaN;
      if (Number.isFinite(planned) && Number.isFinite(dur) && Math.abs(planned - dur) > DURATION_TOLERANCE) {
        add('info', 'daterange-planned', 'Break ran shorter or longer than planned', `PLANNED-DURATION ${fmt(planned)}, DURATION ${fmt(dur)}.`, [e]);
      }
    }
    const worst = (e.contChecks ?? []).reduce<{ elapsed: number; actual: number } | null>(
      (w, c) => (!w || Math.abs(c.elapsed - c.actual) > Math.abs(w.elapsed - w.actual) ? c : w),
      null,
    );
    if (worst && Math.abs(worst.elapsed - worst.actual) > DURATION_TOLERANCE) {
      add('warn', 'cont-elapsed', 'CUE-OUT-CONT elapsed time is wrong', `A CUE-OUT-CONT says ${fmt(worst.elapsed)} elapsed, but its segment is ${fmt(worst.actual)} after the CUE-OUT.`, [e]);
    }
  }

  // --------------------------------------------------- missing in renditions
  const playlists = ctx.playlists.filter((p) => p.kind !== 'subtitles');
  if (playlists.length > 1) {
    for (const e of events) {
      if (!e.hls || !e.seenIn.length || e.source === 'HLS CUE-OUT-CONT') continue;
      const missing = playlists.filter((p) => !e.seenIn.includes(p.uri) && covers(p, e));
      if (!missing.length) continue;
      const videoMissing = missing.some((p) => p.kind !== 'audio');
      add(
        videoMissing ? 'warn' : 'info',
        'missing-rendition',
        `Marker missing from ${missing.length} playlist${missing.length > 1 ? 's' : ''}`,
        `Not in ${missing.map((p) => p.label).join(', ')}, though ${missing.length > 1 ? 'they cover' : 'it covers'} that time. Players and SSAI read one playlist, so they may miss the break.${videoMissing ? '' : ' (Audio-only playlists: some packagers mark only video.)'}`,
        [e],
      );
    }
  }

  // ------------------------------------------------------------------ timing
  const minLead = ctx.minLead ?? DEFAULT_MIN_LEAD;
  const tolerance = Math.max(ctx.frameDuration ?? 0, 0.04);
  const ptsOffsets: { e: ScteEvent; d: number }[] = [];
  for (const e of events) {
    const t = markerTiming(e);
    const relevant = e.direction !== 'other';
    if (t.lead !== undefined && relevant) {
      if (t.lead < -tolerance) {
        add('error', 'late', 'Marker arrived after its splice time', `Seen ${fmt(-t.lead)} after the splice point (measured against the ${t.leadBasis}). Ad systems need it before the splice.`, [e]);
      } else if (t.lead < minLead) {
        add('warn', 'short-lead', 'Short lead time', `Seen only ${fmt(Math.max(0, t.lead))} before the splice (measured against the ${t.leadBasis}); ${minLead} s or more is usually needed.`, [e]);
      }
    }
    if (relevant && t.boundaryDistance !== undefined && t.boundaryDistance > tolerance && t.segmentOffset !== undefined) {
      add(
        'warn',
        'unaligned',
        'Splice not on a segment boundary',
        `${fmt(t.segmentOffset)} into a ${fmt(t.segmentDuration ?? 0)} segment. Segment-based players and SSAI switch at segment starts, so the splice lands ${fmt(t.boundaryDistance)} off.`,
        [e],
      );
    } else if (relevant && t.boundaryDistance === undefined && t.dateRangeOffset !== undefined && Math.abs(t.dateRangeOffset) > tolerance) {
      add('warn', 'unaligned', 'DATERANGE starts mid-segment', `START-DATE is ${fmt(t.dateRangeOffset)} after the PROGRAM-DATE-TIME of its segment.`, [e]);
    }
    if (t.spliceSeconds !== undefined && e.startTime !== null && !t.immediate && e.source !== 'HLS CUE-OUT-CONT') {
      ptsOffsets.push({ e, d: t.spliceSeconds - e.startTime });
    }
  }
  // The PTS clock and the player timeline differ by a constant per stream; an outlier is mis-timed.
  if (ptsOffsets.length >= 3) {
    const ref = median(ptsOffsets.map((p) => p.d))!;
    for (const { e, d } of ptsOffsets) {
      const dev = ptsDiff(d, ref);
      if (Math.abs(dev) > Math.max(tolerance, 0.1)) {
        add('warn', 'pts-offset', 'Splice time in the message does not match the marker position', `Its splice_time is ${fmt(Math.abs(dev))} ${dev > 0 ? 'later' : 'earlier'} than the stream's other markers suggest for this position.`, [e]);
      }
    }
  }

  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.time ?? Infinity) - (b.time ?? Infinity));
}

export function segDescriptors(e: ScteEvent): SegmentationDescriptor[] {
  return (e.section?.descriptors ?? []).filter((d): d is SegmentationDescriptor => d.tag === 0x02 && 'segmentationEventId' in d);
}

/** Does this playlist list the time of the marker (so it should carry it too)? */
function covers(p: PlaylistCoverage, e: ScteEvent): boolean {
  const margin = (p.targetDuration ?? 2) * 1000;
  const date = e.hls?.date?.getTime();
  if (date !== undefined && p.firstDate !== undefined && p.lastDate !== undefined) {
    return date >= p.firstDate + margin && date <= p.lastDate - margin;
  }
  if (!p.live && p.duration !== undefined && e.hls) return e.hls.playlistOffset < p.duration - 0.5;
  return false;
}

type Add = (severity: Severity, code: string, title: string, detail: string, events: ScteEvent[]) => void;

function checkSegmentation(events: ScteEvent[], ctx: HealthContext, add: Add) {
  interface Item {
    e: ScteEvent;
    d: SegmentationDescriptor;
    time: number;
    used?: boolean;
  }
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const e of events) {
    if (e.startTime === null) continue;
    for (const d of segDescriptors(e)) {
      if (d.cancel || d.segmentationTypeId === undefined) continue;
      // Repeated messages for the same event (common before a splice) count once.
      const k = `${d.segmentationTypeId}:${d.segmentationEventId}:${Math.round(e.startTime * 2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ e, d, time: e.startTime });
    }
  }
  items.sort((a, b) => a.time - b.time);
  const firstTime = items[0]?.time;

  for (const start of items) {
    const ends = SEGMENT_PAIRS.get(start.d.segmentationTypeId!);
    if (!ends) continue;
    const candidates = items.filter((i) => !i.used && ends.includes(i.d.segmentationTypeId!) && i.time >= start.time - 0.05);
    const end = candidates.find((i) => i.d.segmentationEventId === start.d.segmentationEventId) ?? candidates[0];
    const name = typeName(start.d.segmentationTypeId!);
    const dur = start.d.segmentationDuration !== undefined ? start.d.segmentationDuration / 90000 : undefined;
    if (end) {
      end.used = true;
      if (end.d.segmentationEventId !== start.d.segmentationEventId) {
        add('info', 'seg-id-mismatch', 'End signal has a different event ID', `${name} #${start.d.segmentationEventId} is closed by ${typeName(end.d.segmentationTypeId!)} #${end.d.segmentationEventId}.`, [start.e, end.e]);
      }
      if (dur !== undefined) {
        const actual = end.time - start.time;
        if (Math.abs(actual - dur) > DURATION_TOLERANCE) {
          add('warn', 'seg-duration', 'Segment length differs from its duration', `${name}: duration ${fmt(dur)}, end signal after ${fmt(actual)}.`, [start.e, end.e]);
        }
      }
      continue;
    }
    const reached = ctx.horizon !== null && ctx.horizon > start.time + (dur ?? 0) + DURATION_TOLERANCE;
    if (dur !== undefined) {
      if (reached) add('info', 'seg-no-end', 'No end signal (ended by duration)', `${name} #${start.d.segmentationEventId} has a ${fmt(dur)} duration but no ${typeName(ends[0])}.`, [start.e]);
    } else if (reached && !ctx.live) {
      add('warn', 'seg-no-end', 'Segment never ends', `${name} #${start.d.segmentationEventId} has no duration and no ${typeName(ends[0])}.`, [start.e]);
    }
  }
  for (const end of items) {
    if (end.used || !END_TYPES.has(end.d.segmentationTypeId!)) continue;
    // Program Early Termination may legitimately follow an already closed program.
    const beforeJoin = ctx.live && end.time - (firstTime ?? end.time) < 1 && items.indexOf(end) === 0;
    add(
      beforeJoin ? 'info' : 'warn',
      'seg-no-start',
      'End signal without a start',
      beforeJoin
        ? `${typeName(end.d.segmentationTypeId!)} is the first signal seen: its start was probably before playback joined.`
        : `${typeName(end.d.segmentationTypeId!)} #${end.d.segmentationEventId} closes nothing that was open.`,
      [end.e],
    );
  }
}
