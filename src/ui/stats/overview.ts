import { widevineLevelName } from '../../drm/settings';
import type { PlayerController } from '../../player/controller';
import { drawChart } from '../chart';
import { badge, h, kvTable } from '../dom';
import { clock, formatBitrate, formatBytes, formatPrecise, formatTime } from '../format';

function drmLabel(ctrl: PlayerController): string {
  const d = ctrl.activeDrm();
  if (!d) return 'clear';
  const level = d.name === 'Widevine' ? widevineLevelName(d.videoRobustness).split(' ')[0] : '';
  return `${d.name}${level ? ` ${level}` : ''}`;
}

export interface Snapshot {
  format: string;
  live: boolean;
  url: string | null;
  proxied: boolean;
  resolution: string;
  variant: string;
  codecs: string;
  videoCodec: string;
  audioCodec: string;
  frameRate: string;
  hdr: string;
  streamBandwidth: number;
  estimatedBandwidth: number;
  bufferAhead: number;
  bufferBehind: number;
  droppedFrames: number;
  decodedFrames: number;
  corruptedFrames: number;
  liveLatency: number | null;
  seekRange: { start: number; end: number } | null;
  playheadDate: Date | null;
  presentationStart: Date | null;
  periods: number;
  maxSegmentDuration: number;
  bytesDownloaded: number;
  loadLatency: number;
  timeToFirstFrame: number;
  bufferingTime: number;
  stalls: number;
  gapsJumped: number;
  state: string;
  audioTracks: number;
  textTracks: number;
  variants: number;
  drm: string;
}

/** Gathers everything the overview, the overlay and the JSON export show. */
export function snapshot(ctrl: PlayerController): Snapshot {
  const p = ctrl.player;
  const v = ctrl.video;
  const loaded = Boolean(ctrl.loadedUrl);
  const stats = p.getStats();
  const variants = loaded ? p.getVariantTracks() : [];
  const active = variants.find((t) => t.active);
  const buffered = loaded ? p.getBufferedInfo().total : [];
  const t = v.currentTime;
  const range = buffered.find((r) => r.start <= t + 0.1 && r.end >= t);
  const quality = v.getVideoPlaybackQuality?.();
  return {
    format: loaded ? ctrl.format : '—',
    live: loaded && p.isLive(),
    url: ctrl.loadedUrl,
    proxied: ctrl.usingProxy,
    resolution: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '—',
    variant: active ? `${active.width ?? '?'}×${active.height ?? '?'} · ${formatBitrate(active.bandwidth)}` : '—',
    codecs: stats.currentCodecs || active?.codecs || '—',
    videoCodec: active?.videoCodec ?? '—',
    audioCodec: active?.audioCodec ?? '—',
    frameRate: active?.frameRate ? `${+active.frameRate.toFixed(3)} fps` : '—',
    hdr: active ? `${active.hdr ?? 'SDR'}${active.colorGamut ? ` · ${active.colorGamut}` : ''}` : '—',
    streamBandwidth: stats.streamBandwidth,
    estimatedBandwidth: stats.estimatedBandwidth,
    bufferAhead: range ? range.end - t : 0,
    bufferBehind: range ? t - range.start : 0,
    droppedFrames: count(quality?.droppedVideoFrames ?? stats.droppedFrames),
    decodedFrames: count(quality?.totalVideoFrames ?? stats.decodedFrames),
    corruptedFrames: count(stats.corruptedFrames),
    liveLatency: loaded && p.isLive() && Number.isFinite(stats.liveLatency) ? stats.liveLatency : null,
    seekRange: loaded ? p.seekRange() : null,
    playheadDate: loaded ? p.getPlayheadTimeAsDate() : null,
    presentationStart: loaded ? p.getPresentationStartTimeAsDate() : null,
    periods: stats.manifestPeriodCount || 0,
    maxSegmentDuration: stats.maxSegmentDuration || 0,
    bytesDownloaded: stats.bytesDownloaded || 0,
    loadLatency: stats.loadLatency,
    timeToFirstFrame: stats.timeToFirstFrame,
    bufferingTime: stats.bufferingTime,
    stalls: stats.stallsDetected || 0,
    gapsJumped: stats.gapsJumped || 0,
    state: stats.stateHistory.at(-1)?.state ?? '—',
    audioTracks: loaded ? p.getAudioTracks().length : 0,
    textTracks: loaded ? p.getTextTracks().length : 0,
    variants: variants.length,
    drm: loaded ? drmLabel(ctrl) : '—',
  };
}

