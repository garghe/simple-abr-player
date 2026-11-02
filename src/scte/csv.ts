import type { HealthIssue } from './health';
import type { ScteEvent } from './monitor';
import { markerTiming } from './timing';

/** One CSV row per marker, for spreadsheets and incident reports. */

const COLUMNS = [
  'presentation_time_s',
  'wall_clock_utc',
  'first_seen_utc',
  'source',
  'direction',
  'event_id',
  'command',
  'duration_s',
  'segmentation',
  'lead_time_s',
  'segment_offset_s',
  'crc_ok',
  'issues',
  'summary',
  'raw',
];

const cell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function markersToCsv(events: ScteEvent[], issues: HealthIssue[], wallClock: (t: number) => Date | null): string {
  const byKey = new Map<string, string[]>();
  for (const i of issues) for (const k of i.keys) byKey.set(k, [...(byKey.get(k) ?? []), `${i.severity}: ${i.title}`]);
  const rows = events.map((e) => {
    const t = markerTiming(e);
    const wall = e.hls?.date ?? (e.startTime !== null ? wallClock(e.startTime) : null);
    const seg = (e.section?.descriptors ?? [])
      .filter((d) => 'segmentationTypeName' in d)
      .map((d) => {
        const s = d as { segmentationTypeId?: number; segmentationTypeName?: string; segmentationEventId: number; upidTypeName?: string; upid?: string };
        return `${s.segmentationTypeName} #${s.segmentationEventId}${s.upid ? ` ${s.upidTypeName}=${s.upid}` : ''}`;
      })
      .join(' | ');
    return [
      e.startTime?.toFixed(3),
      wall?.toISOString(),
      e.receivedAt.toISOString(),
      e.source,
      e.direction,
      e.eventId,
      e.section?.spliceCommandName,
      e.duration?.toFixed(3),
      seg,
      t.lead?.toFixed(3),
      t.segmentOffset?.toFixed(3),
      e.section ? (e.section.crcValid ? 'yes' : 'no') : '',
      (byKey.get(e.key) ?? []).join(' | '),
      e.summary,
      e.raw,
    ]
      .map(cell)
      .join(',');
  });
  return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Marker counts per hour (UTC), by when they were first seen (live) or their programme time (VOD). */
export function hourlyCounts(events: ScteEvent[], live: boolean): { hour: string; out: number; in: number; other: number }[] {
  const map = new Map<string, { hour: string; out: number; in: number; other: number }>();
  for (const e of events) {
    let hour: string;
    if (live) hour = `${e.receivedAt.toISOString().slice(0, 13)}:00Z`;
    else if (e.startTime !== null) hour = `${String(Math.floor(e.startTime / 3600)).padStart(2, '0')}:00–${String(Math.floor(e.startTime / 3600) + 1).padStart(2, '0')}:00`;
    else continue;
    const row = map.get(hour) ?? { hour, out: 0, in: 0, other: 0 };
    row[e.direction]++;
    map.set(hour, row);
  }
  return [...map.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}
