import type { LoudnessReading } from '../audio/loudness';

/**
 * Confidence-monitoring alarms on what the viewer actually gets: black or
 * frozen picture, silence, a lost channel, loudness away from the target,
 * true peaks over the limit, and out-of-phase stereo. Each alarm needs its
 * condition to hold for a set time before it raises, and clears after the
 * condition has been gone for a second.
 */

export type AlarmType = 'black' | 'freeze' | 'silence' | 'channel' | 'loudness' | 'peak' | 'phase';

export const ALARM_LABELS: Record<AlarmType, string> = {
  black: 'Black picture',
  freeze: 'Frozen picture',
  silence: 'Silence',
  channel: 'Channel lost',
  loudness: 'Loudness off target',
  peak: 'True peak over limit',
  phase: 'Out of phase',
};

export interface AlarmSettings {
  enabled: Record<AlarmType, boolean>;
  /** Seconds the condition must last before the alarm raises. */
  hold: Record<Exclude<AlarmType, 'peak'>, number>;
  /** Average luma (0–100 %) under which the picture counts as black. */
  blackLevel: number;
  /** Average pixel change (0–100 %) under which the picture counts as frozen. */
  freezeLevel: number;
  /** dBFS under which a channel counts as silent. */
  silenceLevel: number;
  /** LU away from the target before loudness counts as off. */
  loudnessTolerance: number;
  /** dBTP limit for true peaks; null = the loudness standard's (EBU −1, ATSC −2). */
  peakLimit: number | null;
  /** L/R correlation under which stereo counts as out of phase. */
  phaseLevel: number;
}

export const DEFAULT_ALARMS: AlarmSettings = {
  enabled: { black: true, freeze: true, silence: true, channel: true, loudness: true, peak: true, phase: true },
  hold: { black: 2, freeze: 5, silence: 5, channel: 10, loudness: 20, phase: 5 },
  blackLevel: 6,
  freezeLevel: 0.2,
  silenceLevel: -60,
  loudnessTolerance: 6,
  peakLimit: null,
  phaseLevel: -0.3,
};

export interface AlarmEvent {
  id: number;
  type: AlarmType;
  start: Date;
  end?: Date;
  /** Presentation time when it started / ended. */
  mediaStart: number;
  mediaEnd?: number;
  detail: string;
}

/** Statistics of one sampled video frame. */
export interface FrameStats {
  /** Average luma, 0–1. */
  luma: number;
  /** Mean absolute luma change against the previous sample, 0–1 (null for the first). */
  change: number | null;
}

/** BT.709 luma of an RGBA buffer, plus the change against the previous one. */
export function frameStats(rgba: Uint8ClampedArray, previous: Float32Array | null): { stats: FrameStats; luma: Float32Array } {
  const n = rgba.length / 4;
  const luma = new Float32Array(n);
  let sum = 0;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    const y = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    luma[i] = y;
    sum += y;
    if (previous) diff += Math.abs(y - previous[i]);
  }
  return { stats: { luma: sum / n, change: previous && previous.length === n ? diff / n : null }, luma };
}

interface Condition {
  /** Presentation time when the condition started being true, or null. */
  since: number | null;
  /** Wall-clock ms when it started. */
  sinceWall: number;
  /** Presentation time when it was last seen true. */
  lastTrue: number;
  /** Presentation time of the last update (to spot seeks). */
  lastMedia: number;
}

/** Seconds of presentation time without the condition before an alarm clears. */
const RELEASE = 1;
const MAX_LOG = 1000;

export class AlarmMonitor {
  settings: AlarmSettings = structuredClone(DEFAULT_ALARMS);
  readonly log: AlarmEvent[] = [];
  readonly active = new Map<AlarmType, AlarmEvent>();
  /** Latest values, for display. */
  readonly last: { luma?: number; change?: number | null; shortTerm?: number; correlation?: number | null; peak?: number } = {};
  private conditions = new Map<AlarmType, Condition>();
  private seq = 0;
  private peakSeen = -Infinity;
  private listeners = new Set<(e: AlarmEvent, raised: boolean) => void>();

  onAlarm(fn: (e: AlarmEvent, raised: boolean) => void) {
    this.listeners.add(fn);
  }

  reset() {
    for (const e of this.active.values()) this.close(e, Date.now(), e.mediaStart);
    this.active.clear();
    this.conditions.clear();
    this.peakSeen = -Infinity;
  }

  clearLog() {
    this.log.length = 0;
  }

