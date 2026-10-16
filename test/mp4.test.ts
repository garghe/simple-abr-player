import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAudioInit, parseMediaSamples } from '../src/audio/mp4';

const dir = join(__dirname, '..', 'public', 'samples', 'scte-demo');
const read = (f: string) => new Uint8Array(readFileSync(join(dir, f)));

describe('fMP4 audio parsing (bundled sample)', () => {
  it('reads the stereo Opus init segment', () => {
    const cfg = parseAudioInit(read('init-stream2.m4s'))!;
    expect(cfg.codec).toBe('opus');
    expect(cfg.channels).toBe(2);
    expect(cfg.sampleRate).toBe(48000);
    expect(String.fromCharCode(...cfg.description!.subarray(0, 8))).toBe('OpusHead');
  });

  it('reads the 5.1 Opus init segment with its channel mapping', () => {
    const cfg = parseAudioInit(read('init-stream4.m4s'))!;
    expect(cfg.channels).toBe(6);
    const head = cfg.description!;
    expect(head[9]).toBe(6); // channel count
    expect(head[18]).toBe(1); // mapping family 1
    expect(head.length).toBe(19 + 2 + 6); // + stream count, coupled count, mapping table
  });

  it('ignores video init segments', () => {
    expect(parseAudioInit(read('init-stream0.m4s'))).toBeNull();
  });

  it('lists the samples of a 2 s media segment', () => {
    const cfg = parseAudioInit(read('init-stream4.m4s'))!;
    const seg = read('chunk-stream4-00005.m4s');
    const samples = parseMediaSamples(seg, cfg);
    const seconds = samples.reduce((n, s) => n + s.duration, 0) / cfg.timescale;
    expect(seconds).toBeCloseTo(2, 1);
    for (const s of samples) expect(s.offset + s.size).toBeLessThanOrEqual(seg.length);
  });
});
