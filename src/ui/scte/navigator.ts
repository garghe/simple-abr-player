import type { PlayerController } from '../../player/controller';
import { breakEnd, nextBreakStart, nextMarker, previousMarker } from '../../scte/navigation';
import { h } from '../dom';
import { formatTime } from '../format';

const PREROLL_KEY = 'sap.sctePreroll.v1';
export const PREROLL_CHOICES = [3, 5, 10, 20, 30];

/**
 * Marker and ad-break navigation, shared by the keyboard shortcuts
 * (n / p / b / s), the SCTE tab toolbar and the ad-break banner.
 */
export class ScteNavigator {
  preroll = 10;

  constructor(
    private readonly ctrl: PlayerController,
    private readonly toast: (msg: string) => void,
  ) {
    try {
      const v = Number(localStorage.getItem(PREROLL_KEY));
      if (PREROLL_CHOICES.includes(v)) this.preroll = v;
    } catch {
      /* storage unavailable */
    }
  }

  setPreroll(v: number) {
    this.preroll = v;
    try {
      localStorage.setItem(PREROLL_KEY, String(v));
    } catch {
      /* storage unavailable */
    }
  }

  private get now() {
    return this.ctrl.video.currentTime;
  }

  private seek(t: number, label: string) {
    this.ctrl.video.currentTime = Math.max(0, t);
    this.toast(`${label} · ${formatTime(Math.max(0, t))}`);
  }

  next() {
    const t = nextMarker(this.ctrl.scte.list(), this.now);
    if (t === null) this.toast('No later marker');
    else this.seek(t, 'Next marker');
  }

  previous() {
    const t = previousMarker(this.ctrl.scte.list(), this.now);
    if (t === null) this.toast('No earlier marker');
    else this.seek(t, 'Previous marker');
  }

  beforeNextBreak() {
    const t = nextBreakStart(this.ctrl.scte.list(), this.now, this.preroll);
    if (t === null) this.toast('No later ad break');
    else this.seek(t - this.preroll, `${this.preroll} s before the break at ${formatTime(t)}`);
  }

  skipBreak() {
    const events = this.ctrl.scte.list();
    const end = breakEnd(events, this.now, this.ctrl.scte.activeBreak(this.now));
    if (end === null) this.toast(this.ctrl.scte.activeBreak(this.now) ? 'This break has no known end yet' : 'Not in an ad break');
    else this.seek(end + 0.05, 'Skipped the break');
  }

  /** Buttons for the SCTE tab. */
  toolbar(): HTMLElement {
    const preroll = h(
      'select',
      { 'aria-label': 'Seconds before the break', title: 'How far before the break "Before next break" lands' },
      PREROLL_CHOICES.map((v) => h('option', { value: String(v), selected: v === this.preroll }, `${v} s`)),
    );
    preroll.addEventListener('change', () => this.setPreroll(Number(preroll.value)));
    return h(
      'div',
      { class: 'toolbar scte-nav' },
      h('button', { type: 'button', title: 'Previous marker (p)', onclick: () => this.previous() }, '⏮ Marker'),
      h('button', { type: 'button', title: 'Next marker (n)', onclick: () => this.next() }, 'Marker ⏭'),
      h('button', { type: 'button', title: 'Jump to just before the next break (b)', onclick: () => this.beforeNextBreak() }, 'Before next break'),
      preroll,
      h('button', { type: 'button', title: 'Skip to the end of the current break (s)', onclick: () => this.skipBreak() }, 'Skip break'),
    );
  }
}
