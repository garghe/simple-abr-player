# Changelog

All notable changes to PlayProbe are listed here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): minor versions add features, patch versions fix bugs.

## [Unreleased]

Planned as 1.2.0.

### Added

- **SCTE-35 Health**: checks of OUT/IN pairing and advertised durations, segmentation start/end pairs, event IDs, CRC, `CUE-OUT-CONT` elapsed times, `DATERANGE` attributes, markers missing from some playlists, lead time, segment alignment and `splice_time` consistency, with errors, warnings and notes.
- **Splice timing** in the marker detail: lead time, segment alignment, `splice_time` with `pts_adjustment`, wall clock, playlists carrying the marker.
- **Timeline** of breaks, segmentation (programme, chapter, break, ad, placement opportunity, promo), inserted ads, health issues, quality switches and stalls.
- **Structure** view (programme → chapter → break → placement opportunity → ad) with decoded UPIDs.
- **Ad insertion** detection (HLS discontinuities from another origin, DASH periods, HLS Interstitials), matched with breaks, with underfill/overfill.
- **Monitor** mode: sound and browser notifications for new markers, counts per hour, CSV export.
- **SCTE-35 message builder** with presets, output as base64, hex, HLS tags and DASH EventStream.
- Marker and break navigation: `n` / `p` / `b` / `s` keys, buttons, and a Skip button on the ad-break banner.
- **SCTE-35 health demo** sample stream with an inserted ad pod and deliberate signalling errors; `npm run test:e2e:scte`.

### Changed

- TI UPIDs are shown as a number and MPU UPIDs with their format identifier.

## [1.0.0] - 2026-10-31

First release.

### Added

- **Playback** of MPEG-DASH and HLS streams with Shaka Player: play/pause, seek bar with buffered ranges and SCTE-35 markers, volume, audio track, subtitles, quality (Auto or fixed), speed, picture-in-picture, fullscreen, jump to live, keyboard shortcuts.
- **Stats for nerds** tabs: Overview (with bandwidth and buffer graph), Tracks, Audio, DRM, SCTE-35, Network, Manifest (raw MPD and playlists with ad tags highlighted), Device (codec, DRM, HDCP and HDR support) and Log; stats overlay on the video; Export JSON and Copy link.
- **SCTE-35**: detection in DASH EventStream, in-band `emsg`, HLS `EXT-X-DATERANGE`, `CUE-OUT`/`CUE-OUT-CONT`/`CUE-IN`, `EXT-X-SCTE35`, `OATCLS` and `SPLICEPOINT`; full decoder with CRC check; active ad-break banner with countdown; manual decoder.
- **Audio meters**: per-channel levels on the video (stereo and 5.1) and an Audio tab with EBU R128 / ATSC A/85 loudness (momentary, short-term, integrated, true peak, loudness range) and phase correlation.
- **DRM**: Widevine and FairPlay with any license server (URL, headers, generic request/response formats), saved profiles, Safari native fallback, license requests through the CORS proxy, and DRM details in the DRM tab.
- **CORS proxy** for plain HTTPS streams: built into the dev and preview servers, with Auto / Always / Off modes and custom request headers.
- **Cloudflare Workers** deployment, with an optional proxy limited to allowed hosts and, by default, to manifests and playlists.
- System / Light / Dark theme, and a draggable splitter between the player and the stats panel.
- Bundled offline DASH + HLS sample with SCTE-35 markers, subtitles and a 5.1 track.
- PlayProbe name, logo and icons; MIT license.
- Version and release date next to the logo (linking to this changelog), and in Export JSON.

### Fixed

- Stats tab bar no longer collapses over the tab content.
- DRM playback no longer shows a blank picture because of rounded corners and blurred overlays; blank video on DisplayLink screens is documented.
- Frame counters show 0 instead of NaN before a stream loads.

[Unreleased]: https://github.com/garghe/simple-abr-player/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/garghe/simple-abr-player/releases/tag/v1.0.0
