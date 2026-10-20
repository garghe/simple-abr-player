import type { DrmSettings } from './drm/settings';

export interface Preset {
  name: string;
  url: string;
  group: 'Bundled sample (offline)' | 'VOD' | 'Live' | 'DRM (Widevine test)';
  notes?: string;
  /** DRM settings filled in when this preset is chosen. */
  drm?: Omit<Partial<DrmSettings>, 'widevine'> & { widevine?: Partial<DrmSettings['widevine']> };
}

const GOOGLE_WIDEVINE_TEST = 'https://cwip-shaka-proxy.appspot.com/no_auth';

/** Resolves a path inside /public against the app's base URL. */
const local = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).toString();

export function presets(): Preset[] {
  return [
    {
      group: 'Bundled sample (offline)',
      name: 'SCTE-35 demo — DASH (EventStream + emsg)',
      url: local('samples/scte-demo/dash.mpd'),
      notes: 'VP9/Opus, 2 renditions, EN/IT stereo + EN 5.1 audio, EN/IT subtitles, SCTE-35 markers',
    },
    {
      group: 'Bundled sample (offline)',
      name: 'SCTE-35 demo — HLS (DATERANGE + CUE-OUT/IN + emsg)',
      url: local('samples/scte-demo/master.m3u8'),
    },
    { group: 'VOD', name: 'Angel One — DASH, multi-audio + subtitles (Shaka)', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd' },
    { group: 'VOD', name: 'Angel One — HLS (Shaka)', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8' },
    { group: 'VOD', name: 'Sintel — DASH MP4 (Shaka)', url: 'https://storage.googleapis.com/shaka-demo-assets/sintel-mp4-only/dash.mpd' },
    { group: 'VOD', name: 'Big Buck Bunny — DASH (Akamai)', url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd' },
    { group: 'VOD', name: 'Apple BipBop advanced — HLS fMP4', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8' },
    { group: 'VOD', name: 'Big Buck Bunny — HLS TS (Mux)', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
    {
      group: 'DRM (Widevine test)',
      name: 'Angel One — DASH Widevine (Google test license server)',
      url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd',
      notes: 'Chrome / Edge / Firefox. Fills the DRM settings with Google\'s public Widevine test license server.',
      drm: { mode: 'widevine', widevine: { licenseUrl: GOOGLE_WIDEVINE_TEST } },
    },
    {
      group: 'DRM (Widevine test)',
      name: 'Angel One — HLS Widevine (Google test license server)',
      url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine-hls/hls.m3u8',
      drm: { mode: 'widevine', widevine: { licenseUrl: GOOGLE_WIDEVINE_TEST } },
    },
    { group: 'Live', name: 'DASH-IF livesim2 — live DASH with SCTE-35 emsg', url: 'https://livesim2.dashif.org/livesim2/scte35_2/testpic_2s/Manifest.mpd' },
    { group: 'Live', name: 'DASH-IF livesim2 — live DASH', url: 'https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd' },
    { group: 'Live', name: 'Akamai test — live HLS', url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8' },
  ];
}
