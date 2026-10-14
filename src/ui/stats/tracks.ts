import type { PlayerController } from '../../player/controller';
import { badge, dataTable, h } from '../dom';
import { channels, formatBitrate, languageName } from '../format';

const yes = (b: boolean) => (b ? badge('active', 'ok') : '');
const mono = (s: string | null | undefined) => h('span', { class: 'mono' }, s || '—');

export class TracksTab {
  readonly el = h('div', { class: 'tab-pane' });

  constructor(private readonly ctrl: PlayerController) {}

  render() {
    const p = this.ctrl.player;
    if (!this.ctrl.loadedUrl) {
      this.el.replaceChildren(h('p', { class: 'muted' }, 'No stream loaded.'));
      return;
    }
    // Unique video renditions (variants repeat per audio track).
    const variants = p.getVariantTracks();
    const byVideo = new Map<number | null, (typeof variants)[number]>();
    for (const t of variants) {
      if (!byVideo.has(t.videoId) || t.active) byVideo.set(t.videoId, t);
    }
    const uniqueVideo = [...byVideo.values()].sort(
      (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth,
    );

    const audio = p.getAudioTracks();
    const text = p.getTextTracks();
    const images = p.getImageTracks();

    this.el.replaceChildren(
      h('h3', null, `Video renditions (${uniqueVideo.length})`),
      dataTable(
        ['Resolution', 'FPS', 'Codec', 'Video bitrate', 'Variant bitrate', 'Range', ''],
        uniqueVideo.map((t) => [
          t.width ? `${t.width}×${t.height}` : 'audio-only',
          t.frameRate ? String(+t.frameRate.toFixed(3)) : '—',
          mono(t.videoCodec),
          formatBitrate(t.videoBandwidth),
          formatBitrate(t.bandwidth),
          `${t.hdr ?? 'SDR'}${t.colorGamut ? ` / ${t.colorGamut}` : ''}`,
          yes(t.active),
        ]),
      ),
      h('h3', null, `Audio tracks (${audio.length})`),
      dataTable(
        ['Language', 'Label', 'Roles', 'Codec', 'Channels', 'Sample rate', ''],
        audio.map((t) => [
          languageName(t.language),
          t.label ?? '—',
          t.roles.join(', ') || '—',
          mono(t.codecs),
          `${channels(t.channelsCount) || '—'}${t.spatialAudio ? ' · spatial' : ''}`,
          t.audioSamplingRate ? `${t.audioSamplingRate / 1000} kHz` : '—',
          yes(t.active),
        ]),
      ),
      h('h3', null, `Subtitles / captions (${text.length})`),
      dataTable(
        ['Language', 'Label', 'Kind', 'Format', 'Roles', 'Flags', ''],
        text.map((t) => [
          languageName(t.language),
          t.label ?? '—',
          t.kind ?? '—',
          mono([t.mimeType, t.codecs].filter(Boolean).join(' ')),
          t.roles.join(', ') || '—',
          [t.forced && 'forced', t.primary && 'primary', t.accessibilityPurpose].filter(Boolean).join(', ') || '—',
          yes(t.active),
        ]),
      ),
      ...(images.length
        ? [
            h('h3', null, `Thumbnail tracks (${images.length})`),
            dataTable(
              ['Size', 'Tiles', 'Format'],
              images.map((t) => [`${t.width ?? '?'}×${t.height ?? '?'}`, t.tilesLayout ?? '—', mono(t.mimeType)]),
            ),
          ]
        : []),
      h('h3', null, `All variants (${variants.length})`),
      dataTable(
        ['ID', 'Video', 'Audio', 'Bandwidth', ''],
        variants.map((t) => [
          String(t.id),
          t.height ? `${t.height}p ${t.videoCodec ?? ''}` : '—',
          `${t.audioLanguage ?? t.language ?? ''} ${t.audioCodec ?? ''}`,
          formatBitrate(t.bandwidth),
          yes(t.active),
        ]),
        'compact',
      ),
    );
  }
}
