import type { PlayerController } from '../../player/controller';
import type { HealthIssue } from '../../scte/health';
import type { ScteEvent } from '../../scte/monitor';
import { parseScte35, summarizeScte35 } from '../../scte/scte35';
import { markerTiming } from '../../scte/timing';
import { badge, dataTable, h, kvTable } from '../dom';
import { clock, formatTime } from '../format';
import { HealthCache, HealthView, SEVERITY_BADGE, countBySeverity, severitySummary } from '../scte/health';
import { TimelineView } from '../scte/timeline';
import { AdsView } from '../scte/ads';

const DIRECTION_LABEL = { out: 'OUT', in: 'IN', other: 'INFO' } as const;

function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2);
}

const secs = (s: number) => `${s.toFixed(3)} s`;

interface SubView {
  id: string;
  label: string;
  el: HTMLElement;
  render(): void;
  count?: () => HTMLElement | string;
}

/**
 * SCTE-35 tab: live ad-break status, then sub-views: the marker list (click
 * for the decoded message and its timing) with a manual decoder, and the
 * health checks.
 */
export class ScteTab {
  readonly el = h('div', { class: 'tab-pane' });
  readonly health: HealthCache;
  private selectedKey: string | null = null;
  private status = h('div', { class: 'scte-status' });
  private nav = h('div', { class: 'subnav', role: 'tablist', 'aria-label': 'SCTE-35 views' });
  private list = h('div');
  private detail = h('div', { class: 'scte-detail' });
  private decoderInput = h('textarea', {
    rows: 2,
    placeholder: 'Paste a SCTE-35 payload (base64 or 0xFC… hex) to decode it',
    'aria-label': 'SCTE-35 payload to decode',
  });
  private decoderOut = h('div');
  private views: SubView[];
  private active: SubView;
  private navButtons = new Map<string, HTMLButtonElement>();
  private navBar = h('div');

