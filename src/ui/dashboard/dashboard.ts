import type { AlarmMonitor } from '../../alarms/monitor';
import { ALARM_LABELS } from '../../alarms/monitor';
import type { AudioEngine } from '../../audio/engine';
import { STANDARDS } from '../../audio/loudness';
import { audioPrefs } from '../../audio/prefs';
import type { PlayerController } from '../../player/controller';
import { buildTimeline } from '../../scte/timeline';
import { drawChart } from '../chart';
import { badge, h } from '../dom';
import { formatBitrate, formatTime, languageName } from '../format';
import type { HealthCache } from '../scte/health';
import { TimelineView } from '../scte/timeline';
import { snapshot } from '../stats/overview';
import type { StreamHealthCache } from '../stats/health';
import type { ViewModeSwitch } from '../viewmode';
import { buildFeed, buildLadder, channelStates, healthScore, type FeedItem, type ScorePart } from './model';

export interface DashboardDeps {
  ctrl: PlayerController;
  audio: AudioEngine;
  alarms: AlarmMonitor;
  scteHealth: HealthCache;
  streamHealth: StreamHealthCache;
  view: ViewModeSwitch;
  /** Opens a detail tab. */
  open(tab: string): void;
  /** Opens a SCTE marker in the SCTE-35 tab. */
  openMarker(key: string): void;
}

const STATUS_CLASS: Record<ScorePart['status'], string> = { ok: 'ok', warn: 'out', bad: 'warn', na: '' };
const FEED_COLOR: Record<FeedItem['kind'], string> = {
  'scte-out': 'var(--ad)',
  'scte-in': 'var(--ok)',
  scte: 'var(--info-text)',
  alarm: 'var(--danger)',
  error: 'var(--danger)',
  warn: 'var(--warn)',
  info: 'var(--muted)',
  quality: 'var(--accent)',
};

const pct = (dbfs: number) => Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
// −∞ means not measured yet (e.g. the first 3 s of short-term); very low values are silence.
const fmtLu = (v: number) => (!Number.isFinite(v) ? '—' : v <= -70 ? 'silence' : v.toFixed(1).replace('-', '−'));

/**
 * The dashboard: Inspect (summary cards) or Monitor (live operations). The
 * side part is the "Dashboard" tab; the stage part sits under the player
 * (facts and throughput in Inspect, the timeline in Monitor).
 */
export class Dashboard {
  readonly el = h('div', { class: 'tab-pane dashboard' });
  private chart = h('canvas', { class: 'chart dash-chart', height: 120 });
  private timeline: TimelineView;
  /** Recent highest level per channel, for the channel meters. */
  private peakMemory: { value: number; at: number }[] = [];
  private throughput = h('div', { class: 'card dash-card' });
  private timelineCard = h('div', { class: 'card dash-card timeline-card' });

  constructor(
    private readonly d: DashboardDeps,
    private readonly facts: HTMLElement,
    private readonly stage: HTMLElement,
  ) {
    this.timeline = new TimelineView(d.ctrl, d.scteHealth, (key) => d.openMarker(key));
    this.timelineCard.append(h('h4', null, 'Timeline'), this.timeline.el);
    this.throughput.append(h('h4', null, 'Throughput & buffer', h('span', { class: 'muted' }, 'last few minutes')), this.chart);
  }

  // ------------------------------------------------------------- side (tab)

  render() {
    const monitor = this.d.view.mode === 'monitor';
    this.el.classList.toggle('monitor', monitor);
    if (!this.d.ctrl.loadedUrl) {
      this.el.replaceChildren(this.emptyCard());
      return;
    }
    this.el.replaceChildren(
      ...(monitor
        ? [this.scoreCard(true), this.playbackCard(), this.loudnessCard(true), this.feedCard()]
        : [h('div', { class: 'bento' }, ...this.inspectCards())]),
    );
  }

  private inspectCards(): HTMLElement[] {
    // The DRM card sits next to loudness for protected streams; otherwise loudness takes the row.
    const drm = this.drmCard();
    return [this.scoreCard(false), this.loudnessCard(!drm), ...(drm ? [drm] : []), this.breakCard(), this.ladderCard()];
  }