  /**
   * Updates one condition. `value` true = problem present, false = absent,
   * null = can't tell (paused, buffering): keeps the current state. Durations
   * are measured in presentation time, so they mean the same at any speed.
   */
  private track(type: Exclude<AlarmType, 'peak'>, value: boolean | null, now: number, media: number, detail: () => string) {
    if (value === null) return;
    if (!this.settings.enabled[type]) value = false;
    const c = this.conditions.get(type) ?? { since: null, sinceWall: now, lastTrue: media, lastMedia: media };
    // A seek starts the measurement again.
    if (media < c.lastMedia - 0.5 || media > c.lastMedia + 2) {
      c.since = null;
      const e = this.active.get(type);
      if (e) {
        this.active.delete(type);
        this.close(e, now, c.lastMedia);
      }
    }
    c.lastMedia = media;
    if (value) {
      if (c.since === null) {
        c.since = media;
        c.sinceWall = now;
      }
      c.lastTrue = media;
      if (!this.active.has(type) && media - c.since >= this.settings.hold[type]) {
        this.raise({ id: ++this.seq, type, start: new Date(c.sinceWall), mediaStart: c.since, detail: detail() });
      }
    } else if (c.since !== null && media - c.lastTrue >= RELEASE) {
      c.since = null;
      const e = this.active.get(type);
      if (e) {
        this.active.delete(type);
        this.close(e, now, c.lastTrue);
      }
    }
    this.conditions.set(type, c);
  }

  private raise(e: AlarmEvent) {
    this.active.set(e.type, e);
    this.log.push(e);
    if (this.log.length > MAX_LOG) this.log.shift();
    for (const fn of this.listeners) fn(e, true);
  }

  private close(e: AlarmEvent, at: number, media: number) {
    e.end = new Date(at);
    e.mediaEnd = media;
    for (const fn of this.listeners) fn(e, false);
  }

  /** A sampled frame while playing (`advancing` = the playhead moved since the last sample). */
  picture(stats: FrameStats | null, now: number, media: number, advancing: boolean) {
    if (!stats) {
      this.track('black', null, now, media, () => '');
      this.track('freeze', null, now, media, () => '');
      return;
    }
    this.last.luma = stats.luma;
    this.last.change = stats.change;
    const s = this.settings;
    this.track('black', stats.luma * 100 < s.blackLevel, now, media, () => `Average luma ${(stats.luma * 100).toFixed(1)} % (below ${s.blackLevel} %)`);
    // Frozen: time moves on but the picture doesn't change. Not judged while the playhead is stuck (buffering).
    const frozen = stats.change === null || !advancing ? null : stats.change * 100 < s.freezeLevel && stats.luma * 100 >= s.blackLevel;
    this.track('freeze', frozen, now, media, () => `Picture change ${((stats.change ?? 0) * 100).toFixed(3)} % between frames while playing`);
  }

  /** A loudness reading while playing (null = no audio measurable). */
  audio(r: LoudnessReading | null, now: number, media: number, target: number, maxTruePeak = -1) {
    if (!r || !r.channels.length) {
      for (const t of ['silence', 'channel', 'loudness', 'phase'] as const) this.track(t, null, now, media, () => '');
      return;
    }
    const s = this.settings;
    const peaks = r.channels.map((c) => c.peak);
    const maxPeak = Math.max(...peaks);
    this.last.shortTerm = r.shortTerm;
    this.last.correlation = r.correlation;
    this.last.peak = maxPeak;
    const silent = maxPeak < s.silenceLevel;
    this.track('silence', silent, now, media, () => `All channels below ${s.silenceLevel} dBFS`);

    const lost = silent ? [] : r.channels.filter((c) => c.label !== 'LFE' && c.peak < s.silenceLevel);
    const loud = r.channels.some((c) => c.label !== 'LFE' && c.rms > -40);
    this.track('channel', r.channels.length > 1 && !silent ? lost.length > 0 && loud : false, now, media, () => `${lost.map((c) => c.label).join(', ')} silent while other channels carry audio`);

    const off = Number.isFinite(r.shortTerm) && !silent ? Math.abs(r.shortTerm - target) > s.loudnessTolerance : silent ? null : false;
    this.track('loudness', off, now, media, () => `Short-term loudness ${r.shortTerm.toFixed(1)} LUFS, target ${target} ±${s.loudnessTolerance} LU`);

    const phase = r.correlation === null || silent ? false : r.correlation < s.phaseLevel;
    this.track('phase', phase, now, media, () => `L/R correlation ${r.correlation?.toFixed(2)} (below ${s.phaseLevel})`);

    // True peak: an instant event each time the running maximum goes over the limit by more.
    const limit = s.peakLimit ?? maxTruePeak;
    if (s.enabled.peak && r.truePeakMax > limit && r.truePeakMax > this.peakSeen + 0.5) {
      this.peakSeen = r.truePeakMax;
      const e: AlarmEvent = { id: ++this.seq, type: 'peak', start: new Date(now), end: new Date(now), mediaStart: media, mediaEnd: media, detail: `True peak ${r.truePeakMax.toFixed(1)} dBTP (limit ${limit} dBTP)` };
      this.log.push(e);
      for (const fn of this.listeners) fn(e, true);
    }
  }
}
