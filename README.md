# Simple ABR Player

A web player for **clear (unencrypted) MPEG-DASH and HLS streams**, built for stream engineers. It plays any DASH or HLS URL and adds a **"stats for nerds"** panel showing stream properties, live network and buffer behaviour, the raw manifests, device capabilities and **SCTE-35 ad markers**, decoded field by field.

DRM (Widevine, PlayReady, FairPlay) is planned for the next iteration. The groundwork is already in place: there is a DRM capability check, and custom request headers are supported.

![SCTE-35 view during an ad break](docs/screenshots/scte-dash.png)

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Playing HTTPS streams locally (CORS proxy)](#playing-https-streams-locally-cors-proxy)
- [Build and run in production](#build-and-run-in-production)
- [Screenshots](#screenshots)
- [SCTE-35 support](#scte-35-support)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Testing](#testing)
- [The bundled sample stream](#the-bundled-sample-stream)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Features

| Area | What you get |
| --- | --- |
| **Load a stream** | Paste any `.mpd` or `.m3u8` URL, or pick a test stream (bundled offline sample, public VOD, live). Recent URLs are remembered, and a `?url=` link opens the app with that stream loaded. |
| **Player controls** | Play/pause, a seek bar showing what's buffered and where the SCTE markers are, volume and mute, **audio track**, **subtitles**, **quality** (Auto or a fixed rendition), playback speed, picture-in-picture, fullscreen, and a jump-to-live button for live streams. |
| **Stats: Overview** | Format, live or VOD, latency, how far back you can rewind (live), wall-clock playhead, current rendition, codecs, frame rate, SDR or HDR, stream bitrate and estimated bandwidth, buffer, dropped frames, stalls, startup timings. Plus a live graph of bandwidth and buffer. |
| **Stats: Tracks** | Every video rendition, audio track (language, roles, codec, channels, sample rate), subtitle/caption track, thumbnail track and quality option, with the active ones highlighted. |
| **Stats: SCTE-35** | Every ad marker the app finds, with time, source, OUT/IN direction, a decoded summary and duration. Click a marker to see its full decoded contents and CRC check. Also shows whether you're **in an ad break right now** (with countdown), and includes a **manual decoder** for pasted base64 or hex messages. |
| **Stats: Network** | Every manifest, playlist and segment request: status, size, time, throughput, errors, and whether it went through the proxy. |
| **Stats: Manifest** | The raw MPD and every HLS playlist exactly as fetched (refreshes for live streams), with SCTE and ad-related lines highlighted. |
| **Stats: Device** | Codec support (Media Source Extensions plus a 1080p smoothness check), DRM support and security levels (Widevine, PlayReady, FairPlay, ClearKey), HDCP version, HDR display and colour range. |
| **Stats: Log** | Loading steps, quality switches, track changes, stalls and errors. |
| **Light / dark theme** | The header button cycles **System** (follows your OS setting), **Light** and **Dark**. The choice is remembered. The video area stays dark in both themes, as video players normally do. |
| **Resizable layout** | Drag the handle between the player and the stats panel: drag left for a wider stats panel and a smaller player, right for the opposite. The width is remembered. Double-click the handle to reset; with the handle focused, arrow keys also resize it. |
| **Stats overlay** | A compact YouTube-style "stats for nerds" box on top of the video (press `i`). |
| **Export** | Downloads a JSON file with the stats, tracks, SCTE log, network log and event log, useful to attach to a bug report. |
| **CORS proxy** | Built into the local dev and preview servers, so plain HTTPS streams play even when their server doesn't allow browser access (see below). |

---

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) **22.12 or newer** (an `.nvmrc` is included) and npm.

```bash
git clone https://github.com/garghe/simple-abr-player.git
cd simple-abr-player
npm install
npm run dev
```

Open **http://localhost:5173**, paste a DASH or HLS URL and press **Load**. You can also pick a stream from the **Test streams…** menu. The two **Bundled sample** entries work fully offline and contain SCTE-35 markers.

You can also link straight to a stream:

```
http://localhost:5173/?url=https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd
```

### npm scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server on port 5173, with live reload and the CORS proxy. |
| `npm run build` | Checks types, then builds the static site into `dist/`. |
| `npm run preview` | Serves the production build on port 4173, with the CORS proxy. |
| `npm test` | Runs the unit tests (Vitest). |
| `npm run typecheck` | Checks TypeScript types only. |
| `npm run sample` | Regenerates the bundled SCTE-35 sample (needs `ffmpeg`). |
| `npm run screenshots` | Regenerates the README screenshots (needs Playwright's Chromium). |

---

## Playing HTTPS streams locally (CORS proxy)

Browsers only let a web page download a manifest from another site if that site allows it (CORS). Many origin servers and CDNs don't, especially internal or pre-production ones. To make **any plain HTTPS stream** play locally, the dev and preview servers include a small proxy:

```
Browser ──► http://localhost:5173/__proxy/https/cdn.example.com/live/master.m3u8
              │  (Vite server: fetches it, adds the CORS headers)
              ▼
            https://cdn.example.com/live/master.m3u8
```

The original URL structure is kept, so relative segment URLs inside the manifest still work. Absolute URLs (for example, segments on a different CDN) are rerouted through the proxy by the player.

Choose how it's used in **⚙ Settings → CORS proxy**:

| Mode | Behaviour |
| --- | --- |
| **Auto** (default) | Tries the stream directly first. If the manifest request fails (CORS or network error), it retries through the proxy automatically. The Overview tab shows which route was used. |
| **Always** | Every request goes through the proxy. Useful when the manifest allows browser access but the segments don't. |
| **Off** | Always fetches directly from the browser. |

Other details:

- **Corporate networks:** the proxy follows the standard `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` settings. If your company inspects HTTPS traffic, also set `NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem` before `npm run dev`.
- **Custom headers** (⚙ Settings) are added to every request, for example `Authorization: Bearer …` for tokenised origins. They are passed on through the proxy too.
- **Redirects** are followed, and byte-range requests work (needed for single-file DASH streams).
- **Security:** the proxy is for **local use only**. Vite listens only on `localhost` by default. Don't run it with `--host` on a shared network, because anyone who can reach it could use it to fetch URLs from your machine.

> A static deployment (for example GitHub Pages) has **no proxy**, so streams must allow browser access (CORS). A site served over `https://` also can't load `http://` streams (the browser blocks mixed content). In both cases, run the app locally.

---

## Build and run in production

```bash
npm run build      # → dist/
npm run preview    # serves dist/ on http://localhost:4173, with the CORS proxy
```

`dist/` is a fully static site with relative paths (`base: './'`), so you can host it from any web server, bucket or sub-folder: GitHub Pages, S3 + CloudFront, nginx, and so on. Remember the static version has no CORS proxy (see above).

---

## Screenshots

> Captured with `npm run screenshots` in **headless Chromium**. That browser has no H.264/AAC codecs and no DRM, which is why the Device tab shows them as unsupported. In regular Chrome, Edge or Safari they show as supported.

**SCTE-35 tab during an ad break (DASH sample)**: ad-break banner on the video, markers and break regions on the seek bar, the marker list, and the decoded detail of an in-band `time_signal`.
![SCTE-35](docs/screenshots/scte-dash.png)

**Overview with the stats overlay (`i`)**: stream and playback stats, plus the bandwidth and buffer graph.
![Overview](docs/screenshots/overview.png)

**Tracks**: video renditions, audio and subtitle tracks (subtitles shown on the video).
![Tracks](docs/screenshots/tracks.png)

**Manifest (HLS sample)**: the raw media playlist with `EXT-X-DATERANGE`, `CUE-OUT`, `CUE-OUT-CONT` and `CUE-IN` highlighted.
![Manifest](docs/screenshots/manifest-hls.png)

**Network**: every request with status, size, time and throughput.
![Network](docs/screenshots/network.png)

**Device**: codec, DRM and display capabilities.
![Device](docs/screenshots/device.png)

**Settings and Log**: CORS proxy mode, custom headers, low-latency mode.
![Settings](docs/screenshots/settings.png)

**Light theme**: the same view with the theme button set to Light.
![Light theme](docs/screenshots/light.png)

**Phone layout**: controls sit under the video; the stats panel stacks below.

<img src="docs/screenshots/mobile.png" alt="Phone layout" width="390">

---

## SCTE-35 support

The app looks for markers in every common way they are carried. Duplicates are removed, because the same marker appears in every audio and video playlist and again on every live refresh.

| Format | Where the marker is carried | How it's detected |
| --- | --- | --- |
| DASH | In the MPD, as an `<EventStream>` (`urn:scte:scte35:2013:xml`, `2014:xml+bin`), with the message in `<Binary>` | The player's timeline events. The message is decoded; XML-only events are summarised. |
| DASH and HLS (fMP4) | Inside the video segments, as `emsg` boxes (`urn:scte:scte35:2013:bin`) | The player's `emsg` events, with every `emsg` box reported. |
| HLS | `#EXT-X-DATERANGE` with `SCTE35-OUT`, `SCTE35-IN` or `SCTE35-CMD` | The app reads every playlist itself. |
| HLS | `#EXT-X-CUE-OUT`, `#EXT-X-CUE-OUT-CONT`, `#EXT-X-CUE-IN` | Same. If you join a live stream mid-break, `CUE-OUT-CONT` is used to work out when the break started. |
| HLS | `#EXT-X-SCTE35:CUE="…"`, `#EXT-OATCLS-SCTE35:…`, `#EXT-X-SPLICEPOINT-SCTE35:…` | Same. |

The decoder (`src/scte/scte35.ts`) recognises every splice command (`splice_null`, `splice_insert`, `time_signal`, `splice_schedule`, `bandwidth_reservation`, `private_command`). It fully decodes `splice_insert` and `time_signal` (the commands used for ad signalling) and these descriptors (`avail`, `DTMF`, `segmentation` with all segmentation types and UPID types, `time`). It also checks the message's CRC. It accepts base64 or hex. Encrypted messages are flagged but not decrypted.

An ad break counts as **active** from an OUT marker (splice_insert with out-of-network set, or a segmentation type that starts an ad or placement opportunity) until its advertised duration runs out or an IN marker arrives.

---

## Architecture

The app is plain TypeScript with no UI framework, built with **Vite**. Playback uses **[Shaka Player](https://github.com/shaka-project/shaka-player)**: one engine for both DASH and HLS, and one that already supports Widevine, PlayReady and FairPlay for the DRM iteration.

```mermaid
flowchart LR
  subgraph Browser
    UI["UI<br/>main.ts · controls · seek bar<br/>stats panel (7 tabs) · overlay"]
    PC["PlayerController<br/>player/controller.ts"]
    SM["ScteMonitor<br/>scte/monitor.ts"]
    DEC["SCTE-35 decoder<br/>scte/scte35.ts"]
    HLS["HLS cue parser<br/>scte/hls-cues.ts"]
    SHAKA["Shaka Player<br/>(MSE playback, ABR, text)"]
    VIDEO[("video element")]
  end
  subgraph "Vite dev / preview server (Node)"
    PROXY["CORS proxy<br/>server/proxy-plugin.ts"]
  end
  CDN[("Origin / CDN")]

  UI <-- "events: tick, tracks, scte,<br/>network, documents, log" --> PC
  PC --> SHAKA --> VIDEO
  SHAKA -- "request filter<br/>(headers, proxy rewrite)" --> CDN
  SHAKA -- "proxied requests" --> PROXY --> CDN
  SHAKA -- "response filter<br/>(network log, manifest capture)" --> PC
  SHAKA -- "timelineregionadded · emsg" --> PC
  PC -- "playlist text" --> HLS --> SM
  PC -- "regions · emsg" --> SM
  SM --> DEC
```

### Main parts

| Module | Responsibility |
| --- | --- |
| `src/player/controller.ts` | **The only code that talks to Shaka Player.** Loads streams (including the automatic retry through the proxy), applies custom headers and proxy rewriting to every request, keeps the network log and fetched manifests, collects SCTE events, converts HLS marker times to player times, samples the stats every second, and keeps the event log. Notifies the UI through simple events (`tick`, `tracks`, `scte`, `network`, `documents`, `log`, `loaded`, `error`). |
| `src/player/proxy.ts` | Converts URLs to and from their proxied form, and checks whether the proxy is available. |
| `server/proxy-plugin.ts` | Adds the CORS proxy to the Vite dev and preview servers. Passes ranges, headers and redirects through, and follows the HTTPS proxy settings. |
| `src/scte/scte35.ts` | SCTE-35 decoder, CRC check, summaries, and out/in and duration helpers. No dependencies; unit-tested against published sample messages. |
| `src/scte/hls-cues.ts` | Finds ad-marker tags in HLS playlists and links each one to its segment, timestamp and position. |
| `src/scte/monitor.ts` | Merges markers from all sources, removes duplicates, fills in timings that arrive later, and works out whether an ad break is active. |
| `src/ui/controls.ts`, `seekbar.ts` | Control bar, track selectors, keyboard shortcuts, and the seek bar with buffered regions and SCTE markers and breaks. |
| `src/ui/stats/*` | One file per tab. Only the visible tab updates (at most once per animation frame). |
| `src/ui/splitter.ts` | Drag handle that resizes the stats panel against the player (mouse, touch, keyboard), remembered in browser storage. |
| `src/ui/theme.ts` | System / Light / Dark toggle. Colours are CSS custom properties switched by `data-theme` on `<html>` (or the OS setting in System mode); a small inline script in `index.html` applies the saved theme before the page first appears. |
| `src/ui/chart.ts` | Small canvas line chart for bandwidth and buffer. |
| `src/settings.ts`, `src/presets.ts` | Saved settings and URL history (in browser storage, with safe fallbacks), and the list of test streams. |

### How an HLS SCTE marker reaches the UI

```mermaid
sequenceDiagram
  participant S as Shaka Player
  participant C as PlayerController
  participant H as hls-cues
  participant M as ScteMonitor
  participant U as UI (seek bar, SCTE tab, banner)
  S->>C: response filter (media playlist text)
  C->>C: store text for the Manifest tab
  C->>H: parseHlsCues(text, uri)
  H-->>C: cues (tag, segment, timestamp, position)
  C->>M: addHlsCues(cues)
  M->>M: remove duplicates, decode SCTE-35, convert to player time
  M-->>C: change
  C-->>U: 'scte' event → re-render markers, list, ad banner
```

### Design choices

- **Shaka Player rather than hls.js + dash.js:** one engine and one set of track and stats APIs for both formats, and its DRM support carries over directly to the next iteration.
- **The app reads HLS playlists itself:** Shaka only reports `EXT-X-DATERANGE`, and only when the playlist has `PROGRAM-DATE-TIME`. Reading the playlist text catches every tag style, and costs nothing extra because it reuses the responses Shaka already downloaded.
- **Proxy that keeps the URL path:** relative URLs in the manifest keep working without rewriting the manifest, and the same approach works for every request type.
- **No UI framework:** keeps the app small and quick to load. Each part is a plain class with a `render()` method.

---

## Project structure

```
├── index.html                 Page layout (header, settings, player, stats panel)
├── vite.config.ts             Vite + CORS proxy plugin + Vitest config
├── server/
│   └── proxy-plugin.ts        Local CORS proxy (dev + preview)
├── src/
│   ├── main.ts                Connects everything: load, settings, overlay, export, share
│   ├── player/                PlayerController (Shaka wrapper), proxy URL helpers
│   ├── scte/                  SCTE-35 decoder, HLS cue parser, marker monitor
│   ├── ui/                    Controls, seek bar, chart, helpers
│   │   └── stats/             Overview, Tracks, SCTE-35, Network, Manifest, Device, Log tabs
│   ├── presets.ts             Test stream list
│   ├── settings.ts            Saved settings / history
│   └── styles.css
├── public/samples/scte-demo/  Bundled offline DASH + HLS sample with SCTE-35
├── scripts/
│   ├── make-sample.mjs        Builds the sample with ffmpeg + adds SCTE-35 markers
│   ├── screenshots.mjs        Regenerates docs/screenshots with Playwright
│   └── lib/scte35-encode.mjs  Minimal SCTE-35 encoder (sample + tests)
├── test/                      Vitest unit tests
└── docs/screenshots/          README images
```

---

## Testing

```bash
npm test           # unit tests
npm run typecheck  # TypeScript only
```

The unit tests cover:

- **SCTE-35 decoding** against published sample messages (`time_signal` with a Placement Opportunity Start; `splice_insert` with a break duration and avail descriptor), round trips with the encoder, CRC checks, and invalid input.
- **HLS tag parsing**: attribute lists, DATERANGE, CUE-OUT/CONT/IN and OATCLS, segment and timestamp linking, VOD vs live.
- **Marker monitor**: duplicate removal across playlists and refreshes, active-break detection, and joining a live stream mid-break.
- **Proxy URL conversion**: round trips, relative URLs, and how the server reads the target URL.

For end-to-end checks, `npm run screenshots` drives the real app in Chromium against both bundled samples. It's a quick smoke test for DASH, HLS, SCTE detection and the UI.

---

## The bundled sample stream

`public/samples/scte-demo/` contains a 40-second sample that works offline, made by `npm run sample` (needs `ffmpeg` with VP9 and Opus support):

- VP9 video at 240p and 480p, two Opus audio tracks (English and Italian), English and Italian WebVTT subtitles.
- The same segments are used by `dash.mpd` and by the HLS `master.m3u8`.
- SCTE-35 markers:
  - **6 s → 14 s:** `splice_insert` OUT (8 s) and IN, in a DASH `<EventStream>` / HLS `EXT-X-DATERANGE SCTE35-OUT` + `CUE-OUT` / `CUE-OUT-CONT` / `CUE-IN`.
  - **20 s → 26 s:** `time_signal` with a segmentation descriptor (Provider Placement Opportunity Start/End, Ad-ID UPID), as **in-band `emsg`** boxes in the video segments (both DASH and HLS).

VP9/Opus is used so the sample also plays in open-source Chromium, which is used for the automated screenshots.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `k` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s |
| `↑` / `↓` | Volume up / down |
| `m` | Mute |
| `c` | Cycle subtitles |
| `f` | Fullscreen |
| `i` | Stats overlay on the video |
| `l` | Jump to live edge |

---

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Shaka error 1002 HTTP_ERROR` | Usually CORS or a network failure. With `npm run dev`, set the proxy to **Auto** or **Always**. Check the **Network** tab for the failing URL and status. |
| `4032 CONTENT_UNSUPPORTED_BY_BROWSER` | The browser can't decode those codecs (for example HEVC in Firefox, or H.264 in headless Chromium). The **Device** tab shows what this device supports. |
| `6001` / `6007` (DRM) | The stream is encrypted. DRM comes in the next iteration. |
| Nothing plays from a deployed `https://` site | The stream is `http://` (blocked as mixed content) or doesn't allow browser access. Run locally with `npm run dev`. |
| Proxy can't reach the origin behind a corporate proxy | Set `HTTPS_PROXY` (and `NODE_EXTRA_CA_CERTS` if your company inspects HTTPS) before `npm run dev`. |
| `npm run screenshots` can't find a browser | Run `npx playwright install chromium`, or set `CHROMIUM_PATH` to a Chrome or Chromium executable. |

---

## Roadmap

- **DRM (next iteration):** license server URLs per key system, license request headers, FairPlay certificate, and DRM session and key status in the stats panel. Builds on Shaka's DRM support and the existing Device tab.
- Thumbnail previews on the seek bar.
- Low-latency stats (part and chunk timing, playback-rate catch-up).
- CMCD / CMSD reporting and inspection.
- A timeline view of SCTE breaks against playback and quality switches.