  private emptyCard(): HTMLElement {
    return h(
      'div',
      { class: 'card dash-card empty-card' },
      h('h3', null, 'Probe a stream'),
      h('p', null, 'Paste a DASH or HLS URL above, or pick one of the test streams. PlayProbe plays it and checks it as it goes:'),
      h(
        'ul',
        null,
        h('li', null, h('strong', null, 'Health'), ': playlists, segments, keyframes, codecs, bitrate, rendition alignment'),
        h('li', null, h('strong', null, 'SCTE-35'), ': markers, ad breaks, inserted ads, signalling errors'),
        h('li', null, h('strong', null, 'Picture & sound'), ': loudness, black, frozen, silence, channels'),
        h('li', null, h('strong', null, 'DRM'), ': Widevine, PlayReady, FairPlay licence exchanges'),
      ),
      h('p', { class: 'muted small' }, 'Live streams open in Monitor, VOD in Inspect; switch any time with Inspect | Monitor.'),
    );
  }

  private score() {
    const { ctrl, alarms, scteHealth, streamHealth } = this.d;
    const active = ctrl.activeDrm();
    const exp = ctrl.drm.expiration;
    return healthScore({
      stream: streamHealth.get(),
      alignment: ctrl.alignment ? ctrl.alignment.issues : null,
      scte: scteHealth.get(),
      scteMarkers: ctrl.scte.size,
      alarmsActive: alarms.active.size,
      alarmsLogged: alarms.log.length - alarms.active.size,
      drm: active
        ? {
            name: active.name,
            licenseErrors: ctrl.drm.exchanges.filter((x) => x.error).length,
            badKeys: Object.values(ctrl.drm.keyStatuses).filter((s) => s !== 'usable' && s !== 'status-pending').length,
            expiresInHours: Number.isFinite(exp) && exp > 0 ? (exp - Date.now()) / 3_600_000 : null,
          }
        : null,
    });
  }

  private scoreCard(compact: boolean): HTMLElement {
    const { score, parts } = this.score();
    const tone = score >= 90 ? 'good' : score >= 70 ? 'fair' : 'poor';
    const ring = h('div', { class: `score-ring ${tone}` });
    ring.innerHTML = `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" class="track"/><circle cx="60" cy="60" r="50" class="value" stroke-dasharray="${(score / 100) * 314} 314" transform="rotate(-90 60 60)"/></svg>`;
    ring.append(h('div', { class: 'score-n' }, h('b', null, String(score)), h('span', null, 'health')));
    return h(
      'div',
      { class: `card dash-card score-card span2${compact ? ' compact' : ''}` },
      h('h4', null, 'Stream health', h('span', { class: 'muted' }, 'live checks')),
      h(
        'div',
        { class: 'score-body' },
        ring,
        h(
          'ul',
          { class: 'score-parts' },
          parts.map((p) =>
            h('li', null, h('button', { type: 'button', class: 'linklike', onclick: () => this.d.open(p.tab) }, p.label), badge(p.text, STATUS_CLASS[p.status])),
          ),
        ),
      ),
    );
  }

