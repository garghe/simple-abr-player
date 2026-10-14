import type { PlayerController } from '../../player/controller';
import { h } from '../dom';
import { clock } from '../format';

export class LogTab {
  readonly el = h('div', { class: 'tab-pane' });
  private body = h('ol', { class: 'log' });

  constructor(private readonly ctrl: PlayerController) {
    this.el.append(this.body);
  }

  render() {
    this.body.replaceChildren(
      ...[...this.ctrl.log]
        .reverse()
        .map((e) => h('li', { class: e.level }, h('span', { class: 'mono muted' }, clock(e.at)), ' ', e.message)),
    );
  }
}
