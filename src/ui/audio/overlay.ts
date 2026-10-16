import type { AudioEngine } from '../../audio/engine';
import { STANDARDS } from '../../audio/loudness';
import { audioPrefs } from '../../audio/prefs';
import type { PlayerController } from '../../player/controller';
import { h } from '../dom';
import { MeterBank } from './meters';

/** Compact per-channel meters + short-term loudness, top-right on the video. */
export class AudioOverlay {
  private bank = new MeterBank({ size: 'small' });
  private loudness = h('span', { class: 'ov-loudness', title: 'Short-term loudness (3 s)' });
  private start = h('button', { type: 'button', class: 'ov-start' }, 'Click to start audio meters');
  private message = h('span', { class: 'ov-loudness' });

  constructor(
    private readonly el: HTMLElement,
    private readonly engine: AudioEngine,
    private readonly ctrl: PlayerController,
  ) {
    this.start.onclick = () => void engine.start();
    el.title = 'Audio levels (a) · details in the Audio tab';
    engine.on('levels', () => this.render());
    engine.on('state', () => this.render());
    ctrl.on('tick', () => this.render());
    audioPrefs.onChange(() => this.render());
    ctrl.on('loaded', () => this.render());
    this.render();
  }

  render(): void {
    const visible = audioPrefs.overlay && Boolean(this.ctrl.loadedUrl) && !this.ctrl.player.isVideoOnly();
    this.el.hidden = !visible;
    if (!visible) return;
    const e = this.engine;
    if (!e.reading && e.stream.status !== 'active') {
      if (e.needsGesture) {
        this.el.replaceChildren(this.start);
        return;
      }
      if (e.state === 'unsupported' || e.state === 'error') {
        this.message.textContent = 'meters unavailable';
        this.el.replaceChildren(this.message);
        return;
      }
    }
    const r = e.reading;
    this.bank.update(r?.channels ?? null);
    const s = STANDARDS[audioPrefs.standard];
    this.loudness.textContent =
      r && Number.isFinite(r.shortTerm) ? `${r.shortTerm.toFixed(1)} ${s.unit}` : `— ${s.unit}`;
    if (this.el.firstChild !== this.bank.el) this.el.replaceChildren(this.bank.el, this.loudness);
  }
}
