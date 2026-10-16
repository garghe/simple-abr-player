import type { AudioEngine } from '../../audio/engine';
import { STANDARDS, channelLabels, type LoudnessStandard } from '../../audio/loudness';
import { audioPrefs } from '../../audio/prefs';
import type { PlayerController } from '../../player/controller';
import { badge, h, kvTable } from '../dom';
import { channels as channelName, languageName } from '../format';
import { MeterBank } from '../audio/meters';

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

const DOLBY = {
  ac3: (() => {
    try {
      return MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"');
    } catch {
      return false;
    }
  })(),
  ec3: (() => {
    try {
      return MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"');
    } catch {
      return false;
    }
  })(),
};

/**
 * Audio tab: large per-channel meters, broadcast loudness (EBU R128 or
 * ATSC A/85), and declared-vs-decoded channel information. The DOM is built
 * once and updated in place (10 updates per second).
 */
export class AudioTab {
  readonly el = h('div', { class: 'tab-pane' });
  private bank = new MeterBank({ size: 'large', values: true });
  private tiles: Record<string, { root: HTMLElement; value: HTMLElement; sub: HTMLElement }> = {};
  private stdButtons = new Map<LoudnessStandard, HTMLButtonElement>();
  private status = h('div');
  private info = h('div');
  private notes = h('div');
  private infoKey = '';

  constructor(
    private readonly ctrl: PlayerController,
    private readonly engine: AudioEngine,
  ) {
    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Loudness standard' });
    for (const id of ['ebu', 'atsc'] as LoudnessStandard[]) {
      const b = h('button', { type: 'button', onclick: () => (audioPrefs.standard = id) }, STANDARDS[id].name);
      this.stdButtons.set(id, b);
      seg.append(b);
    }
    const tile = (id: string, label: string) => {
      const value = h('b', null, '—');
      const sub = h('small', null, '');
      const root = h('div', { class: 'loud-tile' }, h('small', null, label), value, sub);
      this.tiles[id] = { root, value, sub };
      return root;
    };
    this.el.append(
      h(
        'div',
        { class: 'toolbar' },
        seg,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', title: 'Restart integrated loudness, LRA and maximum peaks', onclick: () => engine.reset() }, 'Reset'),
      ),
      this.status,
      h('h3', null, 'Levels (dBFS · peak / hold)'),
      h('div', { class: 'meters-panel' }, this.bank.el),
      h('h3', { id: 'loudness-heading' }, 'Loudness'),
      h(
        'div',
        { class: 'loud-grid' },
        tile('momentary', 'Momentary'),
        tile('short', 'Short-term'),
        tile('integrated', 'Integrated'),
        tile('tp', 'True peak (max)'),
        tile('lra', 'Loudness range'),
        tile('corr', 'L/R correlation'),
      ),
      h('h3', null, 'Track'),
      this.info,
      this.notes,
    );
    audioPrefs.onChange(() => this.render());
  }

  render(): void {
    const e = this.engine;
    const std = STANDARDS[audioPrefs.standard];
    for (const [id, b] of this.stdButtons) b.setAttribute('aria-pressed', String(id === audioPrefs.standard));
    this.el.querySelector('#loudness-heading')!.textContent =
      `Loudness (${std.name} · target ${std.target} ${std.unit} ±${std.tolerance})`;

    // Status line
    const streamActive = e.stream.status === 'active';
    const statusText =
      streamActive || e.state === 'running' || !this.ctrl.loadedUrl
        ? null
        : (e.state === 'unsupported' || e.state === 'error') && e.stream.status === 'unsupported'
          ? h('div', { class: 'note' }, `Audio meters unavailable: ${e.stream.reason}; ${e.error}`)
          : e.needsGesture && e.stream.status === 'unsupported'
            ? h(
                'div',
                { class: 'note info' },
                `The segments can't be measured directly (${e.stream.reason}), so the meters need the browser's audio output, which starts after you interact with the page. `,
                h('button', { type: 'button', onclick: () => void e.start() }, 'Start audio meters'),
              )
            : null;
    if (this.status.firstChild?.textContent !== statusText?.textContent) {
      this.status.replaceChildren(...(statusText ? [statusText] : []));
    }

    // Meters + loudness
    const live = e.reading;
    const r = e.lastReading;
    const active = this.activeTrack();
    const fallback = channelLabels(active?.channelsCount && active.channelsCount <= 8 ? active.channelsCount : 2);
    this.bank.update(live?.channels ?? null, r?.channels.map((c) => c.label) ?? fallback);

    const inTarget = (v: number) =>
      !Number.isFinite(v) ? '' : Math.abs(v - std.target) <= std.tolerance ? 'ok' : 'warn';
    this.setTile('momentary', live ? fmt(live.momentary) : '—', `400 ms · ${std.unit}`);
    this.setTile('short', live ? fmt(live.shortTerm) : '—', `3 s · ${std.unit}`);
    this.setTile(
      'integrated',
      r ? fmt(r.integrated) : '—',
      `${std.unit} · ${r ? `${formatDuration(r.duration)} measured` : 'since load'}`,
      r ? inTarget(r.integrated) : '',
    );
    this.setTile(
      'tp',
      r ? fmt(r.truePeakMax) : '—',
      `dBTP · limit ${std.maxTruePeak}`,
      r && Number.isFinite(r.truePeakMax) ? (r.truePeakMax > std.maxTruePeak ? 'bad' : 'ok') : '',
    );
    this.setTile('lra', r ? fmt(r.lra) : '—', 'LU');
    // +1 mono-compatible, ~0 unrelated/wide, < -0.2 phase problem (cancels in mono).
    const corr = live?.correlation ?? null;
    const corrText = corr === null ? '—' : Math.abs(corr) < 0.005 ? '0.00' : `${corr > 0 ? '+' : ''}${corr.toFixed(2)}`;
    this.setTile(
      'corr',
      corrText,
      corr === null
        ? live && live.channels.length < 2
          ? 'mono'
          : ''
        : corr < -0.2
          ? 'out of phase!'
          : corr < 0.3
            ? 'wide / uncorrelated'
            : 'phase OK',
      corr !== null && corr < -0.2 ? 'bad' : '',
    );

    this.renderInfo();
  }

