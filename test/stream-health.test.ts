import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHlsCues } from '../src/scte/hls-cues';
import { checkStreamHealth } from '../src/stream/health';
import { StreamMonitor } from '../src/stream/monitor';
import { parseMpd } from '../src/stream/mpd';

const URI = 'https://cdn.example.com/live/v.m3u8';

/** Live playlist: segments [first, first+n) of 2 s, with optional overrides. */
function live(first: number, n: number, o: { td?: number; dsn?: number; disc?: number[]; dur?: Record<number, number>; pdtShift?: number; end?: boolean } = {}) {
  const lines = ['#EXTM3U', `#EXT-X-TARGETDURATION:${o.td ?? 2}`, `#EXT-X-MEDIA-SEQUENCE:${first}`];
  if (o.dsn !== undefined) lines.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${o.dsn}`);
  lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(Date.UTC(2026, 0, 1) + first * 2000 + (o.pdtShift ?? 0)).toISOString()}`);
  for (let i = first; i < first + n; i++) {
    if (o.disc?.includes(i)) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${o.dur?.[i] ?? 2},`, `s${i}.ts`);
  }
  if (o.end) lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

function feed(m: StreamMonitor, text: string, now: number) {
  m.notePlaylist(URI, text, parseHlsCues(text, URI), now);
}
const codes = (m: StreamMonitor, now?: number) => checkStreamHealth(m, { now }).map((i) => `${i.severity}:${i.code}`);

describe('HLS playlist refreshes', () => {
  it('accepts a well-behaved live playlist', () => {
    const m = new StreamMonitor();
    feed(m, live(10, 5), 0);
    feed(m, live(11, 5), 2000);
    feed(m, live(12, 5), 4000);
    expect(codes(m, 5000)).toEqual([]);
  });

  it('flags media sequence going backwards, skipped segments and changed numbering', () => {
    const m = new StreamMonitor();
    feed(m, live(10, 5), 0);
    feed(m, live(9, 5), 2000);
    expect(codes(m)).toContain('error:msn-back');
    const k = new StreamMonitor();
    feed(k, live(10, 5), 0);
    feed(k, live(20, 5), 2000);
    expect(codes(k)).toContain('warn:msn-skip');
    const j = new StreamMonitor();
    feed(j, live(10, 5), 0);
    feed(j, live(11, 5).replace('s12.ts', 's13.ts'), 2000);
    expect(codes(j)).toContain('error:msn-mismatch');
  });

  it('checks the discontinuity sequence and target duration', () => {
    const m = new StreamMonitor();
    feed(m, live(10, 5, { dsn: 3, disc: [11] }), 0);
    feed(m, live(12, 5, { dsn: 4 }), 2000);
    expect(codes(m)).toEqual([]);
    const bad = new StreamMonitor();
    feed(bad, live(10, 5, { dsn: 3, disc: [11] }), 0);
    feed(bad, live(12, 5, { dsn: 3 }), 2000);
    expect(codes(bad)).toContain('error:dsn');
    const td = new StreamMonitor();
    feed(td, live(10, 5), 0);
    feed(td, live(11, 5, { td: 4 }), 2000);
    expect(codes(td)).toContain('error:td-changed');
  });

  it('flags segments over the target duration, PDT drift and changes, stale playlists and the end', () => {
    const m = new StreamMonitor();
    feed(m, live(10, 5, { dur: { 12: 2.6 } }), 0);
    expect(codes(m)).toContain('error:over-td');
    const drift = new StreamMonitor();
    feed(drift, live(10, 5).replace('#EXTINF:2,\ns12.ts', '#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:25.000Z\n#EXTINF:2,\ns12.ts'), 0);
    expect(codes(drift)).toContain('warn:pdt-drift');
    const pdt = new StreamMonitor();
    feed(pdt, live(10, 5), 0);
    feed(pdt, live(11, 5, { pdtShift: 500 }), 2000);
    expect(codes(pdt)).toContain('warn:pdt-changed');
    const stale = new StreamMonitor();
    feed(stale, live(10, 5), 0);
    feed(stale, live(10, 5), 8000);
    expect(codes(stale, 9000)).toContain('warn:stale');
    expect(codes(stale, 9000 + 0)).not.toContain('error:stale');
    const ended = new StreamMonitor();
    feed(ended, live(10, 5), 0);
    feed(ended, live(10, 6, { end: true }), 2000);
    expect(codes(ended)).toContain('info:ended');
  });
});

describe('DASH MPD', () => {
  const mpd = (s: string, extra = '') => `<MPD type="dynamic" maxSegmentDuration="PT2S" ${extra}><Period id="p1" start="PT0S">
    <AdaptationSet contentType="video"><SegmentTemplate timescale="90000" media="$Time$.m4s"><SegmentTimeline>${s}</SegmentTimeline></SegmentTemplate>
    <Representation id="v1" width="1280" height="720"/></AdaptationSet></Period></MPD>`;

  it('reads timelines with repeats', () => {
    const tl = parseMpd(mpd('<S t="0" d="180000" r="2"/><S d="90000"/>')).timelines[0];
    expect(tl.label).toBe('video (set ?)'.replace(' (set ?)', ''));
    expect(tl.entries.map((e) => e.t)).toEqual([0, 180000, 360000, 540000]);
  });

  it('flags timeline gaps, long segments and a live MPD that stops growing', () => {
    const m = new StreamMonitor();
    m.noteMpd(mpd('<S t="0" d="180000"/><S t="200000" d="270000"/>'), 0);
    const c = codes(m, 1000);
    expect(c).toContain('warn:timeline-gap');
    expect(c).toContain('warn:over-max-seg');
    const s = new StreamMonitor();
    s.noteMpd(mpd('<S t="0" d="180000" r="4"/>'), 0);
    s.noteMpd(mpd('<S t="0" d="180000" r="4"/>'), 9000);
    expect(codes(s, 9500)).toContain('warn:stale');
  });
});

describe('downloaded segments', () => {
  const sample = (f: string) => new Uint8Array(readFileSync(`public/samples/scte-demo/${f}`));

  function withStream(declaredCodecs: string, bandwidth?: number) {
    const m = new StreamMonitor();
    m.noteStream({ id: 1, kind: 'video', label: 'video 854×480', declaredCodecs, declaredBandwidth: bandwidth, format: 'HLS' });
    m.noteInit(1, 'init1', sample('init-stream1.m4s'));
    return m;
  }

  it('passes the sample, and flags codec, duration and bitrate problems', () => {
    const ok = withStream('vp09.00.30.08', 2_000_000);
    for (let i = 1; i <= 4; i++) ok.noteSegment(1, `s${i}`, (i - 1) * 2, i * 2, sample(`chunk-stream1-0000${i}.m4s`));
    expect(codes(ok)).toEqual([]);

    const bad = withStream('vp09.00.40.08', 100_000);
    bad.noteSegment(1, 's1', 0, 2, sample('chunk-stream1-00001.m4s'));
    bad.noteSegment(1, 's2', 2, 5, sample('chunk-stream1-00002.m4s'));
    const c = codes(bad);
    expect(c).toContain('warn:codecs');
    expect(c).toContain('warn:duration');
    expect(c).toContain('warn:bandwidth');
  });

  it('flags media timestamp gaps between neighbouring segments', () => {
    const m = withStream('vp09.00.30.08');
    m.noteSegment(1, 's1', 0, 2, sample('chunk-stream1-00001.m4s'));
    m.noteSegment(1, 's3', 2, 4, sample('chunk-stream1-00003.m4s'));
    expect(codes(m)).toContain('warn:media-gap');
  });
});
