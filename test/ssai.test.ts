import { describe, expect, it } from 'vitest';
import { parseHlsCues } from '../src/scte/hls-cues';
import { ScteMonitor } from '../src/scte/monitor';
import { dashRuns, findPods, isoDuration, podIssues, reportPods } from '../src/scte/ssai';

const PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2,
https://cdn.example.com/live/ch1/seg0.ts
#EXTINF:2,
https://cdn.example.com/live/ch1/seg1.ts
#EXT-X-CUE-OUT:DURATION=8
#EXT-X-DISCONTINUITY
#EXTINF:2,
https://ads.example.net/creatives/a/0.ts
#EXTINF:2,
https://ads.example.net/creatives/a/1.ts
#EXT-X-DISCONTINUITY
#EXTINF:2,
https://ads.example.net/creatives/b/0.ts
#EXT-X-DISCONTINUITY
#EXT-X-CUE-IN
#EXTINF:2,
https://cdn.example.com/live/ch1/seg2.ts
#EXTINF:2,
https://cdn.example.com/live/ch1/seg3.ts
#EXTINF:2,
https://cdn.example.com/live/ch1/seg4.ts
#EXT-X-CUE-OUT:DURATION=4
#EXTINF:2,
https://cdn.example.com/live/ch1/seg5.ts
#EXT-X-ENDLIST`;

function monitor(text = PLAYLIST) {
  const m = new ScteMonitor();
  m.setHlsResolver((c) => c.playlistOffset);
  const info = parseHlsCues(text, 'https://cdn.example.com/live/ch1/index.m3u8');
  m.notePlaylist('v', info);
  m.noteHlsRuns('v', info);
  m.addHlsCues(info.cues);
  return m;
}

describe('ad insertion', () => {
  it('finds a pod of two ads from another origin and matches it with its break', () => {
    const m = monitor();
    const pods = findPods([...m.runs.values()], m.list());
    expect(pods).toHaveLength(1);
    expect(pods[0]).toMatchObject({ start: 4, duration: 6, kind: 'inserted' });
    expect(pods[0].ads.map((a) => a.origin)).toEqual(['ads.example.net/creatives', 'ads.example.net/creatives']);
    const [r] = reportPods(pods, m.list());
    expect(r.breakLength).toBe(8);
    expect(r.fill).toBe(-2);
    const issues = podIssues(reportPods(pods, m.list()), m.list(), 20);
    expect(issues.map((i) => i.code)).toEqual(['pod-fill', 'break-no-pod']);
    expect(issues[0].title).toContain('underfill');
  });

  it('extends runs across live refreshes instead of duplicating them', () => {
    const m = new ScteMonitor();
    m.setHlsResolver(() => 0);
    const list = (first: number, n: number) =>
      ['#EXTM3U', '#EXT-X-TARGETDURATION:2', `#EXT-X-PROGRAM-DATE-TIME:${new Date(Date.UTC(2026, 0, 1, 0, 0, first * 2)).toISOString()}`]
        .concat(Array.from({ length: n }, (_, i) => [`#EXTINF:2,`, `https://cdn.example.com/live/ch1/s${first + i}.ts`]).flat())
        .join('\n');
    m.noteHlsRuns('v', parseHlsCues(list(0, 3), 'https://cdn.example.com/v.m3u8'));
    m.noteHlsRuns('v', parseHlsCues(list(2, 3), 'https://cdn.example.com/v.m3u8'));
    expect([...m.runs.values()].map((r) => r.duration)).toEqual([10]);
  });

  it('reads DASH periods and their origins', () => {
    const mpd = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1M">
      <BaseURL>https://cdn.example.com/vod/movie/</BaseURL>
      <Period id="main-1" start="PT0S"><AdaptationSet><SegmentTemplate media="v/$Number$.m4s"/></AdaptationSet></Period>
      <Period id="ad-1" start="PT20S"><BaseURL>https://ads.example.net/pods/123/</BaseURL><AdaptationSet><SegmentTemplate media="$Number$.m4s"/></AdaptationSet></Period>
      <Period id="main-2" start="PT35S"><AdaptationSet><SegmentTemplate media="v/$Number$.m4s"/></AdaptationSet></Period>
    </MPD>`;
    const runs = dashRuns(mpd, 'https://cdn.example.com/vod/movie/manifest.mpd');
    expect(runs.map((r) => [r.periodId, r.start, r.duration, r.origin])).toEqual([
      ['main-1', 0, 20, 'cdn.example.com/vod'],
      ['ad-1', 20, 15, 'ads.example.net/pods'],
      ['main-2', 35, 25, 'cdn.example.com/vod'],
    ]);
    expect(findPods(runs, []).map((p) => [p.start, p.duration])).toEqual([[20, 15]]);
    expect(isoDuration('PT1H2M3.5S')).toBe(3723.5);
  });

  it('lists HLS Interstitials', () => {
    const m = monitor(`#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00Z
#EXTINF:2,
s0.ts
#EXT-X-DATERANGE:ID="i1",CLASS="com.apple.hls.interstitial",START-DATE="2026-01-01T00:00:02Z",DURATION=15,X-ASSET-URI="https://ads.example.net/i1.m3u8"
#EXTINF:2,
s1.ts
#EXT-X-ENDLIST`);
    const pods = findPods([...m.runs.values()], m.list());
    expect(pods).toHaveLength(1);
    expect(pods[0]).toMatchObject({ kind: 'interstitial', duration: 15 });
  });
});
