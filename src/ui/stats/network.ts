import type { PlayerController } from '../../player/controller';
import { badge, dataTable, h } from '../dom';
import { clock, formatBitrate, formatBytes, shortUri } from '../format';

export class NetworkTab {
  readonly el = h('div', { class: 'tab-pane' });
  private filter = h(
    'select',
    { 'aria-label': 'Filter requests', onchange: () => this.render() },
    ['all', 'manifests', 'segments', 'errors'].map((f) => h('option', { value: f }, f)),
  );
  private summary = h('span', { class: 'muted small' });
  private body = h('div');

  constructor(private readonly ctrl: PlayerController) {
    this.el.append(h('div', { class: 'toolbar' }, this.filter, this.summary), this.body);
  }

  render() {
    const f = this.filter.value;
    const all = this.ctrl.network;
    const entries = all
      .filter((e) => {
        if (f === 'errors') return Boolean(e.error) || (e.status !== null && e.status >= 400);
        if (f === 'manifests') return /manifest|playlist|mpd/.test(e.type);
        if (f === 'segments') return /segment/.test(e.type);
        return true;
      })
      .slice(-150)
      .reverse();
    const errors = all.filter((e) => e.error).length;
    const bytes = all.reduce((n, e) => n + e.bytes, 0);
    this.summary.textContent = `${all.length} requests · ${formatBytes(bytes)} · ${errors} failed`;

    this.body.replaceChildren(
      dataTable(
        ['Time', 'Type', 'Status', 'Size', 'Duration', 'Throughput', 'URL'],
        entries.map((e) => [
          h('span', { class: 'mono' }, clock(e.at)),
          e.type.replace(/^media /, ''),
          e.error
            ? badge(e.status ? String(e.status) : 'ERR', 'warn')
            : badge(String(e.status ?? '—'), e.status && e.status < 400 ? 'ok' : 'warn'),
          formatBytes(e.bytes),
          e.ms !== null ? `${Math.round(e.ms)} ms` : '—',
          e.ms ? formatBitrate((e.bytes * 8 * 1000) / e.ms) : '—',
          h(
            'span',
            { class: 'mono url', title: e.uri + (e.error ? `\n${e.error}` : '') },
            e.proxied ? badge('proxy', 'accent') : '',
            e.fromCache ? badge('cache') : '',
            ' ',
            shortUri(e.uri, 48),
            e.error ? h('div', { class: 'error small' }, e.error) : '',
          ),
        ]),
        'compact network-table',
      ),
    );
  }
}
