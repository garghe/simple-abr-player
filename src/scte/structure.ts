import { buildTimeline, type LaneId, type TimelineSpan } from './timeline';
import type { ScteEvent } from './monitor';

/**
 * Programme structure: segmentation spans nested by time, programme →
 * chapter → break → placement opportunity → advertisement.
 */

export interface StructureNode {
  span: TimelineSpan;
  children: StructureNode[];
}

const RANK: Partial<Record<LaneId, number>> = { programme: 0, chapter: 1, breaks: 2, break: 2, po: 3, ad: 4, promo: 4, other: 5 };

export function buildStructure(events: ScteEvent[], horizon: number | null): StructureNode[] {
  const spans = buildTimeline(events, horizon)
    .spans.filter((s) => RANK[s.lane] !== undefined)
    .sort((a, b) => a.start - b.start || RANK[a.lane]! - RANK[b.lane]! || b.end - a.end);
  const roots: StructureNode[] = [];
  const stack: StructureNode[] = [];
  const tol = 0.5;
  for (const span of spans) {
    const node = { span, children: [] };
    while (stack.length) {
      const top = stack[stack.length - 1].span;
      const contains = span.start >= top.start - tol && span.end <= top.end + tol;
      if (contains && RANK[top.lane]! < RANK[span.lane]!) break;
      stack.pop();
    }
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}
