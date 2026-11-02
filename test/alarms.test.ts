import { describe, expect, it } from 'vitest';
import { AlarmMonitor, frameStats, type AlarmEvent } from '../src/alarms/monitor';
import type { LoudnessReading } from '../src/audio/loudness';

const frame = (y: number, n = 16) => new Uint8ClampedArray(Array.from({ length: n }, () => [y, y, y, 255]).flat());

function reading(peaks: number[], o: Partial<LoudnessReading> = {}): LoudnessReading {
  const labels = peaks.length === 6 ? ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] : ['L', 'R'];
  return {
    channels: peaks.map((p, i) => ({ label: labels[i], peak: p, hold: p, rms: p - 3 })),
    momentary: -23,
    shortTerm: -23,
    integrated: -23,
    lra: 5,
    truePeakMax: -6,
    samplePeakMax: -6,
    correlation: 0.8,
    duration: 10,
    ...o,
  };
}

/** Feeds the same input every 250 ms for `seconds`, from `start` ms. */
function run(_m: AlarmMonitor, seconds: number, start: number, feed: (now: number) => void) {
  for (let t = start; t <= start + seconds * 1000; t += 250) feed(t);
  return start + seconds * 1000;
}

describe('frame statistics', () => {
  it('computes luma and change', () => {
    const a = frameStats(frame(0), null);
    expect(a.stats.luma).toBe(0);
    expect(a.stats.change).toBeNull();
    const b = frameStats(frame(255), a.luma);
    expect(b.stats.luma).toBeCloseTo(1, 5);
    expect(b.stats.change).toBeCloseTo(1, 5);
  });
});

describe('picture alarms', () => {
  it('raises black after the hold time and clears it', () => {
    const m = new AlarmMonitor();
    const events: [string, boolean][] = [];
    m.onAlarm((e, raised) => events.push([e.type, raised]));
    let t = run(m, 1.5, 0, (now) => m.picture({ luma: 0.01, change: 0 }, now, now / 1000, true));
    expect(m.active.has('black')).toBe(false);
    t = run(m, 1, t, (now) => m.picture({ luma: 0.01, change: 0 }, now, now / 1000, true));
    expect(m.active.has('black')).toBe(true);
    expect(m.log[0].start.getTime()).toBe(0);
    run(m, 2, t, (now) => m.picture({ luma: 0.5, change: 0.05 }, now, now / 1000, true));
    expect(m.active.has('black')).toBe(false);
    expect(m.log[0].end).toBeDefined();
    expect(events).toEqual([['black', true], ['black', false]]);
  });

  it('raises freeze only while the playhead advances, never for black', () => {
    const m = new AlarmMonitor();
    run(m, 10, 0, (now) => m.picture({ luma: 0.5, change: 0 }, now, 0, false));
    expect(m.active.has('freeze')).toBe(false);
    run(m, 6, 20000, (now) => m.picture({ luma: 0.5, change: 0 }, now, now / 1000, true));
    expect(m.active.has('freeze')).toBe(true);
    const k = new AlarmMonitor();
    run(k, 10, 0, (now) => k.picture({ luma: 0.0, change: 0 }, now, now / 1000, true));
    expect(k.active.has('freeze')).toBe(false);
    expect(k.active.has('black')).toBe(true);
  });

  it('respects disabled alarms', () => {
    const m = new AlarmMonitor();
    m.settings.enabled.black = false;
    run(m, 5, 0, (now) => m.picture({ luma: 0, change: 0 }, now, now / 1000, true));
    expect(m.active.size).toBe(0);
  });
});

describe('sound alarms', () => {
  it('raises silence and a lost channel', () => {
    const m = new AlarmMonitor();
    run(m, 6, 0, (now) => m.audio(reading([-90, -90]), now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(true);
    const c = new AlarmMonitor();
    run(c, 11, 0, (now) => c.audio(reading([-20, -20, -90, -30, -25, -25]), now, now / 1000, -23));
    expect(c.active.has('channel')).toBe(true);
    expect(c.active.get('channel')!.detail).toContain('C silent');
    expect(c.active.has('silence')).toBe(false);
  });

  it('ignores a quiet LFE', () => {
    const m = new AlarmMonitor();
    run(m, 11, 0, (now) => m.audio(reading([-20, -20, -18, -90, -25, -25]), now, now / 1000, -23));
    expect(m.active.has('channel')).toBe(false);
  });

  it('raises loudness off target, phase and true peaks', () => {
    const m = new AlarmMonitor();
    const seen: AlarmEvent[] = [];
    m.onAlarm((e, raised) => raised && seen.push(e));
    run(m, 21, 0, (now) => m.audio(reading([-10, -10], { shortTerm: -14, correlation: -0.6, truePeakMax: now > 5000 ? 0.4 : -3 }), now, now / 1000, -23));
    expect(m.active.has('loudness')).toBe(true);
    expect(m.active.has('phase')).toBe(true);
    expect(seen.filter((e) => e.type === 'peak')).toHaveLength(1);
    expect(seen.find((e) => e.type === 'peak')!.detail).toContain('0.4 dBTP');
  });

  it('measures in presentation time and restarts after a seek', () => {
    const m = new AlarmMonitor();
    // 4× playback: 1 s of wall time is 4 s of content.
    run(m, 0.75, 0, (now) => m.picture({ luma: 0, change: 0 }, now, (now / 1000) * 4, true));
    expect(m.active.has('black')).toBe(true);
    m.picture({ luma: 0, change: 0 }, 2000, 30, true);
    expect(m.active.has('black')).toBe(false);
    expect(m.log[0].end).toBeDefined();
  });

  it('holds state while no audio can be measured', () => {
    const m = new AlarmMonitor();
    let t = run(m, 6, 0, (now) => m.audio(reading([-90, -90]), now, now / 1000, -23));
    t = run(m, 5, t, (now) => m.audio(null, now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(true);
  });
});
