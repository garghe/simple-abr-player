import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCodecs, parseFragments, parseInit, parseTs, segmentTiming } from '../src/media/segment';

const sample = (f: string) => new Uint8Array(readFileSync(`public/samples/scte-demo/${f}`));

describe('fMP4', () => {
  it('reads tracks and real codec strings from init segments', () => {
    const video = parseInit(sample('init-stream1.m4s'))!;
    expect(video.tracks).toHaveLength(1);
    expect(video.tracks[0]).toMatchObject({ handler: 'vide', fourcc: 'vp09', width: 854, height: 480, encrypted: false });
    expect(video.tracks[0].codec).toMatch(/^vp09\.00\.\d\d\.08$/);
    const audio = parseInit(sample('init-stream2.m4s'))!;
    expect(audio.tracks[0]).toMatchObject({ handler: 'soun', fourcc: 'Opus', codec: 'opus' });
    expect(parseInit(sample('chunk-stream1-00001.m4s'))).toBeNull();
  });

  it('reads decode time, duration and keyframe of media segments', () => {
    const init = parseInit(sample('init-stream1.m4s'));
    const t3 = segmentTiming(sample('chunk-stream1-00003.m4s'), init)!;
    expect(t3.format).toBe('fmp4');
    expect(t3.start).toBeCloseTo(4, 2);
    expect(t3.duration).toBeCloseTo(2, 2);
    expect(t3.startsWithKeyframe).toBe(true);
    expect(parseFragments(sample('chunk-stream1-00003.m4s'), init)[0].samples).toBeGreaterThan(10);
  });
});

/** Builds a minimal TS segment: PAT, PMT with one H.264 stream, and PES packets with PTS. */
function tsSegment(frames: { pts: number; idr: boolean }[]): Uint8Array {
  const packets: number[][] = [];
  const packet = (pid: number, pusi: boolean, payload: number[]) => {
    const p = [0x47, (pusi ? 0x40 : 0) | (pid >> 8), pid & 0xff, 0x10, ...payload];
    while (p.length < 188) p.push(0xff);
    packets.push(p.slice(0, 188));
  };
  packet(0, true, [0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | 0x10, 0x00, 0, 0, 0, 0]);
  packet(0x1000, true, [0, 0x02, 0xb0, 18, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0, 0x1b, 0xe1, 0x00, 0xf0, 0, 0, 0, 0, 0]);
  for (const f of frames) {
    const pts = f.pts * 90000;
    const b = [
      0x21 | (Math.floor(pts / 2 ** 30) & 7) * 2,
      Math.floor(pts / 2 ** 22) & 0xff,
      ((Math.floor(pts / 2 ** 15) & 0x7f) << 1) | 1,
      Math.floor(pts / 2 ** 7) & 0xff,
      ((pts & 0x7f) << 1) | 1,
    ];
    packet(0x100, true, [0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, ...b, 0, 0, 0, 1, 0x09, 0xf0, 0, 0, 0, 1, f.idr ? 0x65 : 0x41, 0x88]);
  }
  return Uint8Array.from(packets.flat());
}

describe('MPEG-2 TS', () => {
  it('reads PTS, duration and IDR', () => {
    const frames = Array.from({ length: 50 }, (_, i) => ({ pts: 10 + i * 0.04, idr: i === 0 }));
    const t = parseTs(tsSegment(frames))!;
    expect(t.video).toBe('h264');
    expect(t.start).toBeCloseTo(10, 5);
    expect(t.duration).toBeCloseTo(2, 5);
    expect(t.startsWithKeyframe).toBe(true);
    expect(parseTs(tsSegment(frames.map((f) => ({ ...f, idr: false }))))!.startsWithKeyframe).toBe(false);
    expect(segmentTiming(tsSegment(frames))!.format).toBe('ts');
  });
});

describe('codec comparison', () => {
  it('flags undeclared and different codecs, tolerant of case and VP9 suffixes', () => {
    expect(compareCodecs(['avc1.64001F', 'mp4a.40.2'], ['avc1.64001f', 'mp4a.40.2'])).toEqual([]);
    expect(compareCodecs(['vp09.00.30.08'], ['vp09.00.30.08.01.01.01.01.00'])).toEqual([]);
    expect(compareCodecs(['avc1.4d401f'], ['avc1.64001f'])).toEqual([{ codec: 'avc1.64001f', declared: 'avc1.4d401f', problem: 'differs' }]);
    expect(compareCodecs(['avc1.64001f'], ['avc1.64001f', 'ec-3'])).toEqual([{ codec: 'ec-3', problem: 'undeclared' }]);
  });
});
