export interface Preset {
  name: string;
  url: string;
  group: 'Bundled sample (offline)' | 'VOD' | 'Live';
  notes?: string;
}

/** Resolves a path inside /public against the app's base URL. */
const local = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).toString();

export function presets(): Preset[] {
  return [
    {
      group: 'Bundled sample (offline)',
      name: 'SCTE-35 demo — DASH (EventStream + emsg)',
      url: local('samples/scte-demo/dash.mpd'),
      notes: 'VP9/Opus, 2 renditions, EN+IT audio and subtitles, 3 SCTE-35 markers',
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
    { group: 'Live', name: 'DASH-IF livesim2 — live DASH with SCTE-35 emsg', url: 'https://livesim2.dashif.org/livesim2/scte35_2/testpic_2s/Manifest.mpd' },
    { group: 'Live', name: 'DASH-IF livesim2 — live DASH', url: 'https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd' },
    { group: 'Live', name: 'Akamai test — live HLS', url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8' },
  ];
}
