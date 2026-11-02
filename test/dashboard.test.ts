import { describe, expect, it } from 'vitest';
import { buildFeed, buildLadder, healthScore, type ScoreInput } from '../src/ui/dashboard/model';
import { defaultView, parseView } from '../src/ui/viewmode';

const base: ScoreInput = { stream: [], alignment: null, scte: [], scteMarkers: 0, alarmsActive: 0, alarmsLogged: 0, drm: null };

describe('health score', () => {
  it('is 100 for a clean stream, with areas not applicable marked as such', () => {
    const r = healthScore(base);
    expect(r.score).toBe(100);
    expect(r.parts.map((p) => `${p.id}:${p.status}`)).toEqual(['stream:ok', 'alignment:na', 'scte:na', 'alarms:ok', 'drm:na']);
  });

  it('takes points off per issue, capped per area', () => {
    const r = healthScore({ ...base, stream: [{ severity: 'error' }, { severity: 'warn' }], scteMarkers: 3, scte: Array(10).fill({ severity: 'error' }) });
    expect(r.score).toBe(100 - 14 - 20);
    expect(r.parts[0]).toMatchObject({ status: 'bad', text: '1 error · 1 warning' });
    expect(r.parts[2]).toMatchObject({ status: 'bad', tab: 'scte' });
  });

  it('weighs active alarms and DRM problems', () => {
    const r = healthScore({ ...base, alarmsActive: 2, alarmsLogged: 3, drm: { name: 'Widevine', licenseErrors: 1, badKeys: 0, expiresInHours: 5 } });
    expect(r.score).toBe(100 - 30 - 6 - 15);
    expect(r.parts.find((p) => p.id === 'alarms')!.text).toBe('2 active alarms');
    expect(r.parts.find((p) => p.id === 'drm')).toMatchObject({ label: 'DRM · Widevine', status: 'bad' });
    expect(healthScore({ ...base, drm: { name: 'PlayReady', licenseErrors: 0, badKeys: 0, expiresInHours: 23.4 } }).parts[4].text).toBe('Licence 23 h');
    expect(healthScore({ ...base, alarmsActive: 9 }).score).toBe(55);
  });
});

describe('events feed', () => {
  it('merges log, markers and alarms newest first', () => {
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s));
    const feed = buildFeed(
      [
        { at: t(1), level: 'info', message: 'ABR switch → 720p @ 3000 kbps' },
        { at: t(4), level: 'warn', message: 'Stall detected' },
      ],
      [{ key: 'k1', receivedAt: t(3), direction: 'out', summary: 'splice_insert · OUT #1', startTime: 30 }],
      [{ start: t(2), type: 'black', label: 'Black picture', detail: 'luma 0 %', mediaStart: 12 }],
    );
    expect(feed.map((f) => f.kind)).toEqual(['warn', 'scte-out', 'alarm', 'quality']);
    expect(feed[1]).toMatchObject({ title: 'SCTE-35 OUT', key: 'k1', time: 30 });
    expect(feed[2].time).toBe(12);
  });
});

describe('bitrate ladder', () => {
  const track = (height: number, bandwidth: number, videoId: number, active = false) => ({ height, width: (height * 16) / 9, bandwidth, videoBandwidth: null, active, videoId });

  it('one rung per video stream, sorted, with measured bitrate and overshoot', () => {
    const rungs = buildLadder(
      [track(720, 3_000_000, 2, true), track(360, 800_000, 1), track(720, 3_100_000, 2), track(1080, 6_000_000, 3)],
      new Map([
        [2, { avg: 2_500_000, peak: 3_600_000 }],
        [3, { avg: 5_000_000, peak: 6_200_000 }],
      ]),
      'HLS',
    );
    expect(rungs.map((r) => [r.height, r.declared, r.active, r.over])).toEqual([
      [360, 800_000, false, false],
      [720, 3_100_000, true, true],
      [1080, 6_000_000, false, false],
    ]);
    expect(rungs[1].measured).toBe(2_500_000);
  });

  it('uses the average against @bandwidth for DASH', () => {
    expect(buildLadder([track(720, 3_000_000, 2)], new Map([[2, { avg: 4_000_000, peak: 9_000_000 }]]), 'DASH')[0].over).toBe(true);
  });
});

describe('view mode', () => {
  it('defaults to Monitor for live and Inspect for VOD, unless a choice was remembered', () => {
    expect(defaultView(true, {})).toBe('monitor');
    expect(defaultView(false, {})).toBe('inspect');
    expect(defaultView(true, { live: 'inspect' })).toBe('inspect');
    expect(defaultView(false, { live: 'inspect', vod: 'monitor' })).toBe('monitor');
    expect(parseView('monitor')).toBe('monitor');
    expect(parseView('other')).toBeNull();
  });
});

describe('channel strip', () => {
  it('flags a lost or much quieter channel, never the LFE', async () => {
    const { channelStates } = await import('../src/ui/dashboard/model');
    const ch = (label: string, peak: number) => ({ label, peak, rms: peak - 3 });
    expect(channelStates([ch('L', -20), ch('R', -21)]).map((c) => c.flag)).toEqual([null, null]);
    expect(channelStates([ch('L', -20), ch('R', -95)]).map((c) => c.flag)).toEqual([null, 'silent']);
    expect(channelStates([ch('L', -20), ch('R', -20), ch('C', -35), ch('LFE', -80), ch('Ls', -24), ch('Rs', -24)]).map((c) => c.flag)).toEqual([null, null, 'low', null, null, null]);
    // Everything quiet (programme silence) is the silence alarm's job, not a channel problem.
    expect(channelStates([ch('L', -95), ch('R', -95)]).map((c) => c.flag)).toEqual([null, null]);
  });
});
