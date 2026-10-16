import { describe, expect, it } from 'vitest';
import { MeterCore, kWeighting, toDb } from '../src/audio/dsp';
import { LoudnessMeter, channelLabels, channelWeights, type LoudnessReading } from '../src/audio/loudness';

const FS = 48000;

/** Feeds `seconds` of a sine per channel (amplitude in dBFS, null = silence) through the meter. */
function run(
  meter: LoudnessMeter,
  core: MeterCore,
  seconds: number,
  levels: (number | null)[],
  freq = 1000,
  phase = 0,
): LoudnessReading {
  let last!: LoudnessReading;
  const frames = 128;
  const total = Math.round(seconds * FS);
  for (let start = 0; start < total; start += frames) {
    const chunk = levels.map((db) => {
      const a = db === null ? 0 : Math.pow(10, db / 20);
      const buf = new Float32Array(frames);
      for (let i = 0; i < frames; i++) buf[i] = a * Math.sin((2 * Math.PI * freq * (start + i)) / FS + phase);
      return buf;
    });
    for (const b of core.process(chunk)) last = meter.push(b);
  }
  return last;
}

describe('K-weighting', () => {
  it('matches the BS.1770-4 48 kHz coefficients', () => {
    const [s1, s2] = kWeighting(48000);
    expect(s1.b0).toBeCloseTo(1.53512485958697, 10);
    expect(s1.b1).toBeCloseTo(-2.69169618940638, 10);
    expect(s1.b2).toBeCloseTo(1.19839281085285, 10);
    expect(s1.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(s1.a2).toBeCloseTo(0.73248077421585, 10);
    expect(s2.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(s2.a2).toBeCloseTo(0.99007225036621, 10);
  });
});

describe('Loudness (EBU Tech 3341)', () => {
  it('test 1: stereo 1 kHz at -23 dBFS reads -23 LUFS (M, S, I)', () => {
    const r = run(new LoudnessMeter(), new MeterCore(FS), 20, [-23, -23]);
    expect(r.momentary).toBeCloseTo(-23, 1);
    expect(r.shortTerm).toBeCloseTo(-23, 1);
    expect(Math.abs(r.integrated + 23)).toBeLessThan(0.1);
  });

  it('test 2: stereo 1 kHz at -33 dBFS reads -33 LUFS', () => {
    const r = run(new LoudnessMeter(), new MeterCore(FS), 20, [-33, -33]);
    expect(Math.abs(r.integrated + 33)).toBeLessThan(0.1);
  });

  it('test 3: -36 / -23 / -36 dBFS sections integrate to -23 LUFS (relative gate)', () => {
    const m = new LoudnessMeter();
    const c = new MeterCore(FS);
    run(m, c, 10, [-36, -36]);
    run(m, c, 60, [-23, -23]);
    const r = run(m, c, 10, [-36, -36]);
    expect(Math.abs(r.integrated + 23)).toBeLessThan(0.1);
  });

  it('test 5: silence is ignored by the absolute gate', () => {
    const m = new LoudnessMeter();
    const c = new MeterCore(FS);
    run(m, c, 20, [-23, -23]);
    const r = run(m, c, 20, [null, null]);
    expect(Math.abs(r.integrated + 23)).toBeLessThan(0.1);
    expect(r.momentary).toBe(-Infinity);
  });

  it('weights 5.1 surrounds by +1.5 dB and ignores the LFE', () => {
    const surround = run(new LoudnessMeter(), new MeterCore(FS), 10, [null, null, null, null, -23, null]);
    expect(Math.abs(surround.integrated - (-23 - 3.01 + 1.49))).toBeLessThan(0.15);
    const lfe = run(new LoudnessMeter(), new MeterCore(FS), 10, [null, null, null, -10, null, null], 60);
    expect(lfe.integrated).toBe(-Infinity);
    expect(lfe.channels.map((ch) => ch.label)).toEqual(['L', 'R', 'C', 'LFE', 'Ls', 'Rs']);
    expect(lfe.channels[3].peak).toBeCloseTo(-10, 0);
  });
});

describe('Loudness range (EBU Tech 3342)', () => {
  it('test 1: 20 s at -20 then 20 s at -30 dBFS gives LRA 10 LU ±1', () => {
    const m = new LoudnessMeter();
    const c = new MeterCore(FS);
    run(m, c, 20, [-20, -20]);
    const r = run(m, c, 20, [-30, -30]);
    expect(Math.abs(r.lra - 10)).toBeLessThanOrEqual(1);
  });
});

describe('Peaks and correlation', () => {
  it('true peak finds the inter-sample peak a sample peak meter misses', () => {
    // fs/4 sine at 45° phase: every sample is at ±0.707 (-3 dBFS), the waveform peaks at 0 dBFS.
    const r = run(new LoudnessMeter(), new MeterCore(FS), 1, [0, 0], FS / 4, Math.PI / 4);
    expect(r.samplePeakMax).toBeCloseTo(-3.01, 1);
    expect(Math.abs(r.truePeakMax)).toBeLessThan(0.5);
  });

  it('reports +1 for identical channels and -1 for inverted ones', () => {
    const same = run(new LoudnessMeter(), new MeterCore(FS), 1, [-20, -20]);
    expect(same.correlation).toBeCloseTo(1, 3);
    const m = new LoudnessMeter();
    const c = new MeterCore(FS);
    let last!: LoudnessReading;
    for (let s = 0; s < FS; s += 128) {
      const l = new Float32Array(128).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * (s + i)) / FS));
      for (const b of c.process([l, l.map((x) => -x)])) last = m.push(b);
    }
    expect(last.correlation).toBeCloseTo(-1, 3);
  });

  it('channel helpers', () => {
    expect(channelLabels(2)).toEqual(['L', 'R']);
    expect(channelWeights(6)).toEqual([1, 1, 1, 0, 1.41, 1.41]);
    expect(toDb(1)).toBe(0);
  });
});