  private loudnessCard(compact: boolean): HTMLElement {
    const r = this.d.audio.lastReading;
    const std = STANDARDS[audioPrefs.standard];
    const card = h('div', { class: `card dash-card loud-card${compact ? ' span2' : ''}` });
    card.append(h('h4', null, `Loudness`, h('span', { class: 'muted' }, std.name)));
    if (!r || !r.channels.length) {
      card.append(h('p', { class: 'muted small' }, this.d.audio.needsGesture ? 'Click the player to start the audio meters.' : 'Waiting for audio…'));
      return card;
    }
    const value = Number.isFinite(r.integrated) ? r.integrated : r.shortTerm;
    const judged = Number.isFinite(r.integrated) ? 'integrated' : 'short-term';
    const off = Number.isFinite(value) ? Math.abs(value - std.target) : Infinity;
    const status = off <= std.tolerance ? ['on target', 'ok'] : off <= 3 ? ['close', 'out'] : ['off target', 'warn'];
    const t = (n: number) => String(n).replace('-', '−');
    // Says what it judges: the integrated value, which delivery specs check.
    const diff = Number.isFinite(value) ? value - std.target : NaN;
    const by = Number.isFinite(diff) ? `${Math.abs(diff).toFixed(1)} LU ${diff > 0 ? 'louder' : 'quieter'} than` : 'compared with';
    const meaning =
      status[0] === 'on target'
        ? `on target: within ±${std.tolerance} LU, as ${std.name} asks.`
        : status[0] === 'close'
          ? `close: outside the ±${std.tolerance} LU ${std.name} allows, but within 3 LU. Worth a look for delivery; not an alarm.`
          : `off target: more than 3 LU away. Needs correcting for delivery.`;
    const verdict = h(
      'span',
      {
        'data-tip': `${judged === 'integrated' ? 'Integrated loudness (everything measured so far)' : 'Short-term loudness (integrated needs a few seconds of audio first)'} is ${by} the ${t(std.target)} ${std.unit} target, so ${meaning} The alarm is separate: it raises when short-term loudness stays more than ${this.d.alarms.settings.loudnessTolerance} LU off for ${this.d.alarms.settings.hold.loudness} s.`,
      },
      badge(`${judged}: ${status[0]}`, status[1]),
    );
    const details = h(
      'div',
      { class: 'muted small loud-details' },
      h('span', { 'data-tip': 'Integrated: gated loudness of everything measured since loading (or since the audio track changed). The value delivery specs check.' }, `Integrated ${fmtLu(r.integrated)} ${std.unit}`),
      ' · ',
      h('span', { 'data-tip': `True peak: the highest level between samples, as after conversion to analogue. ${std.name} allows up to ${t(std.maxTruePeak)} dBTP.` }, `true peak ${fmtLu(r.truePeakMax)} dBTP`),
      ' · ',
      h('span', { 'data-tip': 'Loudness range (LRA): how much the loudness varies over time, in LU. Speech-led TV is usually under 10 LU; a beep test tone reads high.' }, `LRA ${fmtLu(r.lra)} LU`),
    );
    const explainer = h(
      'p',
      { class: 'loud-explain muted small' },
      `Loudness is how loud the audio sounds, in ${std.unit}: ${std.name} aims for ${t(std.target)}, and values closer to 0 are louder (each 1 LU is about 1 dB). `,
      `Short-term covers the last 3 s, integrated everything so far; channel bars show each channel’s peak in dBFS, where 0 is the digital maximum.`,
    );
    // Gauge: −40 … 0 LUFS.
    const pos = Number.isFinite(value) ? Math.max(0, Math.min(1, (value + 40) / 40)) : 0;
    if (compact) {
      card.append(
        h(
          'div',
          { class: 'loud-row' },
          h('div', { class: 'loud-big', 'data-tip': 'Short-term loudness: the last 3 seconds. The reading to watch while monitoring.' }, fmtLu(r.shortTerm)),
          h('div', { class: 'muted small' }, `${std.unit} short-term`),
          h('span', { class: 'spacer' }),
          verdict,
        ),
        h(
          'div',
          {
            class: 'loud-bar',
            'data-tip': `Short-term loudness (marker) on a −40 to 0 ${std.unit} scale. The green zone is the target, ${t(std.target)} ±${std.tolerance} LU.`,
          },
          h('div', { class: 'zone', style: `left:${((std.target - std.tolerance + 40) / 40) * 100}%;width:${((2 * std.tolerance) / 40) * 100}%` }),
          h('div', { class: 'mark', style: `left:${(Number.isFinite(r.shortTerm) ? Math.max(0, Math.min(1, (r.shortTerm + 40) / 40)) : 0) * 100}%` }),
        ),
        h('div', { class: 'loud-ticks mono' }, h('span', null, '−40'), h('span', null, '−30'), h('span', null, '−20'), h('span', null, '−10'), h('span', null, '0')),
        details,
        this.channelStrip(r.channels),
        explainer,
      );
      return card;
    }
    const gauge = h('div', { class: 'gauge', 'data-tip': `${judged === 'integrated' ? 'Integrated' : 'Short-term'} loudness on a −40 to 0 ${std.unit} scale. ${std.name} target: ${t(std.target)} ${std.unit}.` });
    gauge.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" class="track" stroke-dasharray="188 251" transform="rotate(135 50 50)"/><circle cx="50" cy="50" r="40" class="value" stroke-dasharray="${pos * 188} 251" transform="rotate(135 50 50)"/></svg>`;
    card.append(
      h(
        'div',
        { class: 'gauge-row' },
        gauge,
        h(
          'div',
          { class: 'loud-text' },
          h(
            'div',
            { class: 'loud-big', 'data-tip': judged === 'integrated' ? 'Integrated loudness: everything measured since loading. The value delivery specs check.' : 'Short-term loudness: the last 3 seconds (integrated needs a few seconds of audio first).' },
            fmtLu(value),
          ),
          h('div', { class: 'muted small' }, `${std.unit} ${judged}`),
          h(
            'div',
            { class: 'small' },
            h('span', { 'data-tip': `True peak: the highest level between samples. ${std.name} allows up to ${t(std.maxTruePeak)} dBTP.` }, `TP ${fmtLu(r.truePeakMax)} dBTP`),
            ' ',
            verdict,
          ),
        ),
      ),
      this.channelStrip(r.channels),
      explainer,
    );
    return card;
  }

