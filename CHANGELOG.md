# Changelog

All notable changes to PlayProbe are listed here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): minor versions add features, patch versions fix bugs.

## [Unreleased]

Planned as 1.1.0 (PlayReady), 1.2.0 (SCTE-35 tools), 1.3.0 (stream health, rendition alignment, picture and sound alarms) and 1.4.0 (new design with Inspect and Monitor views).

### Added

- **PlayReady DRM**: license URL (or the one in the stream's PlayReady header), SL3000 / SL2000 security level, and the generic request/response formats; included in saved profiles. In Auto mode, Edge prefers PlayReady when it is set up.
- PlayReady headers decoded from PSSH, `mspr:pro` and HLS key tags (key IDs, version, algorithm, license URL), with a **Use this** button in the DRM tab for the stream's license URL.
- Microsoft PlayReady test streams (DASH, and HLS with CBCS) in the test stream list.
- A clear message when the DRM chosen in the settings doesn't exist in the browser.
- **SCTE-35 Health**: checks of OUT/IN pairing and advertised durations, segmentation start/end pairs, event IDs, CRC, `CUE-OUT-CONT` elapsed times, `DATERANGE` attributes, markers missing from some playlists, lead time, segment alignment and `splice_time` consistency, with errors, warnings and notes.
- **Splice timing** in the marker detail: lead time, segment alignment, `splice_time` with `pts_adjustment`, wall clock, playlists carrying the marker.
- **Timeline** of breaks, segmentation (programme, chapter, break, ad, placement opportunity, promo), inserted ads, health issues, quality switches and stalls.
- **Structure** view (programme → chapter → break → placement opportunity → ad) with decoded UPIDs.
- **Ad insertion** detection (HLS discontinuities from another origin, DASH periods, HLS Interstitials), matched with breaks, with underfill/overfill.
- **SCTE-35 alerts**: sound and browser notifications for new markers, counts per hour, CSV export.
- **SCTE-35 message builder** with presets, output as base64, hex, HLS tags and DASH EventStream.
- Marker and break navigation: `n` / `p` / `b` / `s` keys, buttons, and a Skip button on the ad-break banner.
- **SCTE-35 health demo** sample stream with an inserted ad pod and deliberate signalling errors; `npm run test:e2e:scte`.
- **Health tab: stream checks** on playlists, MPDs and every downloaded segment (fMP4/CMAF and MPEG-2 TS): target duration, media and discontinuity sequence numbering between refreshes, PROGRAM-DATE-TIME drift, stale live playlists and MPDs, SegmentTimeline and period gaps, segments not starting with a keyframe, duration and timestamp gaps, declared vs real codecs and bitrate.
- **Rendition alignment**: fetches the same segments of every video rendition and compares boundaries, media timestamps, durations and keyframes side by side.
- **Alarms tab**: black and frozen picture, silence, a lost channel, loudness off target, true peaks and out-of-phase stereo, with hold times in content time, an alarm banner on the video, timeline marks, a log with CSV export, sound or browser notification, and adjustable thresholds.
- **Stream health & alarms demo** sample (`npm run sample:alarms`) and `npm run test:e2e:health`.
- **New design** for playprobe.xyz: a two-row header (navigation, Copy link, Export, theme; load bar with format chip, DRM and proxy chips, Probe stream), refreshed light and dark themes, card layout.
- **Inspect view** (default for VOD): summary cards under the player, throughput, a health score, loudness with per-channel meters (lost or quiet channels flagged), a DRM card for protected streams, next ad break with a programme/break strip, and the bitrate ladder (declared vs measured).
- **Monitor view** (default for live): navigation rail, timeline under the player, health score, playback, loudness and a live events feed.
- **Inspect | Monitor** switch; the choice is remembered per kind of stream (live/VOD), and Copy link includes the view.
- **Welcome guide**: opens on the first visit (and from the **?** button or the `?` key) with what PlayProbe checks, how to use it and handy keys, plus a **Try the demo stream** button.
- **Link previews**: Open Graph and Twitter tags and a 1200×630 preview image (`npm run og-image`), so a shared playprobe.xyz link shows the logo, name and tagline.
- **Tooltips** that explain tabs, cards, health-score lines, table headers, Stats, DRM and loudness values, SCTE-35 fields, alarms and settings, on hover, keyboard focus or tap.

### Changed

- The "stats for nerds" panel became the side panel of the new layout; the Overview tab is now **Stats**, and the SCTE-35 Monitor sub-view is now **Alerts**.
- TI UPIDs are shown as a number and MPU UPIDs with their format identifier.

### Fixed

- False **Silence** and **Frozen picture** alarms on test cards with a beep each second and a ticking clock (e.g. the DASH-IF livesim2 `testpic` streams): a short break in the condition now starts the hold time again, and a picture with any area clearly changing isn't frozen.
- The dashboard's channel meters show the highest level of the last 1.5 s, so short sounds (beeps, speech) no longer leave them looking empty.
- On live streams that count time from 1970 (e.g. livesim2), the timeline axis and the alarm log show clock time instead of huge hour counts like `498239:26:00`.
- **Out of phase** is judged only when there is real audio (above −40 dBFS): the correlation of near-silence between beeps no longer counts, and quiet gaps no longer stop the alarm from raising on out-of-phase audio.
- The active item in the Monitor navigation rail no longer crowds its label.
- Tooltips no longer blink while the dashboard refreshes, and tab names show their explanation instead of repeating the name.
- License request headers set by the DRM module (PlayReady's `SOAPAction`) now pass through the CORS proxy.

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
