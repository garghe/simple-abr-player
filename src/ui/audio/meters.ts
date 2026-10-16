import type { ChannelLevel } from '../../audio/loudness';
import { h } from '../dom';

/** Bottom of the meter scale (dBFS). */
export const METER_FLOOR = -60;

export const levelToPercent = (db: number): number =>
  !Number.isFinite(db) ? 0 : Math.max(0, Math.min(100, ((db - METER_FLOOR) / -METER_FLOOR) * 100));

const fmt = (db: number) => (Number.isFinite(db) ? (db > -100 ? db.toFixed(1) : '-∞') : '-∞');

/**
 * A row of vertical peak meters (one per channel) with a peak-hold tick.
 * Colour zones: green below -18 dBFS, yellow to -6, red above. DOM is kept
 * and updated in place so CSS transitions give smooth movement at 10 Hz.
 */
export class MeterBank {
  readonly el: HTMLDivElement;
  private bars: { fill: HTMLElement; hold: HTMLElement; peak?: HTMLElement; holdText?: HTMLElement; root: HTMLElement }[] = [];
  private layout = '';

  constructor(private readonly opts: { size: 'small' | 'large'; values?: boolean }) {
    this.el = h('div', { class: `meter-bank ${opts.size}` });
  }

  update(channels: ChannelLevel[] | null, fallbackLabels: string[] = ['L', 'R']): void {
    const list = channels ?? fallbackLabels.map((label) => ({ label, peak: -Infinity, hold: -Infinity, rms: -Infinity }));
    const layout = list.map((c) => c.label).join(',');
    if (layout !== this.layout) this.build(list.map((c) => c.label));
    list.forEach((c, i) => {
      const b = this.bars[i];
      b.fill.style.setProperty('--level', `${levelToPercent(c.peak)}%`);
      b.hold.style.setProperty('--level', `${levelToPercent(c.hold)}%`);
      b.hold.hidden = !Number.isFinite(c.hold) || c.hold <= METER_FLOOR;
      b.root.classList.toggle('clip', c.hold >= -0.1);
      if (b.peak) b.peak.textContent = fmt(c.peak);
      if (b.holdText) b.holdText.textContent = fmt(c.hold);
    });
  }

  private build(labels: string[]) {
    this.layout = labels.join(',');
    this.bars = [];
    const scale =
      this.opts.size === 'large'
        ? h('div', { class: 'meter-scale', 'aria-hidden': 'true' }, [0, -6, -12, -18, -24, -36, -48, -60].map((v) =>
            h('span', { style: `bottom:${levelToPercent(v)}%` }, String(v)),
          ))
        : null;
    const channels = labels.map((label) => {
      const fill = h('div', { class: 'meter-fill' });
      const hold = h('div', { class: 'meter-hold' });
      const bar = h('div', { class: 'meter-bar' }, h('div', { class: 'meter-zones' }), fill, hold);
      const peak = this.opts.values ? h('span', { class: 'meter-value' }, '-∞') : undefined;
      const holdText = this.opts.values ? h('span', { class: 'meter-value hold' }, '-∞') : undefined;
      const root = h('div', { class: `meter-ch ${label === 'LFE' ? 'lfe' : ''}`, title: label }, bar, peak, holdText, h('span', { class: 'meter-label' }, label));
      this.bars.push({ fill, hold, peak, holdText, root });
      return root;
    });
    this.el.replaceChildren(...(scale ? [scale] : []), ...channels);
  }
}