  /** One thin meter per channel with its level; lost or unbalanced channels stand out. */
  private channelStrip(levels: { label: string; peak: number; hold: number; rms: number }[]): HTMLElement {
    // The highest level of the last 1.5 s: a card redrawn once a second would
    // otherwise mostly catch the gaps in short sounds (beeps, speech).
    const now = performance.now();
    const channels = levels.map((c, i) => {
      const level = Math.max(c.peak, c.hold);
      const m = this.peakMemory[i];
      if (!m || level >= m.value || now - m.at > 1500) this.peakMemory[i] = { value: level, at: now };
      return { ...c, peak: this.peakMemory[i].value };
    });
    this.peakMemory.length = levels.length;
    const states = channelStates(channels, this.d.alarms.settings.silenceLevel);
    const flagged = states.filter((c) => c.flag);
    return h(
      'div',
      { class: 'ch-strip' },
      h(
        'div',
        { class: 'ch-head muted small' },
        h('span', { 'data-tip': 'Peak level of each channel over the last 1.5 s, in dBFS: 0 is the digital maximum, −60 or less is silence. A channel silent while others play, or 10 dB quieter than the loudest, is flagged.' }, `${channels.length === 6 ? '5.1' : `${channels.length} ch`} · peak dBFS`),
        flagged.length ? badge(flagged.map((c) => `${c.label} ${c.flag}`).join(' · '), 'warn') : ''),
      states.map((c) =>
        h(
          'div',
          {
            class: `ch-row${c.flag ? ` ${c.flag}` : ''}`,
            'data-tip': `${c.label}: peak ${fmtLu(c.peak)} dBFS in the last 1.5 s${c.flag === 'silent' ? ' — silent while other channels play' : c.flag === 'low' ? ' — more than 10 dB below the loudest channel' : ''}.`,
          },
          h('span', { class: 'ch-l' }, c.label),
          h('span', { class: 'ch-m' }, h('i', { style: `width:${pct(c.peak)}%` })),
          h('span', { class: 'ch-v mono' }, Number.isFinite(c.peak) && c.peak > -90 ? Math.round(c.peak).toString().replace('-', '−') : '−∞'),
        ),
      ),
    );
  }

