import { ALARM_LABELS, DEFAULT_ALARMS, type AlarmEvent, type AlarmMonitor, type AlarmSettings, type AlarmType } from '../../alarms/monitor';
import type { PictureSampler } from '../../alarms/picture';
import type { PlayerController } from '../../player/controller';
import { beep, enableNotifications, notify } from '../alert';
import { badge, dataTable, h } from '../dom';
import { timeLabel } from '../clock';

const SETTINGS_KEY = 'sap.alarms.v1';
const PREFS_KEY = 'sap.alarmAlerts.v1';
const PICTURE: AlarmType[] = ['black', 'freeze'];
const SOUND: AlarmType[] = ['silence', 'channel', 'loudness', 'peak', 'phase'];

export function loadAlarmSettings(): AlarmSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (v) return { ...DEFAULT_ALARMS, ...v, enabled: { ...DEFAULT_ALARMS.enabled, ...v.enabled }, hold: { ...DEFAULT_ALARMS.hold, ...v.hold } };
  } catch {
    /* storage unavailable or invalid */
  }
  return structuredClone(DEFAULT_ALARMS);
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Alarm log as CSV. */
export function alarmsToCsv(log: AlarmEvent[]): string {
  const rows = log.map((e) =>
    [
      e.start.toISOString(),
      e.end?.toISOString(),
      e.mediaEnd !== undefined ? (e.mediaEnd - e.mediaStart).toFixed(1) : '',
      e.mediaStart.toFixed(3),
      e.mediaEnd?.toFixed(3),
      ALARM_LABELS[e.type],
      e.detail,
    ]
      .map(csvCell)
      .join(','),
  );
  return ['start_utc,end_utc,duration_s,media_start_s,media_end_s,alarm,detail', ...rows].join('\r\n') + '\r\n';
}

/**
 * Alarms tab: picture and sound status, live values, the alarm log, alert
 * options and thresholds.
 */
export class AlarmsTab {
  readonly el = h('div', { class: 'tab-pane alarms' });
  private status = h('div', { class: 'alarm-status' });
  private logEl = h('div');
  private prefs = { sound: true, notify: false };

  constructor(
    private readonly ctrl: PlayerController,
    private readonly alarms: AlarmMonitor,
    private readonly sampler: PictureSampler,
    private readonly toast: (msg: string) => void,
  ) {
    try {
      Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
    } catch {
      /* storage unavailable */
    }
    alarms.onAlarm((e, raised) => {
      if (!raised || !this.ctrl.loadedUrl) return;
      if (this.prefs.sound) beep(PICTURE.includes(e.type) ? [520, 520, 520] : [700, 500, 700]);
      if (this.prefs.notify) notify(`${ALARM_LABELS[e.type]}`, `${timeLabel(this.ctrl)(e.mediaStart)} · ${e.detail}`, `playprobe-alarm-${e.type}`);
    });
    this.el.append(this.status, h('h3', null, 'Alarm log'), this.logEl, this.settingsEl());
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
  }

