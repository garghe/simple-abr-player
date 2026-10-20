import { KEY_STATUS_TEXT } from '../../drm/errors';
import { formatKid } from '../../drm/inspect';
import type { LicenseExchange } from '../../drm/monitor';
import { widevineLevelName } from '../../drm/settings';
import type { PlayerController } from '../../player/controller';
import { badge, dataTable, h, kvTable } from '../dom';
import { clock, formatBytes, shortUri } from '../format';

const STATUS_CLASS: Record<string, string> = { usable: 'ok', expired: 'warn', 'output-restricted': 'warn', 'internal-error': 'warn' };

/**
 * DRM tab: key system and security level in use, protection declared by the
 * stream, key statuses, and every license/certificate exchange.
 */
export class DrmTab {
  readonly el = h('div', { class: 'tab-pane' });
  private selected: number | null = null;

  constructor(
    private readonly ctrl: PlayerController,
    private readonly openSettings: () => void,
  ) {}

  render(): void {
    const c = this.ctrl;
    const m = c.drm;
    const active = c.activeDrm();
    const declared = [...m.declared.values()];
    const encrypted = declared.some((d) => d.system !== 'AES-128 (key file)');

    const level = active ? (active.name === 'Widevine' ? widevineLevelName(active.videoRobustness) : '') : '';
    const summary: [string, HTMLElement | string][] = active
      ? [
          ['DRM in use', h('span', null, badge(`${active.name}${level ? ` ${level.split(' ')[0]}` : ''}`, 'accent'), ' ', h('span', { class: 'mono small' }, active.keySystem))],
          ...(active.name === 'Widevine'
            ? ([['Security level', `${level || '—'}${active.videoRobustness ? ` · video ${active.videoRobustness}` : ''}${active.audioRobustness ? ` · audio ${active.audioRobustness}` : ''}`]] as [string, string][])
            : []),
          ['Encryption scheme', active.scheme || '—'],
          ['License server', h('span', { class: 'mono break' }, active.licenseUrl || '—')],
          ...(m.safariPath
            ? ([['Safari playback', m.safariPath === 'native' ? "Safari's native HLS player (segment, network and audio stats limited)" : 'Shaka (MSE): full stats']] as [string, string][])
            : []),
          ['License expiry', Number.isFinite(m.expiration) ? new Date(m.expiration).toLocaleString() : 'none reported'],
        ]
      : [['DRM in use', c.loadedUrl ? (encrypted ? 'none yet' : 'none (clear stream)') : '—']];

    const notes: HTMLElement[] = [];
    if (active) {
      notes.push(
        h(
          'div',
          { class: 'note info' },
          active.videoRobustness.startsWith('HW_')
            ? 'Hardware-secure video (Widevine L1/L2): the picture goes through a protected hardware path, so screenshots and screen recordings show it black. The player turns off rounded corners and blurred overlays while DRM is in use.'
            : 'Protected video: the page cannot read the decoded frames, so the player turns off rounded corners and blurred overlays while DRM is in use.',
          ' If audio plays but the picture stays blank: disconnect DisplayLink docks or adapters (use a directly connected screen), stop any screen sharing or recording, and check Chrome\'s graphics acceleration setting.',
        ),
      );
    }
    if (c.loadedUrl && encrypted && !active) {
      notes.push(
        h(
          'div',
          { class: 'note' },
          'This stream declares DRM protection but no DRM is active. ',
          h('button', { type: 'button', onclick: () => this.openSettings() }, 'Open DRM settings'),
        ),
      );
    }

    const statuses = Object.entries(m.keyStatuses);
    const ex = [...m.exchanges].reverse();
    const sel = m.exchanges.find((x) => x.id === this.selected);

    this.el.replaceChildren(
      h('div', { class: 'toolbar' }, h('span', { class: 'spacer' }), h('button', { type: 'button', onclick: () => this.openSettings() }, 'DRM settings')),
      kvTable(summary),
      ...notes,
      h('h3', null, `Protection declared by the stream (${declared.length})`),
      dataTable(
        ['Source', 'System', 'Scheme', 'Key IDs', 'Details'],
        declared.map((d) => [
          d.source,
          d.system,
          d.scheme ?? '—',
          h('span', { class: 'mono small' }, d.keyIds.length ? d.keyIds.map(formatKid).join('\n') : '—'),
          h('span', { class: 'small break' }, d.details.join(' · ') || '—'),
        ]),
        'compact drm-declared',
      ),
      h('h3', null, `Key status (${statuses.length})`),
      dataTable(
        ['Key ID', 'Status'],
        statuses.map(([kid, status]) => [
          h('span', { class: 'mono small' }, formatKid(kid)),
          h('span', null, badge(status, STATUS_CLASS[status] ?? ''), ' ', h('span', { class: 'small muted' }, KEY_STATUS_TEXT[status]?.split(': ')[1] ?? '')),
        ]),
        'compact',
      ),
      h('h3', null, `License & certificate requests (${m.exchanges.length})`),
      dataTable(
        ['Time', 'Type', 'Status', 'Request', 'Response', 'Time', 'URL'],
        ex.map((x) => [
          h('span', { class: 'mono' }, clock(x.at)),
          `${x.keySystem} ${x.kind}`,
          x.pending ? badge('…') : x.error ? badge(x.status ? String(x.status) : 'ERR', 'warn') : badge(String(x.status ?? '—'), 'ok'),
          formatBytes(x.requestBytes),
          x.pending ? '—' : formatBytes(x.responseBytes),
          x.ms !== null ? `${Math.round(x.ms)} ms` : '—',
          h(
            'button',
            { type: 'button', class: `linklike ${x.id === this.selected ? 'selected' : ''}`, title: x.url, onclick: () => this.select(x) },
            x.proxied ? badge('proxy', 'accent') : '',
            ' ',
            shortUri(x.url, 36),
          ),
        ]),
        'compact drm-exchanges',
      ),
      ...(sel ? this.detail(sel) : []),
    );
  }

  private select(x: LicenseExchange) {
    this.selected = x.id;
    this.render();
  }

  private detail(x: LicenseExchange): HTMLElement[] {
    return [
      h('h3', null, `Request detail · ${x.keySystem} ${x.kind}`),
      kvTable([
        ['URL', h('span', { class: 'mono break' }, x.url)],
        ['Via proxy', x.proxied ? 'yes' : 'no'],
        ['Headers sent', x.requestHeaders.length ? x.requestHeaders.join(', ') : 'none'],
        ['Request format', x.requestFormat],
        ['Result', x.error ? h('span', { class: 'error' }, x.error) : x.pending ? 'waiting…' : `OK${x.detected ? ` · license read as ${x.detected}` : ''}`],
      ]),
      ...(x.requestPreview ? [h('h4', null, 'Request body'), h('pre', { class: 'code' }, x.requestPreview)] : []),
      ...(x.responsePreview ? [h('h4', null, 'Response'), h('pre', { class: 'code' }, x.responsePreview)] : []),
    ];
  }
}
