import { describe, expect, it } from 'vitest';
import type { ScteEvent } from '../src/scte/monitor';
import { breakEnd, markerTimes, nextBreakStart, nextMarker, previousMarker } from '../src/scte/navigation';

const ev = (startTime: number | null, direction: ScteEvent['direction']): ScteEvent =>
  ({ key: `${startTime}${direction}`, seq: 0, source: 'HLS CUE-OUT', receivedAt: new Date(), startTime, direction, summary: '', raw: '', meta: {}, seenIn: [] }) as ScteEvent;

const events = [ev(10, 'out'), ev(10.01, 'out'), ev(40, 'in'), ev(60, 'other'), ev(90, 'out'), ev(null, 'out')];

describe('marker navigation', () => {
  it('merges markers at the same time and skips unresolved ones', () => {
    expect(markerTimes(events)).toEqual([10, 40, 60, 90]);
  });

  it('finds the next and previous marker', () => {
    expect(nextMarker(events, 0)).toBe(10);
    expect(nextMarker(events, 10)).toBe(40);
    expect(nextMarker(events, 95)).toBeNull();
    expect(previousMarker(events, 40.5)).toBe(10);
    expect(previousMarker(events, 41.5)).toBe(40);
  });

  it('lands before the next break, then the one after', () => {
    expect(nextBreakStart(events, 0, 5)).toBe(10);
    expect(nextBreakStart(events, 5, 5)).toBe(90);
  });

  it('finds the end of the current break', () => {
    expect(breakEnd(events, 20, { start: 10, end: 30 })).toBe(30);
    expect(breakEnd(events, 20, { start: 10 })).toBe(40);
    expect(breakEnd(events, 20, null)).toBeNull();
  });
});
