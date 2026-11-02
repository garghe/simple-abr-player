import { isoDuration } from '../scte/ssai';

/**
 * The parts of an MPD the stream checks need: type, max segment duration,
 * periods, and every SegmentTimeline with the representation it belongs to.
 */

export interface TimelineEntry {
  /** Start, in timescale units. */
  t: number;
  d: number;
}

export interface MpdTimeline {
  /** "video 1280×720 (id 3)" or the AdaptationSet's content type. */
  label: string;
  timescale: number;
  entries: TimelineEntry[];
}

export interface MpdSummary {
  dynamic: boolean;
  maxSegmentDuration?: number;
  minimumUpdatePeriod?: number;
  periods: { id?: string; start?: number; duration?: number }[];
  timelines: MpdTimeline[];
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

function lastTagBefore(text: string, pos: number, name: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`, 'g');
  let found: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < pos) found = m[0];
  return found;
}

export function parseMpd(mpd: string): MpdSummary {
  const root = mpd.match(/<(?:\w+:)?MPD\b[^>]*>/)?.[0] ?? '';
  const periods = [...mpd.matchAll(/<(?:\w+:)?Period\b([^>]*)>/g)].map((m) => ({
    id: attr(m[1], 'id'),
    start: isoDuration(attr(m[1], 'start')),
    duration: isoDuration(attr(m[1], 'duration')),
  }));
  const timelines: MpdTimeline[] = [];
  for (const m of mpd.matchAll(/<(?:\w+:)?SegmentTimeline\b[^>]*>([\s\S]*?)<\/(?:\w+:)?SegmentTimeline>/g)) {
    const pos = m.index ?? 0;
    const template = lastTagBefore(mpd, pos, 'SegmentTemplate') ?? '';
    const set = lastTagBefore(mpd, pos, 'AdaptationSet') ?? '';
    // A timeline inside a Representation belongs to it; otherwise it is shared by the AdaptationSet.
    const rep = lastTagBefore(mpd, pos, 'Representation');
    const repInside = rep && mpd.lastIndexOf(rep, pos) > mpd.lastIndexOf(set, pos);
    const kind = attr(set, 'contentType') ?? attr(set, 'mimeType')?.split('/')[0] ?? attr(rep ?? '', 'mimeType')?.split('/')[0] ?? 'media';
    const size = repInside && attr(rep!, 'width') ? ` ${attr(rep!, 'width')}×${attr(rep!, 'height')}` : '';
    const label = `${kind}${size}${repInside ? ` (id ${attr(rep!, 'id') ?? '?'})` : attr(set, 'id') ? ` (set ${attr(set, 'id')})` : ''}`;
    const timescale = Number(attr(template, 'timescale') ?? 1) || 1;
    const entries: TimelineEntry[] = [];
    let next = 0;
    for (const s of m[1].matchAll(/<(?:\w+:)?S\b([^>]*)\/?>/g)) {
      const t = attr(s[1], 't');
      const d = Number(attr(s[1], 'd') ?? 0);
      const r = Number(attr(s[1], 'r') ?? 0);
      let start = t !== undefined ? Number(t) : next;
      // r = -1 repeats to the next S or the period end: count it once here.
      for (let i = 0; i <= Math.max(0, r); i++) {
        entries.push({ t: start, d });
        start += d;
      }
      next = start;
    }
    timelines.push({ label, timescale, entries });
  }
  return {
    dynamic: attr(root, 'type') === 'dynamic',
    maxSegmentDuration: isoDuration(attr(root, 'maxSegmentDuration')),
    minimumUpdatePeriod: isoDuration(attr(root, 'minimumUpdatePeriod')),
    periods,
    timelines,
  };
}
