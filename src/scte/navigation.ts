import type { ScteEvent } from './monitor';

/**
 * Where to seek for marker and ad-break navigation: next/previous marker,
 * a few seconds before the next break, and the end of the current break.
 */

/** Distinct marker times, sorted (markers within 50 ms count once). */
export function markerTimes(events: ScteEvent[]): number[] {
  const times = events.map((e) => e.startTime).filter((t): t is number => t !== null).sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.05);
}

export function nextMarker(events: ScteEvent[], now: number): number | null {
  return markerTimes(events).find((t) => t > now + 0.25) ?? null;
}

/** Previous marker; pressing again right after a jump goes one further back. */
export function previousMarker(events: ScteEvent[], now: number): number | null {
  const before = markerTimes(events).filter((t) => t < now - 1);
  return before.length ? before[before.length - 1] : null;
}

/** Start of the next break that is more than `preroll` seconds ahead. */
export function nextBreakStart(events: ScteEvent[], now: number, preroll: number): number | null {
  const outs = markerTimes(events.filter((e) => e.direction === 'out'));
  return outs.find((t) => t - preroll > now + 0.5) ?? null;
}

/** End of the break playing at `now`: its advertised end, else the next IN. */
export function breakEnd(events: ScteEvent[], now: number, active: { start: number; end?: number } | null): number | null {
  if (!active) return null;
  if (active.end !== undefined) return active.end;
  const ins = markerTimes(events.filter((e) => e.direction === 'in'));
  return ins.find((t) => t > now) ?? null;
}
