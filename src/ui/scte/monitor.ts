import type { PlayerController } from '../../player/controller';
import { hourlyCounts, markersToCsv } from '../../scte/csv';
import type { ScteEvent } from '../../scte/monitor';
import { badge, dataTable, h } from '../dom';
import { formatTime } from '../format';
import type { HealthCache } from './health';

const PREFS_KEY = 'sap.scteAlerts.v1';

interface AlertPrefs {
  sound: boolean;
  notify: boolean;
  /** Alert only for OUT/IN markers (not content IDs, heartbeats…). */
  breaksOnly: boolean;
}

/**
 * Alerts for markers that arrive while watching (sound and/or a browser
 * notification), for leaving a live channel running. Markers already known
 * when an alert is switched on, or present at load, don't alert.
 */
export class ScteAlerts {
  prefs: AlertPrefs = { sound: false, notify: false, breaksOnly: true };
  private known = new Set<string>();
  private audio: AudioContext | null = null;
  private loadedAt = 0;
  count = 0;

  constructor(private readonly ctrl: PlayerController) {
    try {
      Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
    } catch {
      /* storage unavailable */
    }
    ctrl.on('loaded', () => {
      this.loadedAt = Date.now();
      this.known = new Set(ctrl.scte.list().map((e) => e.key));
      this.count = 0;
    });
    ctrl.on('scte', () => this.check());
  }

  save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
  }

  private check() {
    const fresh = this.ctrl.scte.list().filter((e) => !this.known.has(e.key));
    for (const e of fresh) this.known.add(e.key);
    // Markers parsed right after loading are the stream's backlog, not news.
    if (!this.ctrl.loadedUrl || Date.now() - this.loadedAt < 3000) return;
    const alerting = fresh.filter((e) => !this.prefs.breaksOnly || e.direction !== 'other');
    if (!alerting.length) return;
    this.count += alerting.length;
    if (this.prefs.sound) this.beep(alerting[0].direction);
    if (this.prefs.notify && 'Notification' in window && Notification.permission === 'granted') {
      const e = alerting[0];
      new Notification(`SCTE-35 ${e.direction === 'out' ? 'OUT' : e.direction === 'in' ? 'IN' : 'marker'}${alerting.length > 1 ? ` (+${alerting.length - 1})` : ''}`, {
        body: `${e.startTime !== null ? `${formatTime(e.startTime)} · ` : ''}${e.summary}`,
        tag: 'playprobe-scte',
      });
    }
  }

  /** OUT: high → low, IN: low → high, other: one short tone. */
  beep(direction: ScteEvent['direction']) {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      void ctx.resume();
      const tones = direction === 'out' ? [880, 660] : direction === 'in' ? [660, 880] : [740];
      tones.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.16;
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } catch {
      /* no Web Audio */
    }
  }
}

/** Monitor sub-view: alert switches, counts per hour and CSV export. */
export class MonitorView {
  readonly el = h('div', { class: 'scte-monitor' });
  private controls = h('div', { class: 'monitor-controls' });
  private body = h('div');

  constructor(
    private readonly ctrl: PlayerController,
    private readonly alerts: ScteAlerts,
    private readonly health: HealthCache,
    private readonly toast: (msg: string) => void,
  ) {
    const p = alerts.prefs;
    const toggle = (label: string, key: keyof AlertPrefs, onChange?: (on: boolean) => void) => {
      const box = h('input', { type: 'checkbox', checked: p[key] });
      box.addEventListener('change', () => {
        p[key] = box.checked;
        alerts.save();
        onChange?.(box.checked);
      });
      return h('label', null, box, ` ${label}`);
    };
    this.controls.append(
      toggle('Sound on new markers', 'sound', (on) => on && alerts.beep('out')),
      toggle('Browser notification', 'notify', (on) => {
        if (!on || !('Notification' in window)) return;
        if (Notification.permission === 'default') void Notification.requestPermission().then((r) => r !== 'granted' && toast('Notifications are blocked for this page'));
        else if (Notification.permission === 'denied') toast('Notifications are blocked for this page: allow them in the browser settings');
      }),
      toggle('Only OUT / IN markers', 'breaksOnly'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', onclick: () => this.exportCsv() }, 'Export CSV'),
    );
    this.el.append(this.controls, this.body);
  }

  render() {
    const events = this.ctrl.scte.list();
    const live = Boolean(this.ctrl.loadedUrl) && this.ctrl.player.isLive();
    const rows = hourlyCounts(events, live);
    this.body.replaceChildren(
      h(
        'p',
        { class: 'small muted' },
        `Alerts fire for markers that arrive after loading (${this.alerts.count} so far), so keep this page open on a live channel. `,
        live ? 'Counts by the hour the marker was first seen (UTC).' : 'Counts by programme hour.',
      ),
      rows.length
        ? dataTable(
            ['Hour', 'OUT', 'IN', 'Other', 'Total'],
            rows.map((r) => [h('span', { class: 'mono' }, r.hour), badge(String(r.out), r.out ? 'out' : ''), badge(String(r.in), r.in ? 'in' : ''), String(r.other), String(r.out + r.in + r.other)]),
            'compact',
          )
        : h('p', { class: 'muted' }, 'No markers yet.'),
    );
  }

  private exportCsv() {
    const events = this.ctrl.scte.list();
    if (!events.length) {
      this.toast('No markers to export yet');
      return;
    }
    const csv = markersToCsv(events, this.health.get(), (t) => this.ctrl.wallClockAt(t));
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `playprobe-scte-${new Date().toISOString().replace(/[:.]/g, '-')}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