  /** Protected streams: DRM system, security level, licence and key status. Null for clear streams. */
  private drmCard(): HTMLElement | null {
    const ctrl = this.d.ctrl;
    const active = ctrl.activeDrm();
    const licences = ctrl.drm.exchanges.filter((x) => x.kind === 'license');
    if (!active && !licences.length) return null;
    const last = licences[licences.length - 1];
    const keys = Object.values(ctrl.drm.keyStatuses);
    const usable = keys.filter((k) => k === 'usable').length;
    const exp = ctrl.drm.expiration;
    const hours = Number.isFinite(exp) && exp > 0 ? (exp - Date.now()) / 3_600_000 : null;
    const level = active?.videoRobustness ? active.videoRobustness.replace(/^HW_SECURE_ALL$/, 'L1 (hardware)').replace(/^HW_.*$/, 'L2').replace(/^SW_SECURE.*$/, 'L3 (software)').replace(/^3000$/, 'SL3000').replace(/^2000$/, 'SL2000') : '';
    const row = (k: string, v: HTMLElement | string) => h('li', null, h('span', { class: 'muted' }, k), v);
    return h(
      'div',
      { class: 'card dash-card drm-card' },
      h('h4', null, 'DRM', h('button', { type: 'button', class: 'linklike small', onclick: () => this.d.open('drm') }, 'details')),
      h('div', { class: 'drm-name' }, active?.name ?? 'Not started', level ? h('span', { class: 'muted small' }, ` ${level}`) : ''),
      h(
        'ul',
        { class: 'drm-facts' },
        row('Scheme', active?.scheme || '—'),
        row('Keys', keys.length ? badge(`${usable} / ${keys.length} usable`, usable === keys.length ? 'ok' : 'warn') : '—'),
        row('Licence', hours === null ? (last && !last.error ? 'no expiry' : '—') : hours < 1 ? badge('expires < 1 h', 'out') : `${Math.round(hours)} h left`),
        row(
          'Request',
          last ? (last.pending ? 'waiting…' : last.error ? badge(last.status ? `HTTP ${last.status}` : 'failed', 'warn') : badge(`HTTP ${last.status ?? 200}${last.ms !== null ? ` · ${Math.round(last.ms)} ms` : ''}`, 'ok')) : '—',
        ),
      ),
    );
  }

  private breakCard(): HTMLElement {
    const ctrl = this.d.ctrl;
    const now = ctrl.video.currentTime;
    const events = ctrl.scte.list();
    const br = ctrl.scte.activeBreak(now);
    const next = events.find((e) => e.direction === 'out' && e.startTime !== null && e.startTime > now + 0.25);
    const card = h('div', { class: 'card dash-card span2 break-card' });
    const pods = ctrl.adPods();
    const filled = pods.filter((p) => p.signal && (p.fill === undefined || Math.abs(p.fill) <= 1)).length;
    card.append(h('h4', null, br ? 'In an ad break' : 'Next ad break', pods.length ? badge(`ad pods filled ${filled} / ${pods.length}`, filled === pods.length ? 'ok' : 'out') : h('span', { class: 'muted' }, `${ctrl.scte.size} markers`)));
    if (br) {
      card.append(h('div', { class: 'next' }, h('b', null, br.remaining !== undefined ? `${formatTime(br.remaining)} left` : `since ${formatTime(br.start)}`), h('span', { class: 'muted' }, br.event.summary)));
    } else if (next) {
      card.append(h('div', { class: 'next' }, h('b', null, `in ${formatTime(next.startTime! - now)}`), h('span', { class: 'muted' }, next.summary)));
    } else {
      card.append(h('div', { class: 'next' }, h('b', { class: 'muted' }, '—'), h('span', { class: 'muted' }, ctrl.scte.size ? 'No later break signalled yet.' : 'No SCTE-35 markers in this stream so far.')));
    }
    // Strip: chapters/programme and breaks over the stream (VOD) or the seek window (live).
    const live = ctrl.player.isLive();
    const range = live ? ctrl.player.seekRange() : { start: 0, end: Number.isFinite(ctrl.video.duration) ? ctrl.video.duration : 0 };
    const span = range.end - range.start;
    if (span > 0) {
      const { spans } = buildTimeline(events, live ? ctrl.availabilityEnd() : range.end);
      const x = (t: number) => `${Math.max(0, Math.min(100, ((t - range.start) / span) * 100))}%`;
      const w = (a: number, b: number) => `${Math.max(0.6, ((Math.min(b, range.end) - Math.max(a, range.start)) / span) * 100)}%`;
      const strip = h('div', { class: 'strip' });
      for (const s of spans.filter((s) => s.end > range.start && s.start < range.end)) {
        const cls = s.lane === 'breaks' || s.lane === 'break' || s.lane === 'ad' ? 'brk' : s.lane === 'po' ? 'po' : s.lane === 'programme' ? 'prog' : s.lane === 'chapter' ? 'chap' : '';
        if (!cls) continue;
        strip.append(h('i', { class: cls, style: `left:${x(s.start)};width:${w(s.start, s.end)}`, title: s.label }));
      }
      strip.append(h('b', { class: 'ph', style: `left:${x(now)}` }));
      card.append(strip, h('div', { class: 'legend' }, h('span', { class: 'prog' }, 'Programme / chapter'), h('span', { class: 'po' }, 'Placement opportunity'), h('span', { class: 'brk' }, 'Ad break')));
    }
    return card;
  }