export class OverviewTab {
  readonly el = h('div', { class: 'tab-pane' });
  private table = h('div');
  private chart = h('canvas', { class: 'chart', height: 150 });

  constructor(private readonly ctrl: PlayerController) {
    this.el.append(h('div', { class: 'chart-wrap' }, this.chart), this.table);
  }

  render() {
    const s = snapshot(this.ctrl);
    drawChart(this.chart, this.ctrl.samples);
    const dropPct = s.decodedFrames ? ((s.droppedFrames / s.decodedFrames) * 100).toFixed(2) : '0';
    this.table.replaceChildren(
      h('h3', null, 'Stream'),
      kvTable([
        ['Format', [badge(s.format, 'accent'), ' ', badge(s.live ? 'LIVE' : 'VOD', s.live ? 'live' : ''), ' ', badge(s.drm, s.drm === 'clear' ? 'ok' : 'accent')]],
        ['URL', h('span', { class: 'mono break' }, s.url ?? '—')],
        ['Fetched via', s.url ? (s.proxied ? 'Local CORS proxy' : 'Direct (browser)') : '—'],
        ['Tracks', `${s.variants} variants · ${s.audioTracks} audio · ${s.textTracks} text`],
        ['Periods', s.periods || '—'],
        ['Max segment duration', s.maxSegmentDuration ? `${s.maxSegmentDuration.toFixed(2)}s` : '—'],
        ...(s.live
          ? ([
              ['Live latency', s.liveLatency !== null ? `${s.liveLatency.toFixed(2)}s` : '—'],
              ['DVR window', s.seekRange ? formatTime(s.seekRange.end - s.seekRange.start) : '—'],
              ['Presentation start', s.presentationStart?.toISOString() ?? '—'],
            ] as [string, string][])
          : []),
        ['Playhead (UTC)', s.playheadDate ? clock(s.playheadDate) : '—'],
      ]),
      h('h3', null, 'Playback'),
      kvTable([
        ['State', s.state],
        ['Current variant', s.variant],
        ['Rendered resolution', s.resolution],
        ['Codecs', h('span', { class: 'mono' }, s.codecs)],
        ['Video / audio', h('span', { class: 'mono' }, `${s.videoCodec} / ${s.audioCodec}`)],
        ['Frame rate', s.frameRate],
        ['Dynamic range', s.hdr],
        ['Stream bitrate', formatBitrate(s.streamBandwidth)],
        ['Estimated bandwidth', formatBitrate(s.estimatedBandwidth)],
        ['Buffer', `${s.bufferAhead.toFixed(2)}s ahead · ${s.bufferBehind.toFixed(1)}s behind`],
        ['Frames', `${s.decodedFrames} decoded · ${s.droppedFrames} dropped (${dropPct}%) · ${s.corruptedFrames} corrupted`],
        ['Stalls / gaps jumped', `${s.stalls} / ${s.gapsJumped}`],
        ['Time buffering', formatPrecise(s.bufferingTime)],
        ['Load latency', formatPrecise(s.loadLatency)],
        ['Time to first frame', formatPrecise(s.timeToFirstFrame)],
        ['Downloaded', formatBytes(s.bytesDownloaded)],
      ]),
    );
  }
}

/** Shaka reports unavailable counters as NaN; show those as 0. */
function count(n: number | undefined): number {
  return Number.isFinite(n) ? (n as number) : 0;
}