  constructor(private readonly ctrl: PlayerController) {
    this.health = new HealthCache(ctrl);
    const markers: SubView = {
      id: 'markers',
      label: 'Markers',
      el: h(
        'div',
        null,
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
      ),
      render: () => this.renderMarkers(),
    };
    const healthView = new HealthView(ctrl, this.health, (key) => this.selectKey(key));
    const timeline = new TimelineView(ctrl, this.health, (key) => this.selectKey(key));
    const ads = new AdsView(ctrl, (key) => this.selectKey(key));
    this.views = [
      markers,
      {
        id: 'health',
        label: 'Health',
        el: healthView.el,
        render: () => healthView.render(),
        count: () => {
          const c = countBySeverity(this.health.get());
          return c.error ? badge(String(c.error), 'warn') : c.warn ? badge(String(c.warn), 'out') : '';
        },
      },
      { id: 'timeline', label: 'Timeline', el: timeline.el, render: () => timeline.render() },
      { id: 'ads', label: 'Ad insertion', el: ads.el, render: () => ads.render(), count: () => (this.ctrl.scte.runs.size ? String(this.ctrl.adPods().length || '') : '') },
    ];
    this.active = markers;
    for (const v of this.views) {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => this.show(v.id) }, v.label);
      this.navButtons.set(v.id, b);
      this.nav.append(b);
    }
    this.el.append(this.status, this.navBar, this.nav, ...this.views.map((v) => v.el));
  }

  /** Marker / break navigation buttons, under the break status. */
  setNavigation(toolbar: HTMLElement) {
    this.navBar.replaceChildren(toolbar);
  }

  /** Adds a sub-view (timeline, structure, builder…). */
  addView(view: SubView) {
    this.views.push(view);
    const b = h('button', { type: 'button', role: 'tab', onclick: () => this.show(view.id) }, view.label);
    this.navButtons.set(view.id, b);
    this.nav.append(b);
    this.el.append(view.el);
    this.render();
  }

  show(id: string) {
    this.active = this.views.find((v) => v.id === id) ?? this.views[0];
    this.render();
  }

  select(e: ScteEvent) {
    this.selectKey(e.key);
  }

  selectKey(key: string) {
    this.selectedKey = key;
    this.show('markers');
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

    for (const v of this.views) {
      const b = this.navButtons.get(v.id)!;
      b.setAttribute('aria-selected', String(v === this.active));
      b.replaceChildren(v.label, v.count ? ' ' : '', v.count?.() ?? '');
      v.el.hidden = v !== this.active;
    }
    this.active.render();
  }

  private renderMarkers() {
    const events = this.ctrl.scte.list();
    const issues = this.health.byMarker();
    const worst = (list: HealthIssue[] | undefined) => {
      if (!list?.length) return '';
      const sev = list.some((i) => i.severity === 'error') ? 'error' : list.some((i) => i.severity === 'warn') ? 'warn' : 'info';
      const [label, kind] = SEVERITY_BADGE[sev];
      return badge(list.length > 1 ? `${list.length} ${label === 'note' ? 'notes' : 'issues'}` : label, kind);
    };

    this.list.replaceChildren(
      dataTable(
        ['Time', 'Source', 'Type', 'Details', 'Dur.', 'Checks'],
        events.map((e) => [
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
          h('button', { type: 'button', class: 'linklike', onclick: () => this.select(e), title: 'Show checks' }, worst(issues.get(e.key))),
        ]),
        'scte-table',
      ),
    );

    const selected = events.find((e) => e.key === this.selectedKey);
    if (!selected) {
      this.detail.replaceChildren();
      return;
    }
    const markerIssues = issues.get(selected.key) ?? [];
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
      h('h4', null, 'Splice timing'),
      kvTable(this.timingRows(selected)),
      h('h4', null, 'Checks'),
      markerIssues.length
        ? h(
            'ul',
            { class: 'issues' },
            markerIssues.map((i) => h('li', null, badge(...SEVERITY_BADGE[i.severity]), ' ', h('strong', null, i.title), ' — ', i.detail)),
          )
        : h('p', { class: 'small' }, severitySummary([])),
      h('h4', null, 'Raw'),
      h('pre', { class: 'code' }, selected.raw || '—'),
      ...(selected.section ? [h('h4', null, 'Decoded splice_info_section'), h('pre', { class: 'code' }, json(selected.section))] : []),
      selected.error ? h('p', { class: 'error' }, selected.error) : '',
    );
  }

  private timingRows(e: ScteEvent): [string, HTMLElement | string][] {
    const t = markerTiming(e);
    const wall = e.hls?.date ?? (e.startTime !== null ? this.ctrl.wallClockAt(e.startTime) : null);
    const playlists = this.ctrl.scte.playlists;
    const rows: [string, HTMLElement | string][] = [
      ['Splice point (player time)', e.startTime !== null ? secs(e.startTime) : 'unresolved'],
      ['Wall clock (UTC)', wall ? h('span', { class: 'mono' }, wall.toISOString()) : '—'],
    ];
    if (e.section) {
      const adj = e.section.ptsAdjustment;
      rows.push([
        'splice_time in the message',
        t.immediate
          ? 'splice_immediate (no time: splice as soon as possible)'
          : t.spliceSeconds !== undefined
            ? h('span', { class: 'mono' }, `${secs(t.spliceSeconds)} PTS${adj ? ` (incl. pts_adjustment ${secs(adj / 90000)})` : ''}`)
            : 'not specified',
      ]);
    }
    rows.push([
      'Lead time',
      t.lead !== undefined
        ? h('span', null, `${t.lead >= 0 ? `${t.lead.toFixed(2)} s before` : `${(-t.lead).toFixed(2)} s after`} the splice`, h('span', { class: 'muted small' }, ` (vs the ${t.leadBasis} when first seen)`))
        : t.leadBasis === 'segment tag'
          ? 'arrives with the segment it marks (HLS tag)'
          : e.observed?.live
            ? 'unknown'
            : 'not applicable (VOD)',
    ]);
    rows.push([
      'Segment alignment',
      t.segmentOffset !== undefined
        ? t.boundaryDistance! <= 0.04
          ? h('span', null, badge('on boundary', 'ok'), ` segment ${secs(e.alignment!.segmentStart)}–${secs(e.alignment!.segmentEnd)}`)
          : h('span', null, badge('mid-segment', 'out'), ` ${t.segmentOffset.toFixed(3)} s into a ${(t.segmentDuration ?? 0).toFixed(3)} s segment`)
        : 'unknown (segment not in the index)',
    ]);
    if (t.dateRangeOffset !== undefined) rows.push(['START-DATE vs segment PDT', `${t.dateRangeOffset.toFixed(3)} s`]);
    if (e.hls) {
      rows.push([
        'Seen in playlists',
        e.seenIn.length ? h('span', { class: 'small' }, e.seenIn.map((u) => playlists.get(u)?.label ?? u).join(', ')) : '—',
      ]);
    }
    if (e.contChecks?.length) {
      rows.push(['CUE-OUT-CONT', h('span', { class: 'small mono' }, e.contChecks.slice(0, 6).map((c) => `${c.elapsed}s stated / ${c.actual.toFixed(1)}s actual`).join(' · '))]);
    }
    return rows;
  }
}
