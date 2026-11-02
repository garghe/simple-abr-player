import type { PlayerController } from '../../player/controller';
import { SCTE_LANES, buildTimeline, type LaneId } from '../../scte/timeline';
import { h } from '../dom';
import { formatTime } from '../format';
import type { HealthCache } from './health';

const NS = 'http://www.w3.org/2000/svg';
const LABEL_W = 118;
const ROW_H = 24;
const AXIS_H = 22;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, title?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (title) {
    const t = document.createElementNS(NS, 'title');
    t.textContent = title;
    el.append(t);
  }
  return el;
}

type Zoom = 'all' | '600' | '120' | '30';

interface Picked {
  time: number;
  text: string;
  key?: string;
}

/**
 * Timeline sub-view: one lane per kind of signal (breaks, programme,
 * chapter, ads, placement opportunities…) against playback time, with the
 * health issues, quality switches, stalls and errors underneath.
 */
export class TimelineView {
  readonly el = h('div', { class: 'scte-timeline' });
  private zoom: Zoom = 'all';
  private chart = h('div', { class: 'timeline-chart' });
  private info = h('div', { class: 'timeline-info small' });
  private zoomButtons = new Map<Zoom, HTMLButtonElement>();
  private picked: Picked | null = null;

  constructor(
    private readonly ctrl: PlayerController,
    private readonly health: HealthCache,
    private readonly select: (key: string) => void,
  ) {
    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Timeline zoom' });
    for (const [z, label] of [['all', 'All'], ['600', '10 min'], ['120', '2 min'], ['30', '30 s']] as [Zoom, string][]) {
      const b = h('button', { type: 'button', onclick: () => ((this.zoom = z), this.render()) }, label);
      this.zoomButtons.set(z, b);
      seg.append(b);
    }
    this.el.append(h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, 'Zoom'), seg, h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, 'Click an item to seek')), this.chart, this.info);
  }

  private range(): [number, number] | null {
    const v = this.ctrl.video;
    if (!this.ctrl.loadedUrl) return null;
    const times = this.ctrl.scte.list().map((e) => e.startTime).filter((t): t is number => t !== null);
    let start: number;
    let end: number;
    if (this.ctrl.player.isLive()) {
      const r = this.ctrl.player.seekRange();
      start = Math.min(r.start, ...times);
      end = Math.max(r.end, this.ctrl.availabilityEnd() ?? r.end, ...times);
    } else {
      start = 0;
      end = Number.isFinite(v.duration) ? v.duration : Math.max(1, ...times);
    }
    if (this.zoom !== 'all') {
      const w = Number(this.zoom);
      const mid = Math.min(Math.max(v.currentTime, start + w / 2), Math.max(start + w / 2, end - w / 2));
      start = Math.max(start, mid - w / 2);
      end = start + w;
    }
    return end > start ? [start, end] : [start, start + 1];
  }

  render() {
    for (const [z, b] of this.zoomButtons) b.setAttribute('aria-pressed', String(z === this.zoom));
    const width = this.chart.clientWidth;
    const range = this.range();
    if (!range || width < LABEL_W + 60) {
      this.chart.replaceChildren(h('p', { class: 'muted' }, this.ctrl.loadedUrl ? '' : 'Load a stream to see its timeline.'));
      return;
    }
    const [t0, t1] = range;
    const plotW = width - LABEL_W - 8;
    const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * plotW;
    const inView = (t: number) => t >= t0 - 1e-6 && t <= t1 + 1e-6;

    const live = this.ctrl.player.isLive();
    const { spans, points } = buildTimeline(this.ctrl.scte.list(), live ? this.ctrl.availabilityEnd() : t1);
    const pods = this.ctrl.adPods();
    const used = new Set<LaneId>(['markers', 'breaks', ...spans.map((s) => s.lane), ...points.map((p) => p.lane)]);
    const lanes: { id: string; label: string }[] = [
      ...SCTE_LANES.filter((l) => used.has(l.id)),
      ...(pods.length ? [{ id: 'pods', label: 'Inserted ads' }] : []),
      { id: 'issues', label: 'Health issues' },
      { id: 'quality', label: 'Quality' },
      { id: 'playback', label: 'Stalls & errors' },
    ];
    const rowY = new Map(lanes.map((l, i) => [l.id, i * ROW_H]));
    const height = lanes.length * ROW_H + AXIS_H;
    const root = svg('svg', { width, height, class: 'timeline-svg', role: 'img', 'aria-label': 'SCTE-35 timeline' });

    // Lane backgrounds and labels.
    lanes.forEach((l, i) => {
      root.append(svg('rect', { x: 0, y: i * ROW_H, width, height: ROW_H, class: i % 2 ? 'lane odd' : 'lane' }));
      const label = svg('text', { x: 6, y: i * ROW_H + 16, class: 'lane-label' });
      label.textContent = l.label;
      root.append(label);
    });

    // Time axis.
    const step = STEPS.find((s) => (s / (t1 - t0)) * plotW >= 80) ?? STEPS[STEPS.length - 1];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      root.append(svg('line', { x1: x(t), x2: x(t), y1: 0, y2: height - AXIS_H, class: 'grid' }));
      const label = svg('text', { x: x(t), y: height - 6, class: 'axis', 'text-anchor': 'middle' });
      label.textContent = formatTime(t);
      root.append(label);
    }

    const pick = (p: Picked) => () => {
      this.picked = p;
      this.ctrl.video.currentTime = Math.max(0, p.time);
      this.renderInfo();
    };

    for (const s of spans) {
      if (s.end < t0 || s.start > t1) continue;
      const y = rowY.get(s.lane)!;
      const a = x(Math.max(s.start, t0));
      const b = x(Math.min(s.end, t1));
      const r = svg(
        'rect',
        { x: a, y: y + 4, width: Math.max(2, b - a), height: ROW_H - 8, rx: 3, class: `span ${s.lane}${s.open ? ' open' : ''}` },
        `${formatTime(s.start)}–${s.open ? 'open' : formatTime(s.end)} · ${s.label}`,
      );
      r.addEventListener('click', pick({ time: s.start, text: `${formatTime(s.start)}–${s.open ? 'open' : formatTime(s.end)} · ${s.label}`, key: s.keys[0] }));
      root.append(r);
    }
    for (const p of points) {
      if (!inView(p.time)) continue;
      const y = rowY.get(p.lane)!;
      const cx = x(p.time);
      const d = svg('path', { d: `M${cx} ${y + 5} L${cx + 5} ${y + 12} L${cx} ${y + 19} L${cx - 5} ${y + 12} Z`, class: `point ${p.kind}` }, `${formatTime(p.time)} · ${p.label}`);
      d.addEventListener('click', pick({ time: p.time, text: `${formatTime(p.time)} · ${p.label}`, key: p.keys[0] }));
      root.append(d);
    }
    for (const r of pods) {
      const { start, duration } = r.pod;
      if (start + duration < t0 || start > t1) continue;
      const y = rowY.get('pods')!;
      const a = x(Math.max(start, t0));
      const b = x(Math.min(start + duration, t1));
      const text = `${formatTime(start)} · ${r.pod.kind === 'interstitial' ? 'Interstitial' : 'Inserted'} pod, ${r.pod.ads.length} ad${r.pod.ads.length > 1 ? 's' : ''}, ${duration.toFixed(1)} s`;
      const rect = svg('rect', { x: a, y: y + 4, width: Math.max(2, b - a), height: ROW_H - 8, rx: 3, class: 'span pod' }, text);
      rect.addEventListener('click', pick({ time: start, text, key: r.signal?.events[0].key ?? r.pod.key }));
      root.append(rect);
    }
    // Notes first, errors last, so the most severe dot ends up on top.
    for (const i of [...this.health.get()].reverse()) {
      if (i.time === null || !inView(i.time)) continue;
      const y = rowY.get('issues')!;
      const c = svg('circle', { cx: x(i.time), cy: y + 12, r: 5, class: `issue ${i.severity}` }, `${formatTime(i.time)} · ${i.title}: ${i.detail}`);
      c.addEventListener('click', pick({ time: i.time, text: `${i.title} — ${i.detail}`, key: i.keys[0] }));
      root.append(c);
    }
    let lastLabelX = -Infinity;
    for (const m of this.ctrl.marks) {
      if (!inView(m.time)) continue;
      const lane = m.kind === 'quality' ? 'quality' : 'playback';
      const y = rowY.get(lane)!;
      const cx = x(m.time);
      const tick = svg('rect', { x: cx - 1.5, y: y + 4, width: 3, height: ROW_H - 8, class: `mark ${m.kind}` }, `${formatTime(m.time)} · ${m.label}`);
      tick.addEventListener('click', pick({ time: m.time, text: `${formatTime(m.time)} · ${m.label}` }));
      root.append(tick);
      if (m.kind === 'quality' && cx - lastLabelX > 46) {
        const t = svg('text', { x: cx + 4, y: y + 16, class: 'mark-label' });
        t.textContent = m.label.split(' @')[0];
        root.append(t);
        lastLabelX = cx;
      }
    }

    // Playhead.
    const now = this.ctrl.video.currentTime;
    if (inView(now)) root.append(svg('line', { x1: x(now), x2: x(now), y1: 0, y2: height - AXIS_H, class: 'playhead' }));

    this.chart.replaceChildren(root);
    this.renderInfo();
  }

  private renderInfo() {
    const p = this.picked;
    this.info.replaceChildren(
      ...(p
        ? [
            h('span', null, p.text),
            ' ',
            p.key ? h('button', { type: 'button', class: 'linklike', onclick: () => this.select(p.key!) }, 'Open marker detail') : '',
          ]
        : [h('span', { class: 'muted' }, 'Spans run from a start signal to its end signal (or its advertised duration); a faded end means no end yet.')]),
    );
  }
}
