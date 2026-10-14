import { describe, expect, it } from 'vitest';
import { parseAttributeList, parseHlsCues } from '../src/scte/hls-cues';
import { ScteMonitor } from '../src/scte/monitor';

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00.000Z
#EXTINF:2.0,
seg100.m4s
#EXTINF:2.0,
seg101.m4s
#EXT-X-DATERANGE:ID="ad-1",START-DATE="2026-01-01T00:00:04.000Z",PLANNED-DURATION=8,SCTE35-OUT=0xFC302500000000000000FFF01405000003E97FEFFE00083D60FE000AFC80000100000000F900B59E
#EXT-X-CUE-OUT:DURATION=8
#EXTINF:2.0,
seg102.m4s
#EXT-X-CUE-OUT-CONT:ElapsedTime=2,Duration=8
#EXTINF:2.0,
seg103.m4s
#EXT-X-CUE-IN
#EXTINF:2.0,
seg104.m4s
#EXT-OATCLS-SCTE35:/DAvAAAAAAAA///wFAVIAACPf+/+c2nALv4AUsz1AAAAAAAKAAhDVUVJAAABNWLbowo=
#EXTINF:2.0,
seg105.m4s
`;

describe('parseAttributeList', () => {
  it('handles quoted values containing commas', () => {
    expect(parseAttributeList('ID="a,b",DURATION=30,X-Y="z"')).toEqual({ ID: 'a,b', DURATION: '30', 'X-Y': 'z' });
  });
});

describe('parseHlsCues', () => {
  const info = parseHlsCues(PLAYLIST, 'https://cdn.example.com/live/video.m3u8');

  it('finds every cue tag with its segment', () => {
    expect(info.isMaster).toBe(false);
    expect(info.isLive).toBe(true);
    expect(info.cues.map((c) => c.kind)).toEqual(['DATERANGE', 'CUE-OUT', 'CUE-OUT-CONT', 'CUE-IN', 'OATCLS-SCTE35']);
    const [dr, out, cont, cin] = info.cues;
    expect(dr.id).toBe('ad-1');
    expect(dr.scte35Attribute).toBe('SCTE35-OUT');
    expect(dr.duration).toBe(8);
    expect(dr.date?.toISOString()).toBe('2026-01-01T00:00:04.000Z');
    expect(out.segmentUri).toBe('https://cdn.example.com/live/seg102.m4s');
    expect(out.playlistOffset).toBe(4);
    expect(out.mediaSequence).toBe(102);
    expect(out.date?.toISOString()).toBe('2026-01-01T00:00:04.000Z');
    expect(cont.elapsed).toBe(2);
    expect(cin.playlistOffset).toBe(8);
  });

  it('marks VOD playlists', () => {
    expect(parseHlsCues('#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-ENDLIST\n', 'https://x/y.m3u8').isLive).toBe(false);
  });
});

describe('ScteMonitor', () => {
  it('deduplicates cues seen in several renditions / refreshes and tracks the active break', () => {
    const m = new ScteMonitor();
    m.setHlsResolver((cue) => cue.playlistOffset);
    const cues = parseHlsCues(PLAYLIST, 'https://cdn.example.com/live/video.m3u8').cues;
    m.addHlsCues(cues);
    m.addHlsCues(parseHlsCues(PLAYLIST, 'https://cdn.example.com/live/audio.m3u8').cues);
    // DATERANGE, CUE-OUT, CUE-IN, OATCLS (CUE-OUT-CONT is redundant with the CUE-OUT).
    expect(m.size).toBe(4);
    expect(m.activeBreak(3)).toBeNull();
    const br = m.activeBreak(5);
    expect(br?.start).toBe(4);
    expect(br?.remaining).toBeCloseTo(7);
    expect(m.activeBreak(9)).toBeNull();
  });

  it('synthesises an OUT when joining a live stream mid-break', () => {
    const m = new ScteMonitor();
    m.setHlsResolver((cue) => cue.playlistOffset);
    m.addHlsCues(
      parseHlsCues(
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-CUE-OUT-CONT:ElapsedTime=6,Duration=10\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts\n',
        'https://x/p.m3u8',
      ).cues,
    );
    expect(m.list()[0].source).toBe('HLS CUE-OUT-CONT');
    expect(m.activeBreak(1)?.remaining).toBeCloseTo(3);
  });
});