  private ladderCard(): HTMLElement {
    const ctrl = this.d.ctrl;
    const measured = new Map<number, { avg: number; peak: number }>();
    for (const s of ctrl.stream.streams.values()) {
      const segs = ctrl.stream.segments.filter((r) => r.streamId === s.id);
      const dur = segs.reduce((n, r) => n + (r.declaredEnd - r.declaredStart), 0);
      if (!dur) continue;
      measured.set(s.id, {
        avg: segs.reduce((n, r) => n + r.bytes * 8, 0) / dur,
        peak: Math.max(...segs.map((r) => (r.bytes * 8) / Math.max(0.1, r.declaredEnd - r.declaredStart))),
      });
    }
    const rungs = buildLadder(ctrl.player.getVariantTracks(), measured, ctrl.player.getManifestType() ?? '');
    const max = Math.max(1, ...rungs.map((r) => Math.max(r.declared, r.measured ?? 0)));
    return h(
      'div',
      { class: 'card dash-card span2' },
      h('h4', null, 'Bitrate ladder', h('span', { class: 'muted' }, 'declared · measured')),
      rungs.length
        ? h(
            'div',
            { class: 'ladder' },
            rungs.map((r) =>
              h(
                'button',
                { type: 'button', class: `rung${r.active ? ' on' : ''}${r.over ? ' over' : ''}`, title: `${r.width}×${r.height}: declared ${formatBitrate(r.declared)}${r.measured ? `, measured ${formatBitrate(r.measured)}` : ''}`, onclick: () => this.d.open('health') },
                h(
                  'div',
                  { class: 'bars' },
                  h('i', { class: 'declared', style: `height:${(r.declared / max) * 100}%` }),
                  r.measured !== undefined ? h('i', { class: 'measured', title: `measured ${formatBitrate(r.measured)}`, style: `bottom:${(r.measured / max) * 100}%` }) : '',
                ),
                h('small', null, `${r.height}p`),
                h('em', null, formatBitrate(r.declared)),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'No video renditions.'),
    );
  }

  private playbackCard(): HTMLElement {
    const s = snapshot(this.d.ctrl);
    const track = this.d.ctrl.player.getVariantTracks().find((t) => t.active);
    const cell = (label: string, value: string, unit = '') => h('div', null, h('small', null, label), h('b', null, value, unit ? h('em', null, unit) : ''));
    return h(
      'div',
      { class: 'card dash-card span2' },
      h('h4', null, 'Playback', s.live ? badge(s.liveLatency !== null ? `latency ${s.liveLatency.toFixed(1)} s` : 'LIVE', 'live') : ''),
      h(
        'div',
        { class: 'kv-grid' },
        cell('Rendition', track?.height ? `${track.height}p` : s.resolution, track?.videoCodec ?? ''),
        cell('Bandwidth', formatBitrate(s.estimatedBandwidth), 'est.'),
        cell('Buffer', s.bufferAhead.toFixed(1), 's ahead'),
        cell('Dropped frames', String(s.droppedFrames), `/ ${s.decodedFrames}`),
      ),
    );
  }

  private feedCard(): HTMLElement {
    const { ctrl, alarms } = this.d;
    const items = buildFeed(
      ctrl.log,
      ctrl.scte.list(),
      alarms.log.map((a) => ({ start: a.start, type: a.type, label: ALARM_LABELS[a.type], detail: a.detail, mediaStart: a.mediaStart })),
    );
    return h(
      'div',
      { class: 'card dash-card span2 feed-card' },
      h('h4', null, 'Events', h('span', { class: 'muted' }, 'newest first')),
      h(
        'ul',
        { class: 'feed' },
        items.map((i) =>
          h(
            'li',
            null,
            h('span', { class: 'mono ts' }, i.at.toISOString().slice(11, 19)),
            h('span', { class: 'dot', style: `background:${FEED_COLOR[i.kind]}` }),
            h(
              'div',
              null,
              i.key || i.time !== undefined
                ? h('button', { type: 'button', class: 'linklike', onclick: () => (i.key ? this.d.openMarker(i.key) : (ctrl.video.currentTime = Math.max(0, i.time! - 1))) }, i.title)
                : h('span', null, i.title),
              i.detail ? h('small', null, i.detail) : '',
            ),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------- stage (under the player)

  renderStage() {
    const ctrl = this.d.ctrl;
    const monitor = this.d.view.mode === 'monitor';
    if (!ctrl.loadedUrl) {
      this.facts.replaceChildren();
      this.stage.replaceChildren();
      return;
    }
    if (monitor) {
      this.facts.replaceChildren();
      if (this.stage.firstChild !== this.timelineCard) this.stage.replaceChildren(this.timelineCard);
      this.timeline.render();
      return;
    }
    this.renderFacts();
    if (this.stage.firstChild !== this.throughput) this.stage.replaceChildren(this.throughput);
    drawChart(this.chart, ctrl.samples);
  }

  private renderFacts() {
    const ctrl = this.d.ctrl;
    const s = snapshot(ctrl);
    const t = ctrl.player.getVariantTracks().find((x) => x.active);
    const drm = ctrl.activeDrm();
    const pods = ctrl.adPods().length;
    const fact = (label: string, value: HTMLElement | string, sub: string, tab: string) =>
      h('button', { type: 'button', class: 'fact', onclick: () => this.d.open(tab) }, h('small', null, label), h('b', null, value), h('em', null, sub));
    const level = drm ? (drm.videoRobustness || '').replace(/^HW_SECURE_ALL$/, 'L1').replace(/^SW_SECURE.*$/, 'L3') : '';
    this.facts.replaceChildren(
      fact('Format', `${s.format} · ${s.live ? 'LIVE' : 'VOD'}`, `${s.variants} renditions${s.proxied ? ' · via proxy' : ''}`, 'overview'),
      fact('Video', t?.height ? `${t.height}p${t.hdr && t.hdr !== 'SDR' ? ` ${t.hdr}` : ''}` : s.resolution, t?.videoCodec ?? '—', 'tracks'),
      fact('Audio', t?.audioCodec ? `${t.audioCodec.split('.')[0]} ${t.channelsCount === 6 ? '5.1' : t.channelsCount ? `${t.channelsCount} ch` : ''}` : '—', t?.language ? languageName(t.language) : '—', 'audio'),
      fact('DRM', drm ? drm.name : 'Clear', drm ? [level, drm.scheme].filter(Boolean).join(' · ') : 'no encryption', 'drm'),
      fact('SCTE-35', `${ctrl.scte.size} marker${ctrl.scte.size === 1 ? '' : 's'}`, pods ? `${pods} ad pod${pods > 1 ? 's' : ''}` : 'no ad pods', 'scte'),
    );
  }
}