  private setTile(id: string, value: string, sub: string, cls = '') {
    const t = this.tiles[id];
    t.value.textContent = value;
    t.sub.textContent = sub;
    t.root.className = `loud-tile ${cls}`;
  }

  private activeTrack() {
    return this.ctrl.loadedUrl ? this.ctrl.player.getAudioTracks().find((t) => t.active) : undefined;
  }

  /** Track table and notes change rarely: only rebuild when their inputs change. */
  private renderInfo() {
    const e = this.engine;
    const t = this.activeTrack();
    const decoded = e.reading ? e.channels : 0;
    const declared = t?.channelsCount ?? 0;
    const hiddenDolby = this.hasUndecodableDolby();
    const source = e.reading ? e.source : null;
    const key = [this.ctrl.loadedUrl, t?.language, t?.codecs, declared, decoded, e.state, e.sampleRate, hiddenDolby, source, e.stream.status].join('|');
    if (key === this.infoKey) return;
    this.infoKey = key;

    if (!this.ctrl.loadedUrl) {
      this.info.replaceChildren(h('p', { class: 'muted' }, 'No stream loaded.'));
      this.notes.replaceChildren();
      return;
    }

    const decodedCell =
      !source && e.needsGesture
        ? 'meters not started'
        : !decoded
          ? 'no audio arriving (paused?)'
          : [
              `${decoded} channel${decoded > 1 ? 's' : ''} `,
              declared && decoded < declared
                ? badge(source === 'webaudio' ? 'downmixed by browser' : 'fewer than declared', 'warn')
                : badge(decoded >= 6 ? `full ${channelName(decoded)}` : 'OK', 'ok'),
            ];

    this.info.replaceChildren(
      kvTable([
        [
          'Track (manifest)',
          t
            ? [languageName(t.language), t.label, t.codecs, declared ? `${channelName(declared)} (${declared} ch)` : '', t.audioSamplingRate ? `${t.audioSamplingRate / 1000} kHz` : '']
                .filter(Boolean)
                .join(' · ')
            : '—',
        ],
        ['Decoded by browser', decodedCell],
        ['Channel order', decoded ? channelLabels(decoded).join(' ') : '—'],
        [
          'Measured from',
          source === 'stream'
            ? `Audio segments, decoded with WebCodecs (${e.stream.config?.codec ?? '?'} @ ${(e.stream.config?.sampleRate ?? 0) / 1000} kHz): every encoded channel, independent of speakers and volume`
            : source === 'webaudio'
              ? `Browser audio output via Web Audio @ ${e.sampleRate / 1000} kHz${e.stream.reason ? ` (segments not decodable: ${e.stream.reason})` : ''}`
              : e.stream.status === 'unsupported'
                ? `waiting (segments not decodable: ${e.stream.reason})`
                : 'waiting for audio',
        ],
        [
          'Output device',
          e.outputChannels
            ? `${e.outputChannels} channels${decoded > e.outputChannels ? ' (the browser downmixes for playback; meters read every decoded channel)' : ''}`
            : '—',
        ],
        [
          'Dolby decoding here',
          `AC-3 ${DOLBY.ac3 ? 'yes' : 'no'} · E-AC-3 ${DOLBY.ec3 ? 'yes' : 'no'}`,
        ],
      ]),
    );

    const notes: HTMLElement[] = [];
    if (declared && decoded && decoded < declared) {
      notes.push(
        h(
          'div',
          { class: 'note' },
          source === 'webaudio'
            ? `Manifest says ${declared} channels but the browser delivers ${decoded}: it downmixed the track to match your output device before the meters, so these are the levels of the downmix.`
            : `Manifest says ${declared} channels but the audio decodes to ${decoded}.`,
        ),
      );
    }
    if (hiddenDolby) {
      notes.push(
        h('div', { class: 'note' }, 'This stream also has Dolby Digital (Plus) tracks, which this browser cannot decode, so they are not offered. Try Safari, or Edge on Windows.'),
      );
    }
    this.notes.replaceChildren(...notes);
  }

  private hasUndecodableDolby(): boolean {
    if (DOLBY.ac3 && DOLBY.ec3) return false;
    for (const d of this.ctrl.documents.values()) {
      if (/(codecs="[^"]*|CODECS="[^"]*)\b(ec-3|ac-3)\b/i.test(d.text)) return true;
    }
    return false;
  }
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${Math.round(s % 60)} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
