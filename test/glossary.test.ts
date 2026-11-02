import { describe, expect, it } from 'vitest';
import { GLOSSARY, tipFor } from '../src/ui/glossary';
import { WELCOME_KEY, shouldShowWelcome } from '../src/ui/welcome';

describe('glossary', () => {
  it('explains the labels shown in the app', () => {
    const labels = [
      'Stats', 'Tracks', 'Audio', 'DRM', 'SCTE-35', 'Health', 'Alarms', 'Network', 'Manifest', 'Device', 'Log',
      'Stream health', 'Stream & segments', 'Rendition alignment', 'SCTE-35 signalling', 'Picture & sound',
      'Loudness', 'Bitrate ladder', 'Throughput & buffer', 'Timeline', 'Events', 'Playback',
      'Momentary', 'Short-term', 'Integrated', 'True peak (max)', 'Loudness range', 'L/R correlation',
      'Estimated bandwidth', 'Buffer', 'Time to first frame', 'Live latency', 'DVR window',
      'Codec in media', 'Keyframe start', 'Measured avg / peak', 'Last change',
      'CRC-32', 'Splice point (player time)', 'Fill', 'Origin', 'Threshold', 'For at least',
      'Track (manifest)', 'Decoded by browser', 'Channel order', 'Measured from', 'Output device', 'Dolby decoding here',
      'Key status (2)', 'Video renditions (6)', 'MSE / ManagedMediaSource', 'Detail',
      'Security level', 'Key ID', 'Rendition', 'Dropped frames', 'Scheme', 'Keys', 'Licence', 'Request',
    ];
    const missing = labels.filter((l) => !tipFor(l));
    expect(missing).toEqual([]);
  });

  it('tries a context first, then the plain label', () => {
    expect(tipFor('Health', 'scte')).toMatch(/SCTE-35 signalling/);
    expect(tipFor('Health')).toMatch(/playlists or MPD/);
    expect(tipFor('Audio', 'fact')).toMatch(/audio track playing/);
    expect(tipFor('Tracks', 'fact')).toBe(GLOSSARY.tracks);
  });

  it('ignores counts, case and long text', () => {
    expect(tipFor('  SCTE-35 ')).toBe(GLOSSARY['scte-35']);
    expect(tipFor('Log 12')).toBe(GLOSSARY.log);
    expect(tipFor('x'.repeat(80))).toBeUndefined();
    expect(tipFor('')).toBeUndefined();
  });

  it('keeps entries short', () => {
    for (const [k, v] of Object.entries(GLOSSARY)) expect(v.length, k).toBeLessThan(220);
  });
});

describe('welcome guide', () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === WELCOME_KEY ? v : null) });
  it('shows until hidden', () => {
    expect(shouldShowWelcome(store(null))).toBe(true);
    expect(shouldShowWelcome(store('hide'))).toBe(false);
    expect(shouldShowWelcome(null)).toBe(true);
    expect(shouldShowWelcome({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
  });
});
