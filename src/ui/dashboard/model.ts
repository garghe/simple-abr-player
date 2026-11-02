/**
 * Data for the dashboard cards, as pure functions: the health score, the
 * events feed and the bitrate ladder.
 */

export type Severity = 'error' | 'warn' | 'info';
export type PartStatus = 'ok' | 'warn' | 'bad' | 'na';

export interface ScorePart {
  id: 'stream' | 'alignment' | 'scte' | 'alarms' | 'drm';
  label: string;
  status: PartStatus;
  text: string;
  /** Tab that shows the detail. */
  tab: string;
}

export interface ScoreInput {
  stream: { severity: Severity }[];
  /** Last rendition alignment result, or null if not checked. */
  alignment: { severity: Severity }[] | null;
  scte: { severity: Severity }[];
  scteMarkers: number;
  alarmsActive: number;
  alarmsLogged: number;
  /** null = clear stream. */
  drm: { name: string; licenseErrors: number; badKeys: number; expiresInHours: number | null } | null;
}

const penalty = (issues: { severity: Severity }[], cap = 30) =>
  Math.min(cap, issues.reduce((n, i) => n + (i.severity === 'error' ? 10 : i.severity === 'warn' ? 4 : 0), 0));

const describe = (issues: { severity: Severity }[], okText: string): [PartStatus, string] => {
  const e = issues.filter((i) => i.severity === 'error').length;
  const w = issues.filter((i) => i.severity === 'warn').length;
  if (e) return ['bad', `${e} error${e > 1 ? 's' : ''}${w ? ` · ${w} warning${w > 1 ? 's' : ''}` : ''}`];
  if (w) return ['warn', `${w} warning${w > 1 ? 's' : ''}`];
  return ['ok', okText];
};

/** 0–100: 100 minus penalties per area (errors 10, warnings 4, capped per area). */
export function healthScore(i: ScoreInput): { score: number; parts: ScorePart[] } {
  const parts: ScorePart[] = [];
  let lost = 0;

  const [ss, st] = describe(i.stream, 'OK');
  parts.push({ id: 'stream', label: 'Stream & segments', status: ss, text: st, tab: 'health' });
  lost += penalty(i.stream);

  if (i.alignment) {
    const [as, at] = describe(i.alignment, 'Aligned');
    parts.push({ id: 'alignment', label: 'Rendition alignment', status: as, text: at, tab: 'health' });
    lost += penalty(i.alignment, 20);
  } else {
    parts.push({ id: 'alignment', label: 'Rendition alignment', status: 'na', text: 'Not checked', tab: 'health' });
  }

  if (i.scteMarkers) {
    const [cs, ct] = describe(i.scte, 'OK');
    parts.push({ id: 'scte', label: 'SCTE-35 signalling', status: cs, text: ct, tab: 'scte' });
    lost += penalty(i.scte, 20);
  } else {
    parts.push({ id: 'scte', label: 'SCTE-35 signalling', status: 'na', text: 'No markers', tab: 'scte' });
  }

  if (i.alarmsActive) {
    parts.push({ id: 'alarms', label: 'Picture & sound', status: 'bad', text: `${i.alarmsActive} active alarm${i.alarmsActive > 1 ? 's' : ''}`, tab: 'alarms' });
  } else {
    parts.push({ id: 'alarms', label: 'Picture & sound', status: i.alarmsLogged ? 'warn' : 'ok', text: i.alarmsLogged ? `${i.alarmsLogged} earlier` : 'No alarms', tab: 'alarms' });
  }
  lost += Math.min(45, i.alarmsActive * 15) + Math.min(10, i.alarmsLogged * 2);

  if (i.drm) {
    const bad = i.drm.licenseErrors + i.drm.badKeys;
    const hours = i.drm.expiresInHours;
    parts.push({
      id: 'drm',
      label: `DRM · ${i.drm.name}`,
      status: bad ? 'bad' : 'ok',
      text: bad ? `${bad} problem${bad > 1 ? 's' : ''}` : hours !== null ? `Licence ${hours < 1 ? '< 1 h' : `${Math.round(hours)} h`}` : 'Licence OK',
      tab: 'drm',
    });
    lost += Math.min(30, bad * 15);
  } else {
    parts.push({ id: 'drm', label: 'DRM', status: 'na', text: 'Clear stream', tab: 'drm' });
  }

  return { score: Math.max(0, Math.round(100 - lost)), parts };
}

export interface FeedItem {
  at: Date;
  kind: 'scte-out' | 'scte-in' | 'scte' | 'alarm' | 'error' | 'warn' | 'info' | 'quality';
  title: string;
  detail?: string;
  /** SCTE marker key, to open it. */
  key?: string;
  /** Presentation time, to seek. */
  time?: number;
}

/** Merges log lines, SCTE markers and alarms, newest first. */
export function buildFeed(
  log: { at: Date; level: 'info' | 'warn' | 'error'; message: string }[],
  markers: { key: string; receivedAt: Date; direction: 'out' | 'in' | 'other'; summary: string; startTime: number | null; duration?: number }[],
  alarms: { start: Date; type: string; label: string; detail: string; mediaStart: number }[],
  max = 40,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const l of log) {
    const quality = /^(ABR switch|Variant changed)/.test(l.message);
    items.push({ at: l.at, kind: quality ? 'quality' : l.level, title: l.message.split(' — ')[0], detail: l.message.includes(' — ') ? l.message.split(' — ').slice(1).join(' — ') : undefined });
  }
  for (const m of markers) {
    items.push({
      at: m.receivedAt,
      kind: m.direction === 'out' ? 'scte-out' : m.direction === 'in' ? 'scte-in' : 'scte',
      title: `SCTE-35 ${m.direction === 'out' ? 'OUT' : m.direction === 'in' ? 'IN' : 'marker'}`,
      detail: m.summary,
      key: m.key,
      time: m.startTime ?? undefined,
    });
  }
  for (const a of alarms) items.push({ at: a.start, kind: 'alarm', title: a.label, detail: a.detail, time: a.mediaStart });
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, max);
}

export interface Rung {
  height: number;
  width: number;
  /** Declared bits/s. */
  declared: number;
  /** Measured average bits/s of downloaded video segments, if any. */
  measured?: number;
  active: boolean;
  /** Measured above declared (HLS: peak over BANDWIDTH; DASH: average over @bandwidth). */
  over: boolean;
}

/** One rung per video resolution/bitrate, lowest first. */
export function buildLadder(
  tracks: { height: number | null; width: number | null; bandwidth: number; videoBandwidth?: number | null; active: boolean; videoId: number | null }[],
  measured: Map<number, { avg: number; peak: number }>,
  format: 'HLS' | 'DASH' | string,
): Rung[] {
  const byVideo = new Map<string, Rung>();
  for (const t of tracks) {
    if (!t.height) continue;
    const key = `${t.height}:${t.videoId ?? t.bandwidth}`;
    const declared = t.videoBandwidth || t.bandwidth;
    const m = t.videoId !== null ? measured.get(t.videoId) : undefined;
    const prev = byVideo.get(key);
    const rung: Rung = {
      height: t.height,
      width: t.width ?? 0,
      declared: prev ? Math.max(prev.declared, declared) : declared,
      measured: m?.avg,
      active: Boolean(prev?.active || t.active),
      over: m ? (format === 'HLS' ? m.peak > t.bandwidth * 1.1 : m.avg > declared * 1.25) : false,
    };
    byVideo.set(key, rung);
  }
  return [...byVideo.values()].sort((a, b) => a.declared - b.declared);
}
