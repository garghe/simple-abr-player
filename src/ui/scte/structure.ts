import type { PlayerController } from '../../player/controller';
import { buildStructure, type StructureNode } from '../../scte/structure';
import { SCTE_LANES } from '../../scte/timeline';
import { h } from '../dom';
import { formatTime } from '../format';

const LANE_LABEL = new Map<string, string>(SCTE_LANES.map((l) => [l.id, l.label]));

/**
 * Programme structure sub-view: segmentation signals nested by time
 * (programme → chapter → break → placement opportunity → ad), with their
 * decoded UPIDs (Ad-ID, EIDR, ADI, TI, MPU…).
 */
export class StructureView {
  readonly el = h('div', { class: 'scte-structure' });

  constructor(
    private readonly ctrl: PlayerController,
    private readonly select: (key: string) => void,
  ) {}

  render() {
    const live = Boolean(this.ctrl.loadedUrl) && this.ctrl.player.isLive();
    const horizon = live ? this.ctrl.availabilityEnd() : Number.isFinite(this.ctrl.video.duration) ? this.ctrl.video.duration : null;
    const roots = buildStructure(this.ctrl.scte.list(), horizon);
    this.el.replaceChildren(
      roots.length
        ? h('ul', { class: 'structure-tree' }, roots.map((n) => this.node(n)))
        : h('p', { class: 'muted' }, 'No segmentation or OUT/IN signals yet. Programme, chapter, break and ad structure comes from segmentation descriptors (time_signal) and splice_insert breaks.'),
      h('p', { class: 'muted small' }, 'Nesting follows time: a signal sits under the larger one that contains it. Open ends mean no end signal has arrived yet.'),
    );
  }

  private node(n: StructureNode): HTMLElement {
    const s = n.span;
    return h(
      'li',
      null,
      h(
        'div',
        { class: `structure-item ${s.lane}` },
        h('span', { class: 'structure-kind' }, LANE_LABEL.get(s.lane) ?? s.lane),
        h(
          'button',
          { type: 'button', class: 'linklike mono', title: 'Seek here', onclick: () => (this.ctrl.video.currentTime = Math.max(0, s.start)) },
          `${formatTime(s.start)}–${s.open ? '…' : formatTime(s.end)}`,
        ),
        h('span', { class: 'muted small' }, ` ${(s.end - s.start).toFixed(1)} s${s.open ? '+' : ''} `),
        h('button', { type: 'button', class: 'linklike small', onclick: () => this.select(s.keys[0]) }, s.label),
      ),
      n.children.length ? h('ul', null, n.children.map((c) => this.node(c))) : '',
    );
  }
}
