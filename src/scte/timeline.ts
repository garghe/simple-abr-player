import { SEGMENT_PAIRS, groupSignals, segDescriptors } from './health';
import type { ScteEvent } from './monitor';
import { SEGMENTATION_TYPES } from './scte35';

/**
 * Turns markers into lanes for the timeline view: OUT/IN breaks, and one
 * lane per segmentation family (programme, chapter, break, ad, placement
 * opportunity, promo/credits), with spans from start to end signal.
 */

export type LaneId = 'markers' | 'breaks' | 'programme' | 'chapter' | 'break' | 'ad' | 'po' | 'promo' | 'other';

export const SCTE_LANES: { id: LaneId; label: string }[] = [
  { id: 'markers', label: 'All markers' },
  { id: 'breaks', label: 'OUT → IN breaks' },
  { id: 'programme', label: 'Programme' },
  { id: 'chapter', label: 'Chapter' },
  { id: 'break', label: 'Break (seg.)' },
  { id: 'ad', label: 'Advertisement' },
  { id: 'po', label: 'Placement opp.' },
  { id: 'promo', label: 'Promo / credits' },
  { id: 'other', label: 'Other signals' },
];

export interface TimelineSpan {
  lane: LaneId;
  start: number;
  end: number;
  /** No end signal yet: drawn to the edge. */
  open: boolean;
  label: string;
  keys: string[];
}

export interface TimelinePoint {
  lane: LaneId;
  time: number;
  label: string;
  keys: string[];
  kind: 'out' | 'in' | 'other';
}

export function laneOf(typeId: number): LaneId {
  if (typeId >= 0x10 && typeId <= 0x19) return 'programme';
  if (typeId === 0x20 || typeId === 0x21) return 'chapter';
  if (typeId === 0x22 || typeId === 0x23) return 'break';
  if (typeId >= 0x30 && typeId <= 0x33) return 'ad';
  if ((typeId >= 0x34 && typeId <= 0x3b) || (typeId >= 0x44 && typeId <= 0x47)) return 'po';
  if ((typeId >= 0x24 && typeId <= 0x27) || (typeId >= 0x3c && typeId <= 0x3f)) return 'promo';
  return 'other';
}

const name = (id: number) => SEGMENTATION_TYPES[id] ?? `0x${id.toString(16)}`;

export function buildTimeline(events: ScteEvent[], horizon: number | null): { spans: TimelineSpan[]; points: TimelinePoint[] } {
  const spans: TimelineSpan[] = [];
  const points: TimelinePoint[] = [];
  const timed = events.filter((e) => e.startTime !== null);
  const edge = (t: number) => Math.max(t, horizon ?? t);

  for (const e of timed) points.push({ lane: 'markers', time: e.startTime!, label: e.summary, keys: [e.key], kind: e.direction });

  // OUT → IN breaks (splice_insert and HLS tags).
  const signals = groupSignals(timed);
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s.direction !== 'out') continue;
    const next = signals.slice(i + 1).find((x) => x.direction === 'in' || x.direction === 'out');
    const byDuration = s.duration !== undefined ? s.time + s.duration : undefined;
    const end = next?.direction === 'in' ? next.time : byDuration ?? next?.time;
    spans.push({
      lane: 'breaks',
      start: s.time,
      end: end ?? edge(s.time),
      open: end === undefined,
      label: `${s.events[0].summary}${s.duration !== undefined ? ` · ${s.duration.toFixed(1)} s advertised` : ''}`,
      keys: [...s.events.map((x) => x.key), ...(next?.direction === 'in' ? next.events.map((x) => x.key) : [])],
    });
  }

  // Segmentation descriptors: pair starts with their end type.
  const items = timed.flatMap((e) =>
    segDescriptors(e)
      .filter((d) => !d.cancel && d.segmentationTypeId !== undefined)
      .map((d) => ({ e, d, time: e.startTime!, used: false })),
  );
  items.sort((a, b) => a.time - b.time);
  const dedupe = new Set<string>();
  for (const start of items) {
    const typeId = start.d.segmentationTypeId!;
    const ends = SEGMENT_PAIRS.get(typeId);
    const id = `${typeId}:${start.d.segmentationEventId}:${Math.round(start.time * 2)}`;
    if (dedupe.has(id)) {
      start.used = true;
      continue;
    }
    dedupe.add(id);
    if (!ends) continue;
    start.used = true;
    const candidates = items.filter((i) => !i.used && ends.includes(i.d.segmentationTypeId!) && i.time >= start.time - 0.05);
    const end = candidates.find((i) => i.d.segmentationEventId === start.d.segmentationEventId) ?? candidates[0];
    if (end) end.used = true;
    const dur = start.d.segmentationDuration !== undefined ? start.d.segmentationDuration / 90000 : undefined;
    const stop = end?.time ?? (dur !== undefined ? start.time + dur : undefined);
    spans.push({
      lane: laneOf(typeId),
      start: start.time,
      end: stop ?? edge(start.time),
      open: stop === undefined,
      label: `${name(typeId)} #${start.d.segmentationEventId}${start.d.upid ? ` · ${start.d.upidTypeName}: ${start.d.upid}` : ''}${dur !== undefined ? ` · ${dur.toFixed(1)} s` : ''}`,
      keys: [start.e.key, ...(end ? [end.e.key] : [])],
    });
  }
  for (const i of items) {
    if (i.used) continue;
    const typeId = i.d.segmentationTypeId!;
    points.push({ lane: laneOf(typeId), time: i.time, label: `${name(typeId)} #${i.d.segmentationEventId}`, keys: [i.e.key], kind: 'other' });
  }
  return { spans, points };
}
