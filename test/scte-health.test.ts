import { describe, expect, it } from 'vitest';
import { encodeScte35, ticks, toBase64, toHexString } from '../src/scte/encode';
import { checkScteHealth, type HealthContext } from '../src/scte/health';
import { parseHlsCues } from '../src/scte/hls-cues';
import { ScteMonitor, type MonitorContext } from '../src/scte/monitor';
import { parseScte35 } from '../src/scte/scte35';
import { markerTiming, ptsDiff, spliceSeconds } from '../src/scte/timing';

const VOD: Omit<HealthContext, 'playlists'> = { live: false, horizon: 600 };

/** Builds a VOD media playlist of 2 s segments; `tags` maps a segment index to tags placed before it. */
function playlist(segments: number, tags: Record<number, string[]>, opts: { pdt?: string; prefix?: string } = {}): string {
  const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0'];
  if (opts.pdt) lines.push(`#EXT-X-PROGRAM-DATE-TIME:${opts.pdt}`);
  for (let i = 0; i < segments; i++) {
    lines.push(...(tags[i] ?? []), '#EXTINF:2.0,', `${opts.prefix ?? 'seg'}${i}.m4s`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

function vodMonitor(...lists: [string, string][]): ScteMonitor {
  const m = new ScteMonitor();
  m.setHlsResolver((cue) => cue.playlistOffset);
  for (const [uri, text] of lists) {
    const info = parseHlsCues(text, uri);
    m.notePlaylist(uri, info);
    m.addHlsCues(info.cues);
  }
  return m;
}

const health = (m: ScteMonitor, ctx: Partial<HealthContext> = {}) =>
  checkScteHealth(m.list(), { ...VOD, playlists: [...m.playlists.values()], ...ctx });
const codes = (m: ScteMonitor, ctx?: Partial<HealthContext>) => health(m, ctx).map((i) => i.code);

describe('SCTE-35 encoder', () => {
  it('round-trips splice_insert with a break duration', () => {
    const bytes = encodeScte35({
      command: { type: 'splice_insert', eventId: 1001, outOfNetwork: true, pts: ticks(10), duration: ticks(30), availNum: 1, availsExpected: 2 },
      ptsAdjustment: 900,
    });
    const s = parseScte35(bytes);
    expect(s.crcValid).toBe(true);
    expect(s.command).toMatchObject({ type: 'splice_insert', spliceEventId: 1001, outOfNetwork: true, availNum: 1, availsExpected: 2 });
    expect(s.command.type === 'splice_insert' && s.command.breakDuration?.duration).toBe(ticks(30));
    expect(spliceSeconds(s)).toBeCloseTo(10.01, 5);
    expect(parseScte35(toBase64(bytes)).crc32).toBe(s.crc32);
    expect(parseScte35(toHexString(bytes)).crc32).toBe(s.crc32);
  });

  it('round-trips time_signal with segmentation descriptors', () => {
    const s = parseScte35(
      encodeScte35({
        command: { type: 'time_signal', pts: ticks(100) },
        descriptors: [
          { eventId: 7, typeId: 0x34, duration: ticks(60), upidType: 0x09, upid: 'SIGNAL:abc', segmentNum: 1, segmentsExpected: 1, subSegmentNum: 1, subSegmentsExpected: 2 },
          { eventId: 8, typeId: 0x30, upidType: 0x0c, upid: '0x4d505531aabb' },
        ],
      }),
    );
    expect(s.crcValid).toBe(true);
    const [a, b] = s.descriptors as { segmentationTypeId: number; upid: string; segmentationDuration?: number; subSegmentsExpected?: number }[];
    expect(a).toMatchObject({ segmentationTypeId: 0x34, upid: 'SIGNAL:abc', segmentationDuration: ticks(60), subSegmentsExpected: 2 });
    expect(b.segmentationTypeId).toBe(0x30);
  });

  it('handles the 33-bit PTS wrap', () => {
    expect(ptsDiff(1, 2 ** 33 / 90000 - 1)).toBeCloseTo(2, 6);
  });
});

describe('break pairing', () => {
  it('accepts a break whose IN matches the advertised duration', () => {
    const m = vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT:DURATION=8'], 6: ['#EXT-X-CUE-IN'] })]);
    expect(codes(m)).toEqual([]);
  });

  it('flags an IN that comes earlier than advertised', () => {
    const m = vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT:DURATION=8'], 5: ['#EXT-X-CUE-IN'] })]);
    const issue = health(m).find((i) => i.code === 'duration-mismatch')!;
    expect(issue.detail).toContain('2.00 s early');
  });

  it('merges DATERANGE and CUE-OUT for the same break, but flags different durations', () => {
    const m = vodMonitor([
      'https://x/v.m3u8',
      playlist(10, { 2: [`#EXT-X-DATERANGE:ID="a",START-DATE="2026-01-01T00:00:04Z",PLANNED-DURATION=6,SCTE35-OUT=${toHexString(encodeScte35({ command: { type: 'splice_insert', eventId: 1, outOfNetwork: true, duration: ticks(6) } }))}`, '#EXT-X-CUE-OUT:DURATION=8'], 6: ['#EXT-X-CUE-IN'] }),
    ]);
    const c = codes(m);
    expect(c).not.toContain('break-overlap');
    expect(c).toContain('duration-disagree');
  });

  it('flags OUT without IN or duration, IN without OUT and overlapping breaks', () => {
    expect(codes(vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT'] })]))).toContain('break-no-in');
    expect(codes(vodMonitor(['https://x/v.m3u8', playlist(10, { 4: ['#EXT-X-CUE-IN'] })]))).toContain('in-without-out');
    expect(codes(vodMonitor(['https://x/v.m3u8', playlist(10, { 1: ['#EXT-X-CUE-OUT'], 4: ['#EXT-X-CUE-OUT:DURATION=4'], 6: ['#EXT-X-CUE-IN'] })]))).toContain('break-overlap');
  });

  it('a live stream with an open break is only a note', () => {
    const issue = health(vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT'] })]), { live: true }).find((i) => i.code === 'break-no-in')!;
    expect(issue.severity).toBe('info');
  });

  it('checks CUE-OUT-CONT elapsed times', () => {
    const ok = vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT:DURATION=8'], 3: ['#EXT-X-CUE-OUT-CONT:ElapsedTime=2,Duration=8'], 6: ['#EXT-X-CUE-IN'] })]);
    expect(codes(ok)).toEqual([]);
    const bad = vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT:DURATION=8'], 4: ['#EXT-X-CUE-OUT-CONT:ElapsedTime=2,Duration=8'], 6: ['#EXT-X-CUE-IN'] })]);
    expect(codes(bad)).toContain('cont-elapsed');
  });
});

describe('messages', () => {
  it('flags CRC errors and cancelled events', () => {
    const good = encodeScte35({ command: { type: 'splice_insert', eventId: 5, outOfNetwork: true, duration: ticks(4) } });
    const broken = good.slice();
    broken[20] ^= 0xff;
    const cancel = encodeScte35({ command: { type: 'splice_insert', eventId: 5, outOfNetwork: true, cancel: true } });
    const m = vodMonitor([
      'https://x/v.m3u8',
      playlist(10, { 1: [`#EXT-OATCLS-SCTE35:${toBase64(broken)}`], 3: [`#EXT-OATCLS-SCTE35:${toBase64(good)}`], 6: [`#EXT-OATCLS-SCTE35:${toBase64(cancel)}`] }),
    ]);
    const c = codes(m);
    expect(c).toContain('crc');
    expect(c).toContain('cancel');
  });
});

describe('segmentation pairs', () => {
  const sig = (typeId: number, eventId: number, duration?: number) =>
    `#EXT-OATCLS-SCTE35:${toBase64(encodeScte35({ command: { type: 'time_signal', pts: 0 }, descriptors: [{ eventId, typeId, duration: duration && ticks(duration) }] }))}`;

  it('pairs placement opportunity start and end', () => {
    const m = vodMonitor(['https://x/v.m3u8', playlist(20, { 2: [sig(0x34, 1, 8)], 6: [sig(0x35, 1)] })]);
    expect(codes(m)).toEqual([]);
  });

  it('flags a duration mismatch, an end without a start, and different event IDs', () => {
    const m = vodMonitor(['https://x/v.m3u8', playlist(20, { 2: [sig(0x34, 1, 8)], 5: [sig(0x35, 2)], 9: [sig(0x23, 3)] })]);
    const c = codes(m);
    expect(c).toContain('seg-duration');
    expect(c).toContain('seg-id-mismatch');
    expect(c).toContain('seg-no-start');
  });

  it('flags a start that never ends in VOD', () => {
    expect(codes(vodMonitor(['https://x/v.m3u8', playlist(20, { 2: [sig(0x22, 1)] })]))).toContain('seg-no-end');
  });
});

describe('renditions', () => {
  it('flags a marker missing from a video playlist (warning) or audio playlist (note)', () => {
    const tags = { 3: ['#EXT-X-CUE-OUT:DURATION=4'], 5: ['#EXT-X-CUE-IN'] };
    const m = vodMonitor(
      ['https://x/v1.m3u8', playlist(10, tags)],
      ['https://x/v2.m3u8', playlist(10, {})],
      ['https://x/a.m3u8', playlist(10, tags)],
    );
    m.setPlaylistLabel('https://x/v2.m3u8', 'video 1280×720', 'video');
    let issues = health(m).filter((i) => i.code === 'missing-rendition');
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe('warn');
    expect(issues[0].detail).toContain('video 1280×720');

    const audioMissing = vodMonitor(['https://x/v1.m3u8', playlist(10, tags)], ['https://x/a.m3u8', playlist(10, {})]);
    audioMissing.setPlaylistLabel('https://x/a.m3u8', 'audio en', 'audio');
    issues = health(audioMissing).filter((i) => i.code === 'missing-rendition');
    expect(issues.map((i) => i.severity)).toEqual(['info', 'info']);
  });
});

describe('timing', () => {
  function liveMonitor(ctx: Partial<MonitorContext>) {
    const m = new ScteMonitor();
    m.setContext(() => ({ live: true, availabilityEnd: 100, bufferEnd: 90, segmentAt: (t) => ({ start: Math.floor(t / 2) * 2, end: Math.floor(t / 2) * 2 + 2 }), ...ctx }));
    return m;
  }
  const region = (m: ScteMonitor, id: string, startTime: number, pts = startTime) =>
    m.addTimelineRegion({
      schemeIdUri: 'urn:scte:scte35:2014:xml+bin',
      value: '',
      id,
      startTime,
      endTime: startTime,
      payload: toBase64(encodeScte35({ command: { type: 'splice_insert', eventId: Number(id), outOfNetwork: true, pts: ticks(pts + 50), duration: ticks(10) } })),
    });

  it('measures lead time against the live edge', () => {
    const m = liveMonitor({});
    region(m, '1', 110);
    region(m, '2', 102);
    region(m, '3', 98);
    const [a, b, c] = m.list().sort((x, y) => x.startTime! - y.startTime!);
    expect(markerTiming(c).lead).toBe(10);
    expect(markerTiming(b).lead).toBe(2);
    const issues = checkScteHealth(m.list(), { live: true, horizon: 100, playlists: [] });
    expect(issues.find((i) => i.keys[0] === a.key && i.code === 'late')).toBeTruthy();
    expect(issues.find((i) => i.keys[0] === b.key && i.code === 'short-lead')).toBeTruthy();
    expect(issues.find((i) => i.keys[0] === c.key && (i.code === 'late' || i.code === 'short-lead'))).toBeUndefined();
  });

  it('flags splices that are not on a segment boundary', () => {
    const m = liveMonitor({ availabilityEnd: 0 });
    region(m, '1', 120);
    region(m, '2', 131.5);
    const issues = checkScteHealth(m.list(), { live: true, horizon: 0, playlists: [] }).filter((i) => i.code === 'unaligned');
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('1.50 s into a 2.00 s segment');
  });

  it('flags a marker whose splice_time disagrees with the others', () => {
    const m = liveMonitor({ availabilityEnd: 0 });
    region(m, '1', 120);
    region(m, '2', 140);
    region(m, '3', 160);
    region(m, '4', 180, 182);
    const issues = checkScteHealth(m.list(), { live: true, horizon: 0, playlists: [] }).filter((i) => i.code === 'pts-offset');
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('2.00 s later');
  });
});

describe('timeline lanes', () => {
  it('builds break and segmentation spans, open ones to the edge', async () => {
    const { buildTimeline } = await import('../src/scte/timeline');
    const sig = (typeId: number, eventId: number, duration?: number) =>
      `#EXT-OATCLS-SCTE35:${toBase64(encodeScte35({ command: { type: 'time_signal', pts: 0 }, descriptors: [{ eventId, typeId, duration: duration && ticks(duration) }] }))}`;
    const m = vodMonitor([
      'https://x/v.m3u8',
      playlist(30, { 1: [sig(0x10, 1)], 2: ['#EXT-X-CUE-OUT:DURATION=8'], 6: ['#EXT-X-CUE-IN'], 10: [sig(0x34, 2, 6)], 13: [sig(0x35, 2)], 20: [sig(0x30, 3, 4)] }),
    ]);
    const { spans } = buildTimeline(m.list(), 60);
    const byLane = (l: string) => spans.filter((s) => s.lane === l).map((s) => [s.start, s.end, s.open]);
    expect(byLane('breaks')).toEqual([[4, 12, false]]);
    expect(byLane('programme')).toEqual([[2, 60, true]]);
    expect(byLane('po')).toEqual([[20, 26, false]]);
    expect(byLane('ad')).toEqual([[40, 44, false]]);
  });
});

describe('builder outputs', () => {
  it('formats HLS tags and a DASH EventStream that decode back', async () => {
    const { hlsTags, dashEventStream } = await import('../src/scte/encode');
    const bytes = encodeScte35({ command: { type: 'splice_insert', eventId: 9, outOfNetwork: true, pts: ticks(10), duration: ticks(30) } });
    const tags = hlsTags(bytes, { direction: 'out', duration: 30, id: 'ad-9', startDate: new Date('2026-01-01T00:00:00Z') });
    expect(tags[0]).toBe(`#EXT-X-DATERANGE:ID="ad-9",START-DATE="2026-01-01T00:00:00.000Z",PLANNED-DURATION=30,SCTE35-OUT=${toHexString(bytes)}`);
    expect(tags[1]).toBe('#EXT-X-CUE-OUT:DURATION=30');
    const cues = parseHlsCues(playlist(4, { 1: tags }), 'https://x/v.m3u8').cues;
    expect(cues.map((c) => c.kind)).toEqual(['DATERANGE', 'CUE-OUT', 'OATCLS-SCTE35', 'SCTE35']);
    for (const c of cues.filter((x) => x.scte35)) expect(parseScte35(c.scte35!).crcValid).toBe(true);
    const xml = dashEventStream(bytes, { presentationTime: 10, duration: 30, id: '9' });
    expect(xml).toContain('presentationTime="900000" duration="2700000" id="9"');
    expect(parseScte35(xml.match(/<Binary>(.*)<\/Binary>/)![1]).crcValid).toBe(true);
  });

  it('turns the builder form into a spec, with clear errors', async () => {
    const { formToSpec } = await import('../src/ui/scte/builder');
    const base: import('../src/ui/scte/builder').BuilderForm = { command: 'time_signal', eventId: '1', direction: 'out', cancel: false, immediate: false, spliceTime: '5', duration: '', autoReturn: true, uniqueProgramId: '0', availNum: '0', availsExpected: '0', ptsAdjustment: '0', tagId: 'x', presentationTime: '0', descriptors: [] };
    const d = { eventId: '3', typeId: '52', duration: '30', upidType: '9', upid: 'SIGNAL:x', segmentNum: '1', segmentsExpected: '1', subSegmentNum: '0', subSegmentsExpected: '0', cancel: false, restricted: false, webDeliveryAllowed: true, noRegionalBlackout: true, archiveAllowed: true };
    const spec = formToSpec({ ...base, descriptors: [d] });
    expect(spec.command).toEqual({ type: 'time_signal', pts: ticks(5) });
    expect(spec.descriptors![0]).toMatchObject({ eventId: 3, typeId: 0x34, duration: ticks(30), upid: 'SIGNAL:x' });
    expect(() => formToSpec({ ...base, spliceTime: 'abc' })).toThrow(/Splice time/);
    expect(() => encodeScte35(formToSpec({ ...base, descriptors: [{ ...d, upid: '0xabc' }] }))).toThrow(/even number/);
  });
});

describe('structure, CSV and counts', () => {
  const sig = (typeId: number, eventId: number, duration?: number, upid?: string, upidType?: number) =>
    `#EXT-OATCLS-SCTE35:${toBase64(encodeScte35({ command: { type: 'time_signal', pts: 0 }, descriptors: [{ eventId, typeId, duration: duration && ticks(duration), upid, upidType }] }))}`;

  it('nests programme > break > placement opportunity > ad', async () => {
    const { buildStructure } = await import('../src/scte/structure');
    const m = vodMonitor([
      'https://x/v.m3u8',
      playlist(40, { 0: [sig(0x10, 1, 70)], 5: [sig(0x22, 2, 20)], 6: [sig(0x34, 3, 16)], 7: [sig(0x30, 4, 6, 'ABCD0123456H', 0x03)], 16: [sig(0x22, 5, 4)] }),
    ]);
    const roots = buildStructure(m.list(), 80);
    const shape = (n: { span: { lane: string }; children: unknown[] }): unknown => [n.span.lane, (n.children as never[]).map(shape)];
    expect(roots.map(shape)).toEqual([['programme', [['break', [['po', [['ad', []]]]]], ['break', []]]]]);
    expect(roots[0].children[0].children[0].children[0].span.label).toContain('Ad-ID: ABCD0123456H');
  });

  it('exports CSV with escaping and counts markers per hour', async () => {
    const { markersToCsv, hourlyCounts } = await import('../src/scte/csv');
    const m = vodMonitor(['https://x/v.m3u8', playlist(10, { 2: ['#EXT-X-CUE-OUT:DURATION=8', '#EXT-X-DATERANGE:ID="a,b",START-DATE="2026-01-01T00:00:00Z"'], 5: ['#EXT-X-CUE-IN'] })]);
    const csv = markersToCsv(m.list(), health(m), () => null).split('\r\n');
    expect(csv[0].split(',')[0]).toBe('presentation_time_s');
    const out = csv.find((r) => r.includes('HLS CUE-OUT'))!;
    expect(out.startsWith('4.000,,')).toBe(true);
    expect(out).toContain('HLS CUE-OUT,out');
    expect(out).toContain('warn: Break length differs from the advertised duration');
    expect(csv.find((r) => r.includes('HLS DATERANGE'))).toContain('"#EXT-X-DATERANGE:ID=""a,b"",START-DATE=""2026-01-01T00:00:00Z"""');
    expect(hourlyCounts(m.list(), false)).toEqual([{ hour: '00:00–01:00', out: 1, in: 1, other: 1 }]);
  });

  it('formats TI and MPU UPIDs', () => {
    const s = parseScte35(
      encodeScte35({ command: { type: 'time_signal', pts: 0 }, descriptors: [{ eventId: 1, typeId: 0x10, upidType: 0x08, upid: '0x0000000000000100' }, { eventId: 2, typeId: 0x10, upidType: 0x0c, upid: '0x41424344ff01' }] }),
    );
    expect((s.descriptors[0] as { upid: string }).upid).toBe('256 (0x0000000000000100)');
    expect((s.descriptors[1] as { upid: string }).upid).toBe('[ABCD] 0xff01');
  });
});
