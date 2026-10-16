import type { AudioEngine } from '../audio/engine';
import { audioPrefs } from '../audio/prefs';
import type { PlayerController } from '../player/controller';
import type { ScteEvent } from '../scte/monitor';
import { clear, h } from './dom';
import { channels, formatBitrate, formatTime, languageName, languageShort } from './format';
import { icons } from './icons';
import { SeekBar } from './seekbar';

/**
 * Custom control bar: play/pause, seek bar, volume, time / live edge,
 * audio, subtitle, quality and speed selectors, stats overlay, PiP and
 * fullscreen. Native <select>s keep it keyboard and screen-reader friendly.
 */
export class Controls {
  private playBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Play (k)', title: 'Play (k)' });
  private muteBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Mute (m)', title: 'Mute (m)' });
  private volume = h('input', { type: 'range', min: '0', max: '1', step: '0.05', class: 'volume', 'aria-label': 'Volume' });
  private time = h('span', { class: 'time' }, '--:-- / --:--');
  private liveBtn = h('button', { type: 'button', class: 'live-btn', title: 'Jump to live edge (l)', hidden: true }, 'LIVE');
  private audioSel = h('select', { class: 'ctl-select', 'aria-label': 'Audio track', title: 'Audio track' });
  private textSel = h('select', { class: 'ctl-select', 'aria-label': 'Subtitles', title: 'Subtitles (c)' });
  private qualitySel = h('select', { class: 'ctl-select', 'aria-label': 'Quality', title: 'Quality' });
  private speedSel = h(
    'select',
    { class: 'ctl-select narrow', 'aria-label': 'Playback speed', title: 'Playback speed' },
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => h('option', { value: String(r), selected: r === 1 }, `${r}×`)),
  );
  private nerdBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Stats overlay (i)', title: 'Stats overlay (i)', 'aria-pressed': 'false' });
  private metersBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Audio meters (a)', title: 'Audio meters (a)' });
  private pipBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Picture-in-picture', title: 'Picture-in-picture' });
  private fsBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Fullscreen (f)', title: 'Fullscreen (f)' });
  readonly seekbar: SeekBar;

  constructor(
    private readonly ctrl: PlayerController,
    container: HTMLElement,
    private readonly playerEl: HTMLElement,
    private readonly overlay: { toggle(): boolean },
    onMarkerClick: (e: ScteEvent) => void,
    private readonly audio: AudioEngine,
  ) {
    this.seekbar = new SeekBar(ctrl, onMarkerClick);
    const video = ctrl.video;

    this.playBtn.innerHTML = icons.play;
    this.nerdBtn.innerHTML = icons.nerd;
    this.metersBtn.innerHTML = icons.meters;
    this.pipBtn.innerHTML = icons.pip;
    this.fsBtn.innerHTML = icons.fullscreen;
    this.pipBtn.hidden = !document.pictureInPictureEnabled;

    clear(
      container,
      this.seekbar.el,
      h(
        'div',
        { class: 'ctl-row' },
        this.playBtn,
        h('div', { class: 'vol-group' }, this.muteBtn, this.volume),
        this.time,
        this.liveBtn,
        h('div', { class: 'spacer' }),
        h('label', { class: 'ctl-label' }, h('span', null, 'Audio'), this.audioSel),
        h('label', { class: 'ctl-label' }, h('span', null, 'Subs'), this.textSel),
        h('label', { class: 'ctl-label' }, h('span', null, 'Quality'), this.qualitySel),
        this.speedSel,
        this.metersBtn,
        this.nerdBtn,
        this.pipBtn,
        this.fsBtn,
      ),
    );

    this.playBtn.onclick = () => this.togglePlay();
    // Volume goes through the audio engine (Web Audio gain once meters run).
    this.muteBtn.onclick = () => audio.setMuted(!audio.muted);
    this.volume.oninput = () => {
      const v = Number(this.volume.value);
      audio.setVolume(v);
      if (v === 0) audio.setMuted(true);
    };
    this.metersBtn.onclick = () => (audioPrefs.overlay = !audioPrefs.overlay);
    audioPrefs.onChange(() => this.metersBtn.setAttribute('aria-pressed', String(audioPrefs.overlay)));
    this.metersBtn.setAttribute('aria-pressed', String(audioPrefs.overlay));
    audio.on('volume', () => this.renderVolume());
    this.liveBtn.onclick = () => ctrl.player.goToLive();
    this.speedSel.onchange = () => (video.playbackRate = Number(this.speedSel.value));
    this.nerdBtn.onclick = () => this.nerdBtn.setAttribute('aria-pressed', String(this.overlay.toggle()));
    this.pipBtn.onclick = () => this.togglePip();
    this.fsBtn.onclick = () => this.toggleFullscreen();
    this.audioSel.onchange = () => this.selectAudio();
    this.textSel.onchange = () => this.selectText();
    this.qualitySel.onchange = () => this.selectQuality();

    video.addEventListener('play', () => this.renderPlayState());
    video.addEventListener('pause', () => this.renderPlayState());
    video.addEventListener('ratechange', () => (this.speedSel.value = String(video.playbackRate)));
    video.addEventListener('timeupdate', () => this.updateTime());
    video.addEventListener('click', () => this.togglePlay());
    video.addEventListener('dblclick', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      this.fsBtn.innerHTML = document.fullscreenElement ? icons.exitFullscreen : icons.fullscreen;
    });
    ctrl.on('tracks', () => this.renderTracks());
    ctrl.on('loaded', () => {
      this.renderTracks();
      this.updateTime();
    });
    ctrl.on('tick', () => this.updateTime());

    this.renderVolume();
    this.renderTracks();
    this.installKeyboard();
  }

  togglePlay() {
    const v = this.ctrl.video;
    if (!this.ctrl.loadedUrl) return;
    if (v.paused || v.ended) v.play().catch(() => undefined);
    else v.pause();
  }

  private async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.ctrl.video.requestPictureInPicture();
    } catch {
      /* not allowed before metadata is loaded */
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else this.playerEl.requestFullscreen().catch(() => undefined);
  }

  private renderPlayState() {
    const paused = this.ctrl.video.paused;
    this.playBtn.innerHTML = paused ? icons.play : icons.pause;
    this.playBtn.setAttribute('aria-label', paused ? 'Play (k)' : 'Pause (k)');
    this.playerEl.classList.toggle('paused', paused);
  }

  private renderVolume() {
    const v = this.audio;
    this.muteBtn.innerHTML = v.muted || v.volume === 0 ? icons.muted : icons.volume;
    this.volume.value = String(v.muted ? 0 : v.volume);
    this.volume.style.setProperty('--fill', `${(v.muted ? 0 : v.volume) * 100}%`);
  }

  updateTime() {
    const p = this.ctrl.player;
    const v = this.ctrl.video;
    this.seekbar.update();
    if (!this.ctrl.loadedUrl) {
      this.time.textContent = '--:-- / --:--';
      this.liveBtn.hidden = true;
      return;
    }
    if (p.isLive()) {
      const { end } = p.seekRange();
      const behind = end - v.currentTime;
      const atEdge = behind < Math.max(3, (p.getStats().maxSegmentDuration || 2) * 1.5) + 3;
      this.liveBtn.hidden = false;
      this.liveBtn.classList.toggle('at-edge', atEdge);
      const wall = p.getPlayheadTimeAsDate();
      this.time.textContent = `${atEdge ? 'Live' : formatTime(-behind)}${wall ? ` · ${wall.toLocaleTimeString()}` : ''}`;
    } else {
      this.liveBtn.hidden = true;
      this.time.textContent = `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
    }
  }

  renderTracks() {
    const p = this.ctrl.player;
    const loaded = Boolean(this.ctrl.loadedUrl);

    // Audio
    const audio = loaded ? p.getAudioTracks() : [];
    clear(
      this.audioSel,
      audio.length
        ? audio.map((t, i) =>
            h(
              'option',
              { value: String(i), selected: t.active },
              [
                languageShort(t.language),
                t.label !== languageShort(t.language) && t.label,
                channels(t.channelsCount),
                t.roles.filter((r) => r !== 'main').join(','),
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          )
        : h('option', null, '—'),
    );
    this.audioSel.disabled = audio.length < 2;

    // Text
    const text = loaded ? p.getTextTracks() : [];
    const activeText = text.find((t) => t.active);
    clear(
      this.textSel,
      h('option', { value: '-1', selected: !activeText }, 'Off'),
      text.map((t, i) =>
        h(
          'option',
          { value: String(i), selected: t.active },
          [
            languageShort(t.language),
            t.label !== languageShort(t.language) && t.label,
            t.forced && 'forced',
            t.kind === 'caption' && 'CC',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    );
    this.textSel.disabled = text.length === 0;

    // Quality: variants that share the active audio.
    const variants = loaded ? this.qualityTracks() : [];
    const abr = loaded ? p.getConfiguration().abr.enabled : true;
    const active = variants.find((t) => t.active);
    clear(
      this.qualitySel,
      h(
        'option',
        { value: 'auto', selected: abr },
        `Auto${abr && active ? ` (${active.height ? `${active.height}p` : formatBitrate(active.bandwidth)})` : ''}`,
      ),
      variants.map((t) =>
        h(
          'option',
          { value: String(t.id), selected: !abr && t.active },
          `${t.height ? `${t.height}p` : 'audio'}${t.frameRate && t.frameRate > 30 ? Math.round(t.frameRate) : ''} · ${formatBitrate(t.bandwidth)}`,
        ),
      ),
    );
    this.qualitySel.disabled = variants.length < 2;
  }

  private qualityTracks() {
    const all = this.ctrl.player.getVariantTracks();
    const activeAudio = all.find((t) => t.active)?.audioId;
    const tracks = all.filter((t) => t.audioId === activeAudio || activeAudio === undefined);
    return tracks.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
  }

  private selectAudio() {
    const track = this.ctrl.player.getAudioTracks()[Number(this.audioSel.value)];
    if (track) {
      this.ctrl.player.selectAudioTrack(track);
      this.ctrl.info(`Audio → ${languageName(track.language)}${track.label ? ` (${track.label})` : ''}`);
    }
  }

  private selectText() {
    const i = Number(this.textSel.value);
    const track = i >= 0 ? this.ctrl.player.getTextTracks()[i] : null;
    this.ctrl.player.selectTextTrack(track);
    this.ctrl.info(`Subtitles → ${track ? languageName(track.language) : 'off'}`);
  }

  private selectQuality() {
    const p = this.ctrl.player;
    if (this.qualitySel.value === 'auto') {
      p.configure({ abr: { enabled: true } });
      this.ctrl.info('Quality → Auto (ABR enabled)');
    } else {
      const track = p.getVariantTracks().find((t) => String(t.id) === this.qualitySel.value);
      if (!track) return;
      p.configure({ abr: { enabled: false } });
      p.selectVariantTrack(track, true);
      this.ctrl.info(`Quality → ${track.height ?? '?'}p @ ${formatBitrate(track.bandwidth)} (ABR disabled)`);
    }
    this.renderTracks();
  }

  private cycleSubtitles() {
    const n = this.textSel.options.length;
    if (n < 2) return;
    this.textSel.selectedIndex = (this.textSel.selectedIndex + 1) % n;
    this.selectText();
  }

  private installKeyboard() {
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = this.ctrl.video;
      const handled = (() => {
        switch (e.key) {
          case ' ':
          case 'k':
            this.togglePlay();
            return true;
          case 'ArrowLeft':
            v.currentTime -= 5;
            return true;
          case 'ArrowRight':
            v.currentTime += 5;
            return true;
          case 'ArrowUp':
            this.audio.setVolume(this.audio.volume + 0.1);
            this.audio.setMuted(false);
            return true;
          case 'ArrowDown':
            this.audio.setVolume(this.audio.volume - 0.1);
            return true;
          case 'm':
            this.audio.setMuted(!this.audio.muted);
            return true;
          case 'a':
            audioPrefs.overlay = !audioPrefs.overlay;
            return true;
          case 'f':
            this.toggleFullscreen();
            return true;
          case 'c':
            this.cycleSubtitles();
            return true;
          case 'i':
            this.nerdBtn.click();
            return true;
          case 'l':
            if (this.ctrl.player.isLive()) this.ctrl.player.goToLive();
            return true;
        }
        return false;
      })();
      if (handled && this.ctrl.loadedUrl) e.preventDefault();
    });
  }
}
