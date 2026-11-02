import { describe, expect, it } from 'vitest';
import { compareRenditions, type AlignRow } from '../src/stream/alignment';

const row = (label: string, cells: [number, number, number, boolean][]): AlignRow => ({
  streamId: label.length,
  label,
  cells: cells.map(([s, e, actual, key], index) => ({
    index,
    declaredStart: s,
    declaredEnd: e,
    uri: `${label}/${index}`,
    actual: { start: actual, duration: e - s, startsWithKeyframe: key, format: 'fmp4' },
  })),
});

describe('rendition alignment', () => {
  it('passes aligned renditions', () => {
    const rows = [row('240p', [[0, 2, 10, true], [2, 4, 12, true]]), row('720p', [[0, 2, 10, true], [2, 4, 12, true]])];
    expect(compareRenditions(rows)).toEqual([]);
  });

  it('flags different boundaries, timestamps, durations, missing keyframes and fetch errors', () => {
    const rows = [
      row('240p', [[0, 2, 10, true], [2, 4, 12, true]]),
      row('720p', [[0, 3, 10.5, true], [3, 6, 13.5, false]]),
      { streamId: 9, label: '1080p', cells: [], error: 'HTTP 404' },
    ];
    const codes = compareRenditions(rows).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining(['error:align-boundary', 'error:align-timestamps', 'warn:align-duration', 'error:align-keyframe', 'warn:align-fetch']),
    );
    const ts = compareRenditions(rows).find((i) => i.code === 'align-timestamps')!;
    expect(ts.detail).toContain('720p +0.500 s');
  });

  it('flags a rendition with fewer segments', () => {
    const rows = [row('240p', [[0, 2, 0, true], [2, 4, 2, true]]), row('720p', [[0, 2, 0, true]])];
    expect(compareRenditions(rows).map((i) => i.code)).toEqual(['align-count']);
  });
});
