import type { PlayerController } from '../../player/controller';
import type { AlignCell } from '../../stream/alignment';
import { badge, h } from '../dom';
import { formatBytes, formatTime } from '../format';
import { SEVERITY_BADGE, severitySummary } from '../scte/health';

/**
 * Alignment sub-view: fetches the same segments of every video rendition at
 * the playhead and shows boundaries, media timestamps and keyframes side by
 * side, with the problems found.
 */
export class AlignmentView {
  readonly el = h('div', { class: 'alignment' });
  private count = h('select', { 'aria-label': 'Segments to check' }, [1, 3, 5].map((n) => h('option', { value: String(n), selected: n === 3 }, `${n} segment${n > 1 ? 's' : ''}`)));
  private button = h('button', { type: 'button', class: 'primary', onclick: () => void this.run() }, 'Check alignment at the playhead');
  private status = h('span', { class: 'muted small' });
  private body = h('div');
  private running = false;

  constructor(private readonly ctrl: PlayerController) {
    this.el.append(
      h('div', { class: 'toolbar align-controls' }, this.button, this.count, this.status),
      h(
        'p',
        { class: 'muted small' },
        'Downloads the same segments of every video rendition (up to 10) from the current position and compares them: segment boundaries in the manifest, timestamps in the media, durations, and whether each segment starts with a keyframe. Seamless quality switching needs all of these to match. This fetches extra data: the chosen number of segments for every rendition.',
      ),
      this.body,
    );
  }

  private async run() {
    if (this.running || !this.ctrl.loadedUrl) return;
    this.running = true;
    this.button.disabled = true;
    try {
      await this.ctrl.checkAlignment(this.ctrl.video.currentTime, Number(this.count.value), (done, total) => (this.status.textContent = `Fetching ${done}/${total}…`));
      this.status.textContent = '';
    } catch (err) {
      this.status.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.running = false;
      this.button.disabled = false;
      this.render();
    }
  }

  render() {
    this.button.disabled = this.running || !this.ctrl.loadedUrl;
    const r = this.ctrl.alignment;
    if (!r) {
      this.body.replaceChildren(h('p', { class: 'muted' }, this.ctrl.loadedUrl ? 'Not checked yet.' : 'Load a stream first.'));
      return;
    }
    const columns = Math.max(0, ...r.rows.map((x) => x.cells.length));
    const firstActual = (k: number) => r.rows.map((x) => x.cells[k]?.actual?.start).find((v) => v !== undefined);
    const cell = (c: AlignCell | undefined, k: number) => {
      if (!c) return h('td', { class: 'muted' }, '—');
      const base = firstActual(k);
      const offset = c.actual && base !== undefined ? c.actual.start - base : null;
      const bad = c.actual?.startsWithKeyframe === false || (offset !== null && Math.abs(offset) > 0.02);
      return h(
        'td',
        { class: `align-cell${bad ? ' bad' : ''}` },
        h('div', { class: 'mono small' }, `${c.declaredStart.toFixed(3)}–${c.declaredEnd.toFixed(3)}`),
        c.error
          ? h('div', { class: 'error small' }, c.error)
          : c.actual
            ? h(
                'div',
                { class: 'small' },
                badge(
                  c.actual.startsWithKeyframe ? 'keyframe' : c.actual.startsWithKeyframe === false ? 'no keyframe' : 'keyframe ?',
                  c.actual.startsWithKeyframe ? 'ok' : c.actual.startsWithKeyframe === false ? 'warn' : '',
                ),
                ` ${c.actual.duration.toFixed(3)} s`,
                offset !== null ? h('span', { class: 'mono' }, ` ${offset >= 0 ? '+' : ''}${offset.toFixed(3)}`) : '',
                c.bytes ? h('span', { class: 'muted' }, ` · ${formatBytes(c.bytes)}`) : '',
              )
            : h('div', { class: 'muted small' }, 'not readable'),
      );
    };
    this.body.replaceChildren(
      h('div', { class: 'toolbar' }, severitySummary(r.issues), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, `At ${formatTime(r.time)} · checked ${r.checkedAt.toISOString().slice(11, 19)}Z`)),
      r.issues.length
        ? h('ul', { class: 'issues' }, r.issues.map((i) => h('li', null, badge(...SEVERITY_BADGE[i.severity]), ' ', h('strong', null, i.title), ' — ', h('span', { class: 'muted small' }, `${i.where}: `), i.detail)))
        : h('p', null, 'All renditions are aligned for the segments checked.'),
      h(
        'div',
        { class: 'align-wrap' },
        h(
          'table',
          { class: 'grid compact align-table' },
          h('thead', null, h('tr', null, h('th', null, 'Rendition'), ...Array.from({ length: columns }, (_, k) => h('th', null, `Segment ${k + 1}`)))),
          h(
            'tbody',
            null,
            r.rows.map((row) =>
              h(
                'tr',
                null,
                h('td', { class: 'small' }, h('strong', null, row.label), row.codec ? h('div', { class: 'mono muted small' }, row.codec) : '', row.error ? h('div', { class: 'error small' }, row.error) : ''),
                ...Array.from({ length: columns }, (_, k) => cell(row.cells[k], k)),
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'muted small' }, 'Each cell: boundaries in the manifest, keyframe at the start, real duration, media start relative to the first rendition, and size.'),
    );
  }
}
