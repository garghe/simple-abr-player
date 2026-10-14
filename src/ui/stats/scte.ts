import type { PlayerController } from '../../player/controller';
import type { ScteEvent } from '../../scte/monitor';
import { parseScte35, summarizeScte35 } from '../../scte/scte35';
import { badge, dataTable, h, kvTable } from '../dom';
import { clock, formatTime } from '../format';

const DIRECTION_LABEL = { out: 'OUT', in: 'IN', other: 'INFO' } as const;

function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2);
}

/**
 * SCTE-35 tab: live ad-break status, marker list (click for the decoded
 * splice_info_section) and a manual decoder for pasted base64/hex payloads.
 */
export class ScteTab {
  readonly el = h('div', { class: 'tab-pane' });
  private selectedKey: string | null = null;
  private status = h('div', { class: 'scte-status' });
  private list = h('div');
  private detail = h('div', { class: 'scte-detail' });
  private decoderInput = h('textarea', {
    rows: 2,
    placeholder: 'Paste a SCTE-35 payload (base64 or 0xFC… hex) to decode it',
    'aria-label': 'SCTE-35 payload to decode',
  });
  private decoderOut = h('div');

  constructor(private readonly ctrl: PlayerController) {
    this.el.append(
      this.status,
      this.list,
      this.detail,
      h(
        'details',
        { class: 'decoder' },
        h('summary', null, 'Manual SCTE-35 decoder'),
        this.decoderInput,
        h('button', { type: 'button', onclick: () => this.decodeManual() }, 'Decode'),
        this.decoderOut,
      ),
    );
  }

  select(e: ScteEvent) {
    this.selectedKey = e.key;
    this.render();
    this.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private decodeManual() {
    const text = this.decoderInput.value.trim();
    if (!text) return;
    try {
      const s = parseScte35(text);
      this.decoderOut.replaceChildren(
        h('p', null, badge(s.crcValid ? 'CRC OK' : 'CRC mismatch', s.crcValid ? 'ok' : 'warn'), ' ', summarizeScte35(s)),
        h('pre', { class: 'code' }, json(s)),
      );
    } catch (err) {
      this.decoderOut.replaceChildren(h('p', { class: 'error' }, String(err instanceof Error ? err.message : err)));
    }
  }

  render() {
    const events = this.ctrl.scte.list();
    const now = this.ctrl.video.currentTime;
    const br = this.ctrl.loadedUrl ? this.ctrl.scte.activeBreak(now) : null;

    const bySource = new Map<string, number>();
    for (const e of events) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);

    this.status.replaceChildren(
      h(
        'div',
        { class: `break-state ${br ? 'in-break' : ''}` },
        br
          ? [
              h('strong', null, 'In ad break'),
              ` since ${formatTime(br.start)}`,
              br.remaining !== undefined ? ` · ${br.remaining.toFixed(1)}s remaining` : ' · duration unknown',
              h('div', { class: 'muted small' }, br.event.summary),
            ]
          : [h('strong', null, 'Programme content'), h('span', { class: 'muted' }, ' — no active ad break')],
      ),
      h(
        'p',
        { class: 'muted small' },
        events.length
          ? `${events.length} marker${events.length === 1 ? '' : 's'}: ` +
              [...bySource].map(([s, n]) => `${s} ×${n}`).join(', ')
          : this.ctrl.loadedUrl
            ? 'No SCTE-35 / ad markers seen yet. Live streams show markers as playlists refresh.'
            : 'Load a stream to watch for SCTE-35 markers (DASH EventStream, in-band emsg, HLS DATERANGE / CUE-OUT / CUE-IN / SCTE35 / OATCLS).',
      ),
    );

    this.list.replaceChildren(
      dataTable(
        ['Time', 'Source', 'Type', 'Details', 'Dur.'],
        events.map((e) => {
          const row = [
            h(
              'button',
              {
                type: 'button',
                class: 'linklike mono',
                title: 'Seek here',
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  if (e.startTime !== null) this.ctrl.video.currentTime = Math.max(0, e.startTime - 2);
                },
              },
              e.startTime !== null ? formatTime(e.startTime) : '?',
            ),
            e.source,
            badge(DIRECTION_LABEL[e.direction], e.direction),
            h(
              'button',
              { type: 'button', class: `linklike ${e.key === this.selectedKey ? 'selected' : ''}`, onclick: () => this.select(e) },
              e.summary,
              e.error ? badge('error', 'warn') : '',
              e.section && !e.section.crcValid ? badge('CRC!', 'warn') : '',
            ),
            e.duration !== undefined ? `${e.duration.toFixed(1)}s` : '—',
          ];
          return row;
        }),
        'scte-table',
      ),
    );

    const selected = events.find((e) => e.key === this.selectedKey);
    if (!selected) {
      this.detail.replaceChildren();
      return;
    }
    this.detail.replaceChildren(
      h('h3', null, 'Marker detail'),
      kvTable([
        ['Source', selected.source],
        ['Scheme', h('span', { class: 'mono' }, selected.schemeIdUri ?? '—')],
        ['Event ID', selected.eventId ?? '—'],
        ['First seen (UTC)', h('span', { class: 'mono' }, clock(selected.receivedAt))],
        ['Presentation time', selected.startTime !== null ? `${selected.startTime.toFixed(3)}s (${formatTime(selected.startTime)})` : 'unresolved'],
        ['Duration', selected.duration !== undefined ? `${selected.duration.toFixed(3)}s` : '—'],
        ...Object.entries(selected.meta)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, h('span', { class: 'mono break' }, String(v))] as [string, HTMLElement]),
        ...(selected.section
          ? ([['CRC-32', badge(selected.section.crcValid ? 'valid' : 'mismatch', selected.section.crcValid ? 'ok' : 'warn')]] as [string, HTMLElement][])
          : []),
      ]),
      h('h4', null, 'Raw'),
      h('pre', { class: 'code' }, selected.raw || '—'),
      ...(selected.section ? [h('h4', null, 'Decoded splice_info_section'), h('pre', { class: 'code' }, json(selected.section))] : []),
      selected.error ? h('p', { class: 'error' }, selected.error) : '',
    );
  }
}
