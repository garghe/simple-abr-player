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

  it('a still test card with a ticking clock is not frozen', () => {
    const m = new AlarmMonitor();
    // Whole-frame change under the threshold, but the clock digits change a lot locally.
    run(m, 30, 0, (now) => m.picture({ luma: 0.5, change: 0.0015, maxChange: 0.4 }, now, now / 1000, true));
    expect(m.active.has('freeze')).toBe(false);
    // Small changes every other sample, as when digits barely differ: still never 5 s in a row.
    const k = new AlarmMonitor();
    let i = 0;
    run(k, 30, 0, (now) => k.picture({ luma: 0.5, change: i++ % 2 ? 0.001 : 0.004, maxChange: 0.05 }, now, now / 1000, true));
    expect(k.active.has('freeze')).toBe(false);
  });

  it('finds the clock in real frames', () => {
    // 8×8 grey frame; a 2×2 "digit" flips between black and white.
    const grey = (digit: number) => new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => (i === 0 || i === 1 || i === 8 || i === 9 ? digit : 128)).flatMap((y) => [y, y, y, 255]));
    const a = frameStats(grey(0), null);
    const b = frameStats(grey(255), a.luma);
    expect(b.stats.change! * 100).toBeGreaterThan(0.2);
    expect(b.stats.maxChange).toBeCloseTo(1, 5);
    const c = frameStats(grey(255), b.luma);
    expect(c.stats.maxChange).toBeCloseTo(0, 6);
  });

  it('a dark scene with visible detail is not black; a logo in a corner does not stop black', () => {
    const m = new AlarmMonitor();
    run(m, 10, 0, (now) => m.picture({ luma: 0.01, change: 0.01, peak: 0.5 }, now, now / 1000, true));
    expect(m.active.has('black')).toBe(false);
    // 32×18 black frame with a bright 2×2 logo top-left (a corner) → still black.
    const logo = new Uint8ClampedArray(Array.from({ length: 576 }, (_, i) => ((i % 32) < 2 && i < 64 ? 255 : 0)).flatMap((y) => [y, y, y, 255]));
    expect(frameStats(logo, null, 32).stats.peak).toBe(0);
    // The same spot in the middle (a star, a ship) counts.
    const star = new Uint8ClampedArray(Array.from({ length: 576 }, (_, i) => (i === 9 * 32 + 16 ? 255 : 0)).flatMap((y) => [y, y, y, 255]));
    expect(frameStats(star, null, 32).stats.peak).toBeCloseTo(1, 5);
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

  it('does not call a tone with short beeps silent (beep every second)', () => {
    const m = new AlarmMonitor();
    // 100 ms readings: a 200 ms beep at the start of every second, digital silence otherwise.
    for (let t = 0; t <= 40000; t += 100) m.audio(reading(t % 1000 < 200 ? [-12, -12] : [-120, -120]), t, t / 1000, -23);
    expect(m.active.has('silence')).toBe(false);
    expect(m.log.filter((e) => e.type === 'silence')).toHaveLength(0);
  });

  it('a raised alarm survives brief breaks and clears after 1 s without the condition', () => {
    const m = new AlarmMonitor();
    let t = run(m, 6, 0, (now) => m.audio(reading([-90, -90]), now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(true);
    m.audio(reading([-20, -20]), t + 250, (t + 250) / 1000, -23); // one loud block
    t = run(m, 2, t + 500, (now) => m.audio(reading([-90, -90]), now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(true);
    run(m, 1.5, t, (now) => m.audio(reading([-20, -20]), now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(false);
  });

  it('judges phase only on real audio, not on the near-silence between beeps', () => {
    // In-phase beeps (+0.95) with noise between them whose correlation is meaningless (−0.74).
    const m = new AlarmMonitor();
    for (let t = 0; t <= 30000; t += 100) {
      const beep = t % 1000 < 200;
      m.audio(reading(beep ? [-12, -12] : [-69, -69], { shortTerm: -23, correlation: beep ? 0.95 : -0.74 }), t, t / 1000, -23);
    }
    expect(m.active.has('phase')).toBe(false);
    // Out-of-phase beeps raise it, even with quiet gaps in between.
    const k = new AlarmMonitor();
    for (let t = 0; t <= 30000; t += 100) {
      const beep = t % 1000 < 200;
      k.audio(reading(beep ? [-12, -12] : [-69, -69], { shortTerm: -23, correlation: beep ? -0.9 : 0.2 }), t, t / 1000, -23);
    }
    expect(k.active.has('phase')).toBe(true);
  });

  it('holds state while no audio can be measured', () => {
    const m = new AlarmMonitor();
    let t = run(m, 6, 0, (now) => m.audio(reading([-90, -90]), now, now / 1000, -23));
    t = run(m, 5, t, (now) => m.audio(null, now, now / 1000, -23));
    expect(m.active.has('silence')).toBe(true);
  });
});
