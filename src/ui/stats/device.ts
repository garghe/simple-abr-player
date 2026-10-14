import shaka from 'shaka-player';
import { badge, dataTable, h, kvTable } from '../dom';

/**
 * Device capabilities: codec support (MSE + MediaCapabilities), DRM key
 * systems and security levels, HDCP and display. Useful now to understand
 * what a device can play, and the groundwork for the DRM iteration.
 */

const CODECS: [string, string][] = [
  ['H.264 / AVC High', 'video/mp4; codecs="avc1.640028"'],
  ['H.265 / HEVC Main10', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
  ['VP9 Profile 0', 'video/mp4; codecs="vp09.00.40.08"'],
  ['VP9 Profile 2 (HDR)', 'video/mp4; codecs="vp09.02.40.10.01.09.16.09.00"'],
  ['AV1 Main 8-bit', 'video/mp4; codecs="av01.0.08M.08"'],
  ['AV1 Main 10-bit', 'video/mp4; codecs="av01.0.12M.10"'],
  ['Dolby Vision (dvh1.05)', 'video/mp4; codecs="dvh1.05.06"'],
  ['AAC-LC', 'audio/mp4; codecs="mp4a.40.2"'],
  ['HE-AAC v2', 'audio/mp4; codecs="mp4a.40.29"'],
  ['Dolby Digital (AC-3)', 'audio/mp4; codecs="ac-3"'],
  ['Dolby Digital Plus (E-AC-3)', 'audio/mp4; codecs="ec-3"'],
  ['Dolby AC-4', 'audio/mp4; codecs="ac-4.02.01.01"'],
  ['Opus', 'audio/mp4; codecs="opus"'],
  ['FLAC', 'audio/mp4; codecs="flac"'],
  ['MPEG-2 TS (H.264/AAC)', 'video/mp2t; codecs="avc1.640028,mp4a.40.2"'],
];

interface KeySystemCheck {
  name: string;
  keySystem: string;
  robustness: string[];
}

const KEY_SYSTEMS: KeySystemCheck[] = [
  {
    name: 'Widevine',
    keySystem: 'com.widevine.alpha',
    robustness: ['HW_SECURE_ALL', 'HW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'SW_SECURE_CRYPTO'],
  },
  { name: 'PlayReady (SL3000/2000)', keySystem: 'com.microsoft.playready.recommendation', robustness: ['3000', '2000', '150'] },
  { name: 'PlayReady (legacy)', keySystem: 'com.microsoft.playready', robustness: [''] },
  { name: 'FairPlay', keySystem: 'com.apple.fps', robustness: [''] },
  { name: 'ClearKey', keySystem: 'org.w3.clearkey', robustness: [''] },
];

interface DrmResult {
  name: string;
  keySystem: string;
  supported: boolean;
  levels: string[];
  hdcp?: string;
  persistentState?: boolean;
}

async function probeKeySystem(ks: KeySystemCheck): Promise<DrmResult> {
  const result: DrmResult = { name: ks.name, keySystem: ks.keySystem, supported: false, levels: [] };
  if (!navigator.requestMediaKeySystemAccess) return result;
  for (const robustness of ks.robustness) {
    try {
      const access = await navigator.requestMediaKeySystemAccess(ks.keySystem, [
        {
          initDataTypes: ['cenc', 'sinf', 'skd', 'keyids'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"', robustness }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: ks.name === 'Widevine' ? 'SW_SECURE_CRYPTO' : robustness }],
        },
      ]);
      result.supported = true;
      if (robustness) result.levels.push(robustness);
      result.persistentState = access.getConfiguration().persistentState === 'required';
      if (!result.hdcp) result.hdcp = await probeHdcp(access);
    } catch {
      /* not supported at this level */
    }
  }
  return result;
}

async function probeHdcp(access: MediaKeySystemAccess): Promise<string | undefined> {
  try {
    const keys = (await access.createMediaKeys()) as MediaKeys & {
      getStatusForPolicy?: (p: { minHdcpVersion: string }) => Promise<string>;
    };
    if (!keys.getStatusForPolicy) return undefined;
    let best = 'none';
    for (const v of ['1.0', '1.4', '2.0', '2.1', '2.2', '2.3']) {
      if ((await keys.getStatusForPolicy({ minHdcpVersion: v })) === 'usable') best = v;
    }
    return best;
  } catch {
    return undefined;
  }
}

async function mediaCapabilities(contentType: string): Promise<string> {
  if (!navigator.mediaCapabilities || contentType.startsWith('video/mp2t')) return '';
  const isVideo = contentType.startsWith('video');
  try {
    const info = await navigator.mediaCapabilities.decodingInfo(
      isVideo
        ? { type: 'media-source', video: { contentType, width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30 } }
        : { type: 'media-source', audio: { contentType, channels: '2', bitrate: 128_000, samplerate: 48000 } },
    );
    if (!info.supported) return 'no';
    return [info.smooth && 'smooth', info.powerEfficient && 'power-efficient'].filter(Boolean).join(', ') || 'yes';
  } catch {
    return '';
  }
}

const mq = (q: string) => window.matchMedia?.(q).matches ?? false;

export class DeviceTab {
  readonly el = h('div', { class: 'tab-pane' });
  private started = false;

  render() {
    if (this.started) return;
    this.started = true;
    this.el.replaceChildren(h('p', { class: 'muted' }, 'Probing codecs and DRM…'));
    this.probe().catch((e) => this.el.replaceChildren(h('p', { class: 'error' }, String(e))));
  }

  private async probe() {
    const codecRows = await Promise.all(
      CODECS.map(async ([name, type]) => {
        const mse = window.MediaSource?.isTypeSupported(type) ?? false;
        return [name, h('span', { class: 'mono small' }, type), badge(mse ? 'yes' : 'no', mse ? 'ok' : 'warn'), await mediaCapabilities(type)];
      }),
    );
    const drm = await Promise.all(KEY_SYSTEMS.map(probeKeySystem));
    const ua = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[]; platform: string } };

    this.el.replaceChildren(
      h('h3', null, 'Environment'),
      kvTable([
        ['User agent', h('span', { class: 'mono break small' }, navigator.userAgent)],
        ['Browser', ua.userAgentData ? ua.userAgentData.brands.map((b) => `${b.brand} ${b.version}`).join(', ') : '—'],
        ['Shaka Player', shaka.Player.version],
        ['MSE / ManagedMediaSource', `${'MediaSource' in window ? 'yes' : 'no'} / ${'ManagedMediaSource' in window ? 'yes' : 'no'}`],
        ['Secure context (needed for EME)', window.isSecureContext ? badge('yes', 'ok') : badge('no — DRM will not work', 'warn')],
        ['Screen', `${screen.width}×${screen.height} @${window.devicePixelRatio}x`],
        ['HDR display', mq('(dynamic-range: high)') ? badge('yes', 'ok') : 'no'],
        ['Colour gamut', mq('(color-gamut: rec2020)') ? 'Rec. 2020' : mq('(color-gamut: p3)') ? 'Display P3' : 'sRGB'],
      ]),
      h('h3', null, 'DRM key systems'),
      dataTable(
        ['Key system', 'Supported', 'Security levels', 'HDCP'],
        drm.map((d) => [
          h('span', null, d.name, h('div', { class: 'mono small muted' }, d.keySystem)),
          badge(d.supported ? 'yes' : 'no', d.supported ? 'ok' : ''),
          d.levels.join(', ') || (d.supported ? 'default' : '—'),
          d.hdcp ?? '—',
        ]),
      ),
      h('h3', null, 'Codecs'),
      dataTable(['Codec', 'MIME', 'MSE', '1080p decode'], codecRows, 'compact'),
    );
  }
}