  private saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.alarms.settings));
    } catch {
      /* storage unavailable */
    }
  }

  render() {
    const a = this.alarms;
    const pictureNote: Record<string, string> = {
      idle: 'waiting for playback',
      ok: '',
      drm: 'not available: protected (DRM) video cannot be read',
      blocked: 'not available: the browser does not allow reading this video (cross-origin)',
    };
    const tile = (title: string, types: AlarmType[], values: string, note = '') => {
      const active = types.filter((t) => a.active.has(t));
      return h(
        'div',
        { class: `alarm-tile ${active.length ? 'alarm-on' : note ? 'alarm-na' : 'alarm-ok'}` },
        h('div', { class: 'alarm-title' }, title),
        h(
          'div',
          { class: 'alarm-state' },
          active.length
            ? active.map((t) => h('div', null, badge(ALARM_LABELS[t].toUpperCase(), 'warn'), h('span', { class: 'small' }, ` since ${timeLabel(this.ctrl)(a.active.get(t)!.mediaStart)}`)))
            : note
              ? h('span', { class: 'muted small' }, note)
              : badge('OK', 'ok'),
        ),
        h('div', { class: 'muted small mono' }, values),
      );
    };
    const l = a.last;
    this.status.replaceChildren(
      tile(
        'Picture',
        PICTURE,
        l.luma !== undefined ? `luma ${(l.luma * 100).toFixed(1)} % · change ${l.change !== null && l.change !== undefined ? (l.change * 100).toFixed(2) : '—'} %` : '',
        this.ctrl.loadedUrl ? pictureNote[this.sampler.state] : 'load a stream',
      ),
      tile(
        'Sound',
        SOUND,
        l.shortTerm !== undefined ? `short-term ${Number.isFinite(l.shortTerm) ? l.shortTerm.toFixed(1) : '—'} LUFS · peak ${l.peak !== undefined && Number.isFinite(l.peak) ? l.peak.toFixed(1) : '—'} dBFS${l.correlation !== null && l.correlation !== undefined ? ` · corr ${l.correlation.toFixed(2)}` : ''}` : '',
        this.ctrl.loadedUrl ? (l.shortTerm === undefined ? 'waiting for audio meters' : '') : 'load a stream',
      ),
    );
    const log = [...a.log].reverse();
    this.logEl.replaceChildren(
      h(
        'div',
        { class: 'toolbar' },
        h('span', { class: 'muted small' }, `${a.log.length} alarm${a.log.length === 1 ? '' : 's'} this session`),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', onclick: () => this.exportCsv() }, 'Export CSV'),
        h('button', { type: 'button', onclick: () => (a.clearLog(), this.render()) }, 'Clear'),
      ),
      dataTable(
        ['Time', 'Alarm', 'Duration', 'Detail'],
        log.slice(0, 200).map((e) => [
          h('button', { type: 'button', class: 'linklike mono', title: e.start.toISOString(), onclick: () => (this.ctrl.video.currentTime = Math.max(0, e.mediaStart - 1)) }, timeLabel(this.ctrl)(e.mediaStart)),
          badge(ALARM_LABELS[e.type], e.end ? 'out' : 'warn'),
          e.mediaEnd !== undefined ? `${(e.mediaEnd - e.mediaStart).toFixed(1)} s` : 'active',
          h('span', { class: 'small' }, e.detail),
        ]),
        'compact',
      ),
    );
  }

  private exportCsv() {
    if (!this.alarms.log.length) {
      this.toast('No alarms to export');
      return;
    }
    const a = h('a', {
      href: URL.createObjectURL(new Blob([alarmsToCsv(this.alarms.log)], { type: 'text/csv' })),
      download: `playprobe-alarms-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private settingsEl(): HTMLElement {
    const s = this.alarms.settings;
    const num = (get: () => number | null, set: (v: number | null) => void, attrs: Record<string, string> = {}, allowEmpty = false) => {
      const v = get();
      const el = h('input', { type: 'number', class: 'lead-input', value: v === null ? '' : String(v), ...attrs });
      el.addEventListener('change', () => {
        if (allowEmpty && el.value.trim() === '') set(null);
        else if (Number.isFinite(Number(el.value))) set(Number(el.value));
        this.saveSettings();
      });
      return el;
    };
    const enabled = (t: AlarmType) => {
      const box = h('input', { type: 'checkbox', checked: s.enabled[t] });
      box.addEventListener('change', () => {
        s.enabled[t] = box.checked;
        this.saveSettings();
      });
      return box;
    };
    const hold = (t: Exclude<AlarmType, 'peak'>) => num(() => s.hold[t], (v) => (s.hold[t] = Math.max(0, v ?? 0)), { min: '0', step: '1', 'aria-label': `${ALARM_LABELS[t]} hold time` });
    const row = (t: AlarmType, threshold: HTMLElement | string, holdEl: HTMLElement | string) => [h('label', null, enabled(t), ` ${ALARM_LABELS[t]}`), threshold, holdEl];
    const toggle = (label: string, key: 'sound' | 'notify') => {
      const box = h('input', { type: 'checkbox', checked: this.prefs[key] });
      box.addEventListener('change', async () => {
        this.prefs[key] = box.checked;
        this.savePrefs();
        if (key === 'sound' && box.checked) beep([700, 500, 700]);
        if (key === 'notify' && box.checked) {
          const problem = await enableNotifications();
          if (problem) this.toast(problem);
        }
      });
      return h('label', null, box, ` ${label}`);
    };
    return h(
      'details',
      { class: 'decoder' },
      h('summary', null, 'Alerts and thresholds'),
      h('div', { class: 'monitor-controls' }, toggle('Sound when an alarm raises', 'sound'), toggle('Browser notification', 'notify')),
      dataTable(
        ['Alarm', 'Threshold', 'For at least'],
        [
          row('black', h('span', null, 'average luma below ', num(() => s.blackLevel, (v) => (s.blackLevel = v ?? 6), { step: '0.5' }), ' %'), h('span', null, hold('black'), ' s')),
          row('freeze', h('span', null, 'picture change below ', num(() => s.freezeLevel, (v) => (s.freezeLevel = v ?? 0.2), { step: '0.05' }), ' %'), h('span', null, hold('freeze'), ' s')),
          row('silence', h('span', null, 'all channels below ', num(() => s.silenceLevel, (v) => (s.silenceLevel = v ?? -60), { step: '1' }), ' dBFS'), h('span', null, hold('silence'), ' s')),
          row('channel', 'one channel (not LFE) below the silence level while others play', h('span', null, hold('channel'), ' s')),
          row('loudness', h('span', null, 'short-term more than ', num(() => s.loudnessTolerance, (v) => (s.loudnessTolerance = v ?? 6), { step: '0.5' }), ' LU from the target'), h('span', null, hold('loudness'), ' s')),
          row('peak', h('span', null, 'true peak above ', num(() => s.peakLimit, (v) => (s.peakLimit = v), { step: '0.5', placeholder: 'standard' }, true), ' dBTP (empty: the standard’s limit)'), 'instant'),
          row('phase', h('span', null, 'L/R correlation below ', num(() => s.phaseLevel, (v) => (s.phaseLevel = v ?? -0.3), { step: '0.1' })), h('span', null, hold('phase'), ' s')),
        ],
        'compact',
      ),
      h('p', { class: 'muted small' }, 'The loudness target follows the standard chosen in the Audio tab (EBU R128 −23 LUFS, ATSC A/85 −24 LKFS). Picture alarms need readable video: not available for DRM-protected streams.'),
    );
  }
}
