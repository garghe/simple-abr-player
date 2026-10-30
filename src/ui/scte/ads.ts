import type { PlayerController } from '../../player/controller';
import { badge, dataTable, h } from '../dom';
import { formatTime, shortUri } from '../format';

/**
 * Ad insertion sub-view: ad pods found in the stream (server-side inserted
 * content from another origin, HLS Interstitials) next to the SCTE-35
 * break that triggered them, and how well each pod fills its break.
 */
export class AdsView {
  readonly el = h('div', { class: 'scte-ads' });

  constructor(
    private readonly ctrl: PlayerController,
    private readonly select: (key: string) => void,
  ) {}

  render() {
    const reports = this.ctrl.adPods();
    const runs = [...this.ctrl.scte.runs.values()];
    const origins = new Map<string, number>();
    for (const r of runs) origins.set(r.origin, (origins.get(r.origin) ?? 0) + r.duration);
    const main = [...origins].sort((a, b) => b[1] - a[1])[0]?.[0];
    const kind = runs[0]?.source === 'DASH period' ? 'DASH periods' : 'HLS segments (discontinuities and origin changes)';

    this.el.replaceChildren(
      h(
        'p',
        { class: 'small' },
        reports.length
          ? `${reports.length} ad pod${reports.length > 1 ? 's' : ''} found. `
          : runs.length
            ? 'No inserted content found so far: every segment comes from the main origin. '
            : 'Waiting for playlists or the MPD. ',
        h('span', { class: 'muted' }, runs.length ? `Read from ${kind}. Main content origin: ` : ''),
        main ? h('span', { class: 'mono small' }, main) : '',
      ),
      reports.length
        ? dataTable(
            ['Start', 'Pod', 'Ads', 'Origin', 'Marker', 'Break', 'Fill'],
            reports.map((r) => [
              h('button', { type: 'button', class: 'linklike mono', onclick: () => (this.ctrl.video.currentTime = Math.max(0, r.pod.start - 2)) }, formatTime(r.pod.start)),
              h('span', null, `${r.pod.duration.toFixed(1)} s `, badge(r.pod.kind === 'interstitial' ? 'interstitial' : 'inserted', r.pod.kind === 'interstitial' ? 'other' : 'out')),
              String(r.pod.ads.length),
              h('span', { class: 'mono small', title: r.pod.ads.map((a) => a.uri).join('\n') }, [...new Set(r.pod.ads.map((a) => a.origin))].map((o) => shortUri(o, 40)).join(', ')),
              r.signal
                ? h('button', { type: 'button', class: 'linklike', onclick: () => this.select(r.signal!.events[0].key) }, r.signal.events[0].summary)
                : badge('none', 'warn'),
              r.breakLength !== undefined ? `${r.breakLength.toFixed(1)} s` : '—',
              r.fill === undefined ? '—' : Math.abs(r.fill) <= 1 ? badge('filled', 'ok') : badge(r.fill < 0 ? `${(-r.fill).toFixed(1)} s short` : `${r.fill.toFixed(1)} s over`, 'out'),
            ]),
            'compact',
          )
        : '',
      h(
        'p',
        { class: 'muted small' },
        'Server-side inserted ads come from a different origin (host and first path folder) than the programme, separated by discontinuities in HLS or as their own periods in DASH. Each pod is matched with an SCTE OUT within 2 s; the fill compares its length with the break. Underfill and pods without a marker also appear under Health.',
      ),
    );
  }
}
