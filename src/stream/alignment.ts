import type { SegmentTiming } from '../media/segment';
import type { StreamIssue } from './monitor';

/**
 * Rendition alignment: the same segments of every video rendition, compared.
 * For seamless quality switches, segment boundaries and media timestamps
 * must match across renditions and every segment must start with a keyframe.
 */

export interface AlignCell {
  index: number;
  declaredStart: number;
  declaredEnd: number;
  uri: string;
  bytes?: number;
  actual?: SegmentTiming | null;
  error?: string;
}

export interface AlignRow {
  streamId: number;
  label: string;
  codec?: string;
  cells: AlignCell[];
  error?: string;
}

export interface AlignmentResult {
  /** Presentation time checked. */
  time: number;
  rows: AlignRow[];
  issues: StreamIssue[];
  checkedAt: Date;
}

const fmt = (s: number) => `${s.toFixed(3)} s`;

/** Compares the rows (already fetched and parsed). */
export function compareRenditions(rows: AlignRow[], frameDuration = 0.04): StreamIssue[] {
  const issues: StreamIssue[] = [];
  const tol = Math.max(frameDuration / 2, 0.01);
  const ok = rows.filter((r) => !r.error && r.cells.length);
  const columns = Math.max(0, ...ok.map((r) => r.cells.length));
  for (const r of rows) if (r.error) issues.push({ severity: 'warn', code: 'align-fetch', title: 'Rendition could not be checked', detail: r.error, where: r.label });

  for (let k = 0; k < columns; k++) {
    const cells = ok.map((r) => ({ row: r, cell: r.cells[k] })).filter((x) => x.cell);
    if (cells.length < ok.length) {
      issues.push({ severity: 'warn', code: 'align-count', title: 'Renditions have different segments', detail: `Segment ${k + 1}: only ${cells.length} of ${ok.length} renditions list it.`, where: 'all renditions' });
    }
    if (cells.length < 2) continue;
    // 1. Boundaries in the manifest.
    const starts = cells.map((x) => x.cell.declaredStart);
    const ends = cells.map((x) => x.cell.declaredEnd);
    if (Math.max(...starts) - Math.min(...starts) > tol || Math.max(...ends) - Math.min(...ends) > tol) {
      issues.push({
        severity: 'error',
        code: 'align-boundary',
        title: 'Segment boundaries differ between renditions',
        detail: `Segment ${k + 1}: ${cells.map((x) => `${x.row.label} ${fmt(x.cell.declaredStart)}–${fmt(x.cell.declaredEnd)}`).join(' · ')}.`,
        where: 'all renditions',
        time: Math.min(...starts),
      });
    }
    // 2. Timestamps in the media.
    const actual = cells.filter((x) => x.cell.actual);
    if (actual.length >= 2) {
      const a = actual.map((x) => x.cell.actual!.start);
      if (Math.max(...a) - Math.min(...a) > tol) {
        const ref = actual[0];
        issues.push({
          severity: 'error',
          code: 'align-timestamps',
          title: 'Media timestamps differ between renditions',
          detail: `Segment ${k + 1}: ${actual.map((x) => `${x.row.label} ${(x.cell.actual!.start - ref.cell.actual!.start >= 0 ? '+' : '')}${(x.cell.actual!.start - ref.cell.actual!.start).toFixed(3)} s`).join(' · ')} (relative to ${ref.row.label}). Switching quality there jumps or repeats video.`,
          where: 'all renditions',
          time: ref.cell.declaredStart,
        });
      }
      const d = actual.map((x) => x.cell.actual!.duration);
      if (Math.max(...d) - Math.min(...d) > Math.max(tol * 2, 0.05)) {
        issues.push({ severity: 'warn', code: 'align-duration', title: 'Segment durations differ between renditions', detail: `Segment ${k + 1}: ${actual.map((x) => `${x.row.label} ${fmt(x.cell.actual!.duration)}`).join(' · ')}.`, where: 'all renditions', time: actual[0].cell.declaredStart });
      }
    }
    // 3. Keyframes.
    for (const x of cells) {
      if (x.cell.actual?.startsWithKeyframe === false) {
        issues.push({ severity: 'error', code: 'align-keyframe', title: 'Segment does not start with a keyframe', detail: `Segment ${k + 1} (${fmt(x.cell.declaredStart)}): a player switching to this rendition there can't decode until the next keyframe.`, where: x.row.label, time: x.cell.declaredStart });
      }
    }
  }
  const rank = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
