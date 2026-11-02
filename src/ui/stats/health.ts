import type { PlayerController } from '../../player/controller';
import type { StreamIssue } from '../../stream/monitor';
import { badge, dataTable, h } from '../dom';
import { formatTime } from '../format';
import { SEVERITY_BADGE, severitySummary } from '../scte/health';

/** Stream health, cached: recomputed when segments/playlists change, and every 2 s (stale checks). */
export class StreamHealthCache {
  private issues: StreamIssue[] = [];
  private version = -1;
  private at = 0;

  constructor(private readonly ctrl: PlayerController) {}

  get(): StreamIssue[] {
    const v = this.ctrl.stream.version;
    if (v !== this.version || Date.now() - this.at > 2000) {
      this.issues = this.ctrl.loadedUrl ? this.ctrl.streamHealth() : [];
      this.version = v;
      this.at = Date.now();
    }
    return this.issues;
  }

  /** Errors + warnings, for the tab badge. */
  count(): number {
    return this.get().filter((i) => i.severity !== 'info').length;
  }
}

interface SubView {
  id: string;
  label: string;
  el: HTMLElement;
  render(): void;
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ${s % 60} s ago`;
};
const kbps = (b: number) => `${Math.round(b / 1000)} kbps`;

/**
 * Health tab: stream checks (playlists / MPD and downloaded segments) and,
 * as further views, rendition alignment.
 */
export class HealthTab {
  readonly el = h('div', { class: 'tab-pane' });
  readonly cache: StreamHealthCache;
  private nav = h('div', { class: 'subnav', role: 'tablist', 'aria-label': 'Health views' });
  private views: SubView[] = [];
  private active!: SubView;
  private buttons = new Map<string, HTMLButtonElement>();
  private streamEl = h('div', { class: 'stream-health' });
  private open = new Set<string>();

  constructor(private readonly ctrl: PlayerController) {
    this.cache = new StreamHealthCache(ctrl);
    this.el.append(this.nav);
    this.addView({ id: 'stream', label: 'Stream', el: this.streamEl, render: () => this.renderStream() });
  }

  addView(view: SubView) {
    this.views.push(view);
    const b = h('button', { type: 'button', role: 'tab', onclick: () => this.show(view.id) }, view.label);
    this.buttons.set(view.id, b);
    this.nav.append(b);
    this.el.append(view.el);
    this.active ??= view;
    this.render();
  }

  show(id: string) {
    this.active = this.views.find((v) => v.id === id) ?? this.views[0];
    this.render();
  }

  render() {
    for (const v of this.views) {
      this.buttons.get(v.id)!.setAttribute('aria-selected', String(v === this.active));
      v.el.hidden = v !== this.active;
    }
    this.active.render();
  }

  private renderStream() {
    const ctrl = this.ctrl;
    if (!ctrl.loadedUrl) {
      this.streamEl.replaceChildren(h('p', { class: 'muted' }, 'Load a stream to check its playlists, MPD and segments.'));
      return;
    }
    const issues = this.cache.get();
    const groups = new Map<string, StreamIssue[]>();
    for (const i of issues) groups.set(`${i.severity}|${i.title}`, [...(groups.get(`${i.severity}|${i.title}`) ?? []), i]);
    const m = ctrl.stream;

    const playlists = [...m.playlists.values()];
    const streams = [...m.streams.values()];
    this.streamEl.replaceChildren(
      h('div', { class: 'toolbar' }, severitySummary(issues), h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, `${m.segments.length} segments read`)),
      ...(issues.length
        ? [...groups].map(([id, list]) => {
            const [label, kind] = SEVERITY_BADGE[list[0].severity];
            const d = h(
              'details',
              { class: `issue-group ${list[0].severity}`, open: this.open.has(id) || list.length === 1 },
              h('summary', null, badge(label, kind), ' ', h('strong', null, list[0].title), list.length > 1 ? h('span', { class: 'muted' }, ` ×${list.length}`) : ''),
              h(
                'ul',
                { class: 'issues' },
                list.slice(0, 50).map((i) =>
                  h(
                    'li',
                    null,
                    h('span', { class: 'muted small' }, `${i.where}${i.at ? ` · ${i.at.toISOString().slice(11, 19)}Z` : ''} `),
                    i.time !== undefined && i.time !== null ? h('button', { type: 'button', class: 'linklike mono', onclick: () => (ctrl.video.currentTime = Math.max(0, i.time! - 1)) }, formatTime(i.time)) : '',
                    ' ',
                    i.detail,
                  ),
                ),
              ),
            );
            d.addEventListener('toggle', () => (d.open ? this.open.add(id) : this.open.delete(id)));
            return d;
          })
        : [h('p', null, 'No problems found in the playlists, manifest or segments read so far.')]),
      ...(playlists.length
        ? [
            h('h3', null, `Media playlists (${playlists.length})`),
            dataTable(
              ['Playlist', 'Type', 'Target', 'Window', 'Refreshes', 'Last change'],
              playlists.map((p) => [
                h('span', { class: 'small', title: p.uri }, p.label),
                p.live ? badge('LIVE', 'live') : 'VOD',
                p.targetDuration !== undefined ? `${p.targetDuration} s` : '—',
                `${p.info.segments.length} seg · ${p.info.totalDuration.toFixed(0)} s`,
                String(p.refreshes),
                p.live ? ago(p.lastChangeAt) : '—',
              ]),
              'compact',
            ),
          ]
        : []),
      ...(m.mpd
        ? [
            h('h3', null, `MPD (${m.mpd.summary.dynamic ? 'dynamic' : 'static'})`),
            m.mpd.summary.timelines.length
              ? dataTable(
                  ['Timeline', 'Segments', 'Last segment end', 'Last growth'],
                  m.mpd.summary.timelines.map((t) => {
                    const end = m.mpd!.timelineEnds.get(t.label);
                    return [t.label, String(t.entries.length), end ? `${end.end.toFixed(1)} s` : '—', m.mpd!.summary.dynamic && end ? ago(end.changedAt) : '—'];
                  }),
                  'compact',
                )
              : h('p', { class: 'muted small' }, 'No SegmentTimeline (segment numbers or byte ranges): timeline checks do not apply.'),
          ]
        : []),
      ...(streams.length
        ? [
            h('h3', null, 'Renditions played'),
            dataTable(
              ['Rendition', 'Codec declared', 'Codec in media', 'Bitrate declared', 'Measured avg / peak', 'Keyframe start'],
              streams.map((s) => {
                const segs = m.segments.filter((r) => r.streamId === s.id);
                const rates = segs.map((r) => (r.bytes * 8) / Math.max(0.1, r.declaredEnd - r.declaredStart));
                const dur = segs.reduce((n, r) => n + (r.declaredEnd - r.declaredStart), 0);
                const avg = dur ? segs.reduce((n, r) => n + r.bytes * 8, 0) / dur : 0;
                const track = s.init?.tracks.find((t) => (s.kind === 'video' ? t.handler === 'vide' : t.handler === 'soun')) ?? s.init?.tracks[0];
                const keyed = segs.filter((r) => r.actual?.startsWithKeyframe === true).length;
                const checked = segs.filter((r) => r.actual?.startsWithKeyframe !== null && r.actual).length;
                return [
                  s.label,
                  h('span', { class: 'mono small' }, s.declaredCodecs || '—'),
                  h('span', { class: 'mono small' }, track?.codec || (segs.length && segs.every((r) => !r.actual) ? 'not readable (format)' : '—')),
                  s.declaredBandwidth ? kbps(s.declaredBandwidth) : '—',
                  segs.length ? `${kbps(avg)} / ${kbps(Math.max(...rates))}` : '—',
                  s.kind === 'video' && checked ? badge(`${keyed}/${checked}`, keyed === checked ? 'ok' : 'warn') : '—',
                ];
              }),
              'compact',
            ),
          ]
        : []),
      h(
        'p',
        { class: 'muted small' },
        'Checks: target duration, media and discontinuity sequence numbering between refreshes, PROGRAM-DATE-TIME drift, stale live playlists / MPDs, SegmentTimeline and period gaps, segments that do not start with a keyframe, segment duration and media timestamp gaps, declared vs real codecs and bitrate. Segments are read as the player downloads them (fMP4/CMAF and MPEG-2 TS).',
      ),
    );
  }
}
