<p align="center">
  <img src="public/logo.svg" alt="PlayProbe logo" width="96" height="96">
</p>

<h1 align="center">PlayProbe</h1>

<p align="center"><strong>Play, inspect and monitor streams:</strong> DASH · HLS · DRM · SCTE-35 · <a href="https://playprobe.xyz">playprobe.xyz</a></p>

**PlayProbe** is a web player for **MPEG-DASH and HLS streams**, clear or protected with **Widevine**, **PlayReady** or **FairPlay**, built for stream engineers. It plays any DASH or HLS URL and checks it as it goes: stream health and rendition alignment, **SCTE-35 ad markers** decoded field by field, loudness and picture/sound alarms, DRM licence exchanges, network and buffer behaviour, the raw manifests and device capabilities. Two views: **Inspect**, a summary of the stream, and **Monitor**, for watching a live channel.

![Inspect view](docs/screenshots/inspect.png)

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Playing HTTPS streams locally (CORS proxy)](#playing-https-streams-locally-cors-proxy)
- [Build and run in production](#build-and-run-in-production)
- [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers)
- [Inspect and Monitor views](#inspect-and-monitor-views)
- [Screenshots](#screenshots)
- [Stream health and rendition alignment](#stream-health-and-rendition-alignment)
- [Picture and sound alarms](#picture-and-sound-alarms)
- [SCTE-35 support](#scte-35-support)
  - [SCTE-35 tools](#scte-35-tools)
- [Audio levels and loudness](#audio-levels-and-loudness)
- [DRM: Widevine, PlayReady and FairPlay](#drm-widevine-playready-and-fairplay)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Testing](#testing)
- [The bundled sample stream](#the-bundled-sample-stream)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Versions and releases](#versions-and-releases)
- [License](#license)

---

## Features

| Area | What you get |
| --- | --- |
| **Load a stream** | Paste any `.mpd` or `.m3u8` URL, or pick a test stream (bundled offline sample, public VOD, live). Recent URLs are remembered, and a `?url=` link opens the app with that stream loaded. |
| **Player controls** | Play/pause, a seek bar showing what's buffered and where the SCTE markers are, volume and mute, **audio track**, **subtitles**, **quality** (Auto or a fixed rendition), playback speed, picture-in-picture, fullscreen, and a jump-to-live button for live streams. |
| **Inspect and Monitor views** | **Inspect** (default for VOD): the player with summary cards (format, video, audio, DRM, SCTE-35), throughput, a **health score**, loudness, channels, the next ad break and the **bitrate ladder**. **Monitor** (default for live): a navigation rail, the player with the **timeline** under it, and health, playback, loudness and a live **events feed**. Switch with **Inspect \| Monitor**; see [the views](#inspect-and-monitor-views). |
| **Stats** | Format, live or VOD, latency, how far back you can rewind (live), wall-clock playhead, current rendition, codecs, frame rate, SDR or HDR, stream bitrate and estimated bandwidth, buffer, dropped frames, stalls, startup timings. Plus a live graph of bandwidth and buffer. |
| **Stats: Tracks** | Every video rendition, audio track (language, roles, codec, channels, sample rate), subtitle/caption track, thumbnail track and quality option, with the active ones highlighted. |
| **Audio meters** | Per-channel level meters on the video (stereo or 5.1), with short-term loudness. On by default; toggle with the **Meters** button or `a`. |
| **Stats: Audio** | Large per-channel peak meters with peak hold, loudness to **EBU R128** (−23 LUFS) or **ATSC A/85** (−24 LKFS) — momentary, short-term, integrated, true peak, loudness range — and L/R phase correlation. Also compares the channels the manifest declares with the channels actually decoded. |
| **Stats: SCTE-35** | Every ad marker the app finds, with time, source, OUT/IN direction, a decoded summary and duration. Click a marker to see its full decoded contents, CRC check and **splice timing** (lead time, segment alignment, `splice_time`). Also shows whether you're **in an ad break right now** (with countdown), and includes a **manual decoder** for pasted base64 or hex messages. |
| **SCTE-35 tools** | **Health** checks that list what's wrong with the signalling (unpaired OUT/IN and segmentation signals, wrong durations, CRC errors, markers missing from some playlists, short lead times, splices off segment boundaries). A **Timeline** with one lane per signal type plus quality switches and stalls, the **Structure** (programme → chapter → break → ad), **Ad insertion** (server-side inserted ads and HLS Interstitials matched with their breaks, with underfill/overfill), **Alerts** (sound or browser notification on new markers, counts per hour, CSV export), a message **Builder**, and break navigation (`n` / `p` / `b` / `s`). See [SCTE-35 tools](#scte-35-tools). |
| **Stats: Network** | Every manifest, playlist and segment request: status, size, time, throughput, errors, and whether it went through the proxy. |
| **Stats: Manifest** | The raw MPD and every HLS playlist exactly as fetched (refreshes for live streams), with SCTE and ad-related lines highlighted. |
| **DRM** | **Widevine** (Chrome, Edge, Firefox, Android), **PlayReady** (Edge on Windows, Smart TVs, Xbox) and **FairPlay** (Safari). Works with any license server: license URL, request headers and, if needed, generic request/response formats, with no provider-specific settings. Saved profiles. License requests can go through the CORS proxy. |
| **Stats: DRM** | DRM system and security level in use (Widevine L1/L3, PlayReady SL3000/SL2000), protection declared by the stream (systems, key IDs, decoded PSSH and PlayReady headers, HLS key tags, license URLs in the stream with a *Use this* button), live key status per key ID, and every license and certificate request with timing and the raw request and response. |
| **Stats: Device** | Codec support (Media Source Extensions plus a 1080p smoothness check), DRM support and security levels (Widevine, PlayReady, FairPlay, ClearKey), HDCP version, HDR display and colour range. |
| **Stats: Health** | **Stream checks** on the playlists, MPD and every downloaded segment: target duration, sequence numbering between refreshes, PROGRAM-DATE-TIME drift, stale live playlists, timeline gaps, segments without a keyframe at the start, duration and timestamp gaps, real vs declared codecs and bitrate. **Rendition alignment** compares the same segments of every video rendition. See [Stream health](#stream-health-and-rendition-alignment). |
| **Stats: Alarms** | **Picture and sound alarms**: black, frozen picture, silence, a lost channel, loudness off target, true peaks and out-of-phase stereo, with an alarm banner on the video, a log, CSV export, sound or browser notification, and adjustable thresholds. See [Alarms](#picture-and-sound-alarms). |
| **Stats: Log** | Loading steps, quality switches, track changes, stalls and errors. |
| **Light / dark theme** | The header button cycles **System** (follows your OS setting), **Light** and **Dark**. The choice is remembered. The video area stays dark in both themes, as video players normally do. |
| **Resizable layout** | Drag the handle between the player and the side panel: drag left for a wider stats panel and a smaller player, right for the opposite. The width is remembered. Double-click the handle to reset; with the handle focused, arrow keys also resize it. |
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

Open **http://localhost:5173**, paste a DASH or HLS URL and press **Load**. You can also pick a stream from the **Test streams…** menu. The four **Bundled sample** entries work fully offline and contain SCTE-35 markers; the **SCTE-35 health demo** has deliberate signalling errors and an inserted ad pod, and the **Stream health & alarms demo** trips every alarm and several stream checks.

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
| `npm run sample:alarms` | Regenerates the stream health & alarms demo (needs `ffmpeg`). |
| `npm run sample:issues` | Regenerates the SCTE-35 health demo from the bundled sample (no `ffmpeg` needed). |
| `npm run test:e2e:health` | Checks stream health, rendition alignment and the alarms end to end in headless Chromium. Add `-- --shots` to refresh their screenshots. |
| `npm run test:e2e:scte` | Checks the SCTE-35 tools end to end in headless Chromium on the bundled samples. Add `-- --shots` to refresh the SCTE screenshots. |
| `npm run test:e2e:drm` | Runs the DRM pipeline end to end in headless Chromium with ClearKey and a local test license server. Add `-- --shots` to refresh the DRM screenshots. |
| `npm run deploy` | Builds and deploys to Cloudflare Workers (after `npx wrangler login`). |
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

> A plain static deployment (for example GitHub Pages) has **no proxy**, so streams must allow browser access (CORS). The [Cloudflare Workers deployment](#deploy-to-cloudflare-workers) can run the same proxy online if you switch it on. A site served over `https://` also can't load `http://` streams (the browser blocks mixed content), unless they go through the proxy.

---

## Build and run in production

```bash
npm run build      # → dist/
npm run preview    # serves dist/ on http://localhost:4173, with the CORS proxy
```

`dist/` is a fully static site with relative paths (`base: './'`), so you can host it from any web server, bucket or sub-folder: GitHub Pages, S3 + CloudFront, nginx, and so on. A plain static host has no CORS proxy (see above). For a hosted version *with* the proxy, use Cloudflare Workers (next section).

---

## Deploy to Cloudflare Workers

The repo is ready for [Cloudflare Workers](https://developers.cloudflare.com/workers/). Workers serves the built site (`dist/`) as static files, and a small Worker script (`worker/index.ts`) can also run the CORS proxy online. Configuration lives in [`wrangler.jsonc`](wrangler.jsonc).

### Option A: connect the GitHub repo (recommended)

In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, choose **garghe/simple-abr-player** and fill in the form:

| Field | Value |
| --- | --- |
| Repository | `garghe/simple-abr-player` |
| Project name | `simple-abr-player` (must match `"name"` in `wrangler.jsonc`; the Worker keeps the repository's name, while the app itself is called PlayProbe) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` |
| Enable Preview builds | **On**: each non-production branch or pull request gets its own preview URL |
| Protect with Cloudflare Access | **Off** for a public player. Turn it **on** if you enable the proxy without a host allowlist (see below). |

Under **Advanced settings → Build variables**, nothing is required. The build uses Node 22 from `.nvmrc`. If your build image ignores `.nvmrc`, add `NODE_VERSION` = `22`.

**Production branch:** Cloudflare deploys the repository's default branch, currently `claude/brave-brown-gye24p` (the only branch). After you merge into `main`, change it in **Settings → Build → Branch control**.

Press **Deploy**. The app will be available at `https://simple-abr-player.<your-subdomain>.workers.dev`. Every push to the production branch redeploys it automatically.

### Option B: deploy from your computer

```bash
npx wrangler login     # once, opens the browser
npm run deploy         # = npm run build && wrangler deploy
```

### Turning on the CORS proxy online (optional)

The proxy is **off by default** on Cloudflare: a public, open proxy could be used by anyone to fetch anything through your account. With it off, the app works but streams must allow browser access (CORS). The app detects this and does not offer the proxy.

To turn it on, set these variables in **Worker → Settings → Variables and Secrets** (or in `wrangler.jsonc` under `"vars"`), then redeploy:

| Variable | Value | Meaning |
| --- | --- | --- |
| `PROXY_ENABLED` | `true` | Turns `/__proxy/…` on. |
| `PROXY_ALLOWED_HOSTS` | e.g. `*.akamaized.net,cdn.example.com` | Comma-separated origin hosts the proxy may fetch (`*.` matches subdomains). **Strongly recommended.** Other hosts get `403`. Empty means any host, so only leave it empty with **Protect with Cloudflare Access** turned on, so that only people you allow can use the site. |
| | | License requests (POST) are allowed through the proxy, up to 256 KB per request, for the DRM option *Send license requests through the CORS proxy*. They also need their host in this list. |
| `PROXY_SEGMENTS` | `false` (default) | **Segment guardrail.** Only manifests and playlists go through the Worker; video, audio, subtitle and init segments are always fetched directly by the browser. Set `true` only if the segment CDN itself blocks CORS (then every segment costs one Worker request). |

> **Note:** variables set in the dashboard are overwritten by the values in `wrangler.jsonc` on the next deploy from Git. To keep dashboard values, either edit `wrangler.jsonc` in the repo (recommended), or remove the `"vars"` block.

Things to know when the proxy is on:

- **Request usage is kept low by the segment guardrail.** Each proxied request counts towards your [Workers request limits](https://developers.cloudflare.com/workers/platform/limits/) (free plan: 100,000 per day). With `PROXY_SEGMENTS=false` the proxy only carries manifests and playlists:
  - **VOD:** a handful of requests per stream (the manifest and, for HLS, its playlists).
  - **Live DASH:** one request per manifest refresh.
  - **Live HLS:** one request per playlist refresh, about one per segment duration for each active playlist (video + audio). That's roughly 1,200–3,600 per hour, so live HLS through the proxy is the case that still uses requests.
- How the guardrail works, in two layers:
  1. **In the player:** `/__proxy/health` reports `"segments": false`, so the player routes only manifests and playlists through the proxy. Segments, including ones whose relative URLs point into the proxy, are sent directly to the CDN.
  2. **In the Worker:** if a segment request arrives anyway, it's refused with `403` before anything is fetched (checked by file extension, then by response `Content-Type`).
- **When it bites:** if the segment CDN also blocks CORS, the segments fail and the **Log** tab explains it, naming the host. Fix it with CORS on that CDN (best), `npm run dev` locally, or `PROXY_SEGMENTS=true`.
- Keep the app on **Auto** mode, which only uses the proxy when a direct request fails. Streams that already allow browser access then use no Worker requests at all.
- The local `npm run dev` proxy has no such limits and proxies segments too.
- The Worker fetches from Cloudflare's network, not your office network, so origins that are only reachable internally (VPN or private IPs) still need the local `npm run dev` proxy.

### Checking a deployment

| URL | Expected |
| --- | --- |
| `https://<your-worker>/` | The player |
| `https://<your-worker>/samples/scte-demo/dash.mpd` | The bundled sample MPD |
| `https://<your-worker>/__proxy/health` | `{"status":"ok","kind":"cloudflare","segments":false}` when the proxy is on; `404 disabled` when off |
| `https://<your-worker>/__proxy/https/<host>/<path>/seg.m4s` | `403` while `PROXY_SEGMENTS` is `false` (guardrail working) |

To try the Worker locally with the same runtime Cloudflare uses: `npm run build && npx wrangler dev`. Add `--var PROXY_ENABLED:true` to test the proxy.

---

## Inspect and Monitor views

The header holds the logo with the version, the navigation, **Copy link**, **Export** and the theme; under it, the load bar: format chip, URL, test streams, DRM, proxy settings, **Probe stream** and the **Inspect | Monitor** switch.

| | Inspect | Monitor |
| --- | --- | --- |
| **For** | Checking a stream: a new channel, a delivery, a support ticket, a report | Watching a live channel, e.g. in an operations room |
| **Default** | VOD streams | Live streams |
| **Navigation** | Pills in the header | A rail on the left (icons + labels) |
| **Under the player** | Summary cards (click one for its tab) and throughput & buffer | The timeline: breaks, programme and ad segmentation, inserted ads, quality, health issues, stalls and alarms |
| **Dashboard** | Health score, loudness, channels, next ad break with a programme/break strip, bitrate ladder (declared and measured) | Health score, playback, loudness against the target, events feed (SCTE-35 markers, alarms, quality switches, warnings) |

- **Health score:** 100 minus points for problems in each area: stream & segments, rendition alignment, SCTE-35 signalling, picture & sound (active alarms weigh most) and DRM. Errors cost 10, warnings 4, capped per area. Each line opens its tab.
- **Choosing the view:** live streams open in Monitor, VOD in Inspect. Switching while a stream plays remembers the choice for that kind of stream (e.g. always Inspect for live). **Copy link** includes the view (`&view=monitor`), so a shared link opens the same way.
- **Detail tabs:** Stats, Tracks, Audio, DRM, SCTE-35, Health, Alarms, Network, Manifest, Device and Log replace the dashboard in the side panel; the player keeps playing. Both views work in the light and dark themes and on phones (everything stacks in one column).

**Monitor view (stream health & alarms demo, light theme)**
![Monitor view](docs/screenshots/monitor.png)

---

## Screenshots

> Captured with `npm run screenshots` in **headless Chromium**. That browser has no H.264/AAC codecs and no DRM, which is why the Device tab shows them as unsupported. In regular Chrome, Edge or Safari they show as supported.

**SCTE-35 tab during an ad break (DASH sample)**: ad-break banner on the video, markers and break regions on the seek bar, the marker list, and the decoded detail of an in-band `time_signal`.
![SCTE-35](docs/screenshots/scte-dash.png)

**Health: stream checks (alarms demo sample)**: segments longer than the target duration, a bitrate above the declared BANDWIDTH and a wrong codec string, with the playlists and renditions read.
![Stream health](docs/screenshots/health-stream.png)

**Health: rendition alignment**: 180p has 3 s segments and 360p 2 s, so boundaries and timestamps don't line up.
![Rendition alignment](docs/screenshots/health-alignment.png)

**Alarms**: every alarm the demo stream trips, with durations and details.
![Alarms](docs/screenshots/alarms.png)

**SCTE-35 Health (health demo sample)**: the problems planted in the demo stream, grouped by check, each linking to its marker.
![SCTE-35 health](docs/screenshots/scte-health.png)

**SCTE-35 Timeline**: OUT/IN breaks, placement opportunity and ad segmentation, the inserted ad pod, health issues and quality on one time axis.
![SCTE-35 timeline](docs/screenshots/scte-timeline.png)

**SCTE-35 Structure**: signals nested by time, with decoded UPIDs.
![SCTE-35 structure](docs/screenshots/scte-structure.png)

**Ad insertion**: an inserted pod matched with its break, 2 s short of the break length.
![Ad insertion](docs/screenshots/scte-ads.png)

**SCTE-35 Builder**: a placement opportunity start from a preset, as base64, hex, HLS tags and a DASH EventStream.
![SCTE-35 builder](docs/screenshots/scte-builder.png)

**Audio tab with the 5.1 track**: six channel meters on the video and in the tab, EBU R128 loudness, and decoded-channel information.
![Audio](docs/screenshots/audio.png)

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

**DRM settings**: Widevine filled in by the Widevine test-stream preset; PlayReady and FairPlay are inactive because the mode is set to Widevine.
![DRM settings](docs/screenshots/drm-settings.png)

**PlayReady**: the PlayReady settings filled in from the stream. The DRM tab decoded the stream's PlayReady header (key ID, version, license URL); *Use this* copied its license URL into the settings.
![PlayReady](docs/screenshots/drm-playready.png)

**DRM tab**: encrypted playback with key system, scheme, declared protection, key status and a license request (here the ClearKey end-to-end test, with a JSON-wrapped request sent through the proxy).
![DRM tab](docs/screenshots/drm-tab.png)

**Settings and Log**: CORS proxy mode, custom headers, low-latency mode.
![Settings](docs/screenshots/settings.png)

**Light theme**: the Inspect dashboard with the theme button set to Light.
![Light theme](docs/screenshots/light.png)

**Phone layout**: navigation scrolls in the header, controls sit under the video, the summary cards and dashboard stack below.

<img src="docs/screenshots/mobile.png" alt="Phone layout" width="390">

---

## Stream health and rendition alignment

The **Health** tab checks the stream itself while it plays. PlayProbe reads every playlist or MPD refresh and every segment the player downloads (fMP4/CMAF and MPEG-2 TS), without decoding: the real codec string from the init segment, the decode time, duration and keyframe of each segment.

| Check | Severity |
| --- | --- |
| **Segment longer than `EXT-X-TARGETDURATION`** (rounded), or than the MPD's `@maxSegmentDuration` | error; warning |
| **`EXT-X-TARGETDURATION` changed**, **media sequence went backwards**, a **segment changed its sequence number**, or the **discontinuity sequence** doesn't match the discontinuities that left the window | error |
| **Segments skipped between refreshes** (the playlist moved past segments this player never saw) | warning |
| **PROGRAM-DATE-TIME** drifting from the segment durations, or changing between refreshes | warning |
| **Live playlist / MPD not updating** for 3× the target / segment duration (error at 6×) | warning |
| **Gap or overlap** in a SegmentTimeline or between periods | warning |
| **Segment does not start with a keyframe** | error |
| Segment **duration** in the media differs from the manifest; **gap or overlap** between the media timestamps of neighbouring segments | warning |
| **Codec string** in the manifest differs from the init segment (e.g. wrong profile or level), or isn't declared | warning |
| **Bitrate** above the declared HLS `BANDWIDTH` (peak, video alone) or DASH `@bandwidth` (average) | warning |

The tab also lists the media playlists (target duration, window, refreshes, last change), the MPD timelines, and each rendition played with declared vs real codec, declared vs measured bitrate and how many segments started with a keyframe.

**Rendition alignment** fetches the same segments (1, 3 or 5) of every video rendition (up to 10) from the playhead, through the player's own segment index, so HLS and DASH, templates and byte ranges all work. It compares segment boundaries in the manifest, timestamps and durations in the media, and keyframes, and shows them side by side. Seamless quality switching needs all of them to match. It fetches extra data, so it runs only when you press the button.

---

## Picture and sound alarms

The **Alarms** tab watches what the viewer gets, for leaving a channel running in an operations room. An alarm raises when its condition has lasted for the hold time (measured in content time, so it means the same at any playback speed) and clears after the condition has been gone for a second. Active alarms show as a red banner on the video and on the SCTE-35 timeline.

| Alarm | Default threshold | Hold |
| --- | --- | --- |
| **Black picture** | average luma below 6 % | 2 s |
| **Frozen picture** | average change between frames below 0.2 % while the playhead moves | 5 s |
| **Silence** | every channel below −60 dBFS | 5 s |
| **Channel lost** | one channel (not LFE) below −60 dBFS while the others carry audio | 10 s |
| **Loudness off target** | short-term loudness more than 6 LU from the target (EBU R128 −23 LUFS or ATSC A/85 −24 LKFS, from the Audio tab) | 20 s |
| **True peak over limit** | above −1 dBTP (EBU) or −2 dBTP (ATSC) | instant |
| **Out of phase** | L/R correlation below −0.3 | 5 s |

Thresholds, hold times and which alarms are on are in **Alerts and thresholds**, with a sound and/or a browser notification when an alarm raises. The log keeps every alarm with start, duration and detail; **Export CSV** downloads it.

- **Picture** alarms sample the video four times a second into a small canvas. Browsers don't let pages read DRM-protected video (or cross-origin video played without CORS), so picture alarms are unavailable there and the tab says why.
- **Sound** alarms use the same measurements as the audio meters.

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

### SCTE-35 tools

The SCTE-35 tab has a break status line, navigation buttons, and these views:

| View | What it does |
| --- | --- |
| **Markers** | The marker list. A **Checks** column flags markers with issues; the detail adds **Splice timing** and the checks for that marker. |
| **Health** | Every issue found so far, grouped by check, with a severity (error, warning, note). Click a time to open the marker. |
| **Timeline** | Lanes for OUT → IN breaks and each segmentation family (programme, chapter, break, advertisement, placement opportunity, promo/credits), inserted ads, health issues, quality switches, stalls and errors. Zoom: all, 10 min, 2 min, 30 s around the playhead. Click to seek. |
| **Structure** | Segmentation signals nested by time: programme → chapter → break → placement opportunity → advertisement, with UPIDs decoded (Ad-ID, ADI, EIDR, TI as a number, MPU format identifier, UUID, URI, MID). |
| **Ad insertion** | Inserted ad pods and HLS Interstitials, each matched with the SCTE OUT that started its break, with the break length and how well the pod fills it. |
| **Alerts** | For leaving a live channel running: a sound and/or a browser notification for each new marker (optionally OUT/IN only), marker counts per hour, and **Export CSV** (one row per marker with timing and issues). |
| **Builder** | Compose `splice_insert`, `time_signal` or `splice_null` with segmentation descriptors (type, duration, UPID, segment numbers, delivery restrictions), from scratch or from a preset, and copy it as base64, hex, HLS tags (`EXT-X-DATERANGE`, `CUE-OUT`/`CUE-IN`, `EXT-OATCLS-SCTE35`, `EXT-X-SCTE35`) or a DASH `EventStream`. The output is decoded back to check it. |

**Navigation:** `n` / `p` jump to the next / previous marker, `b` to a few seconds before the next break (3–30 s, chosen next to the buttons), `s` skips the current break. The ad-break banner on the video also has a **Skip** button.

#### Health checks

| Check | Severity |
| --- | --- |
| Message can't be decoded, or its **CRC** doesn't match | error |
| **OUT without an IN** and without a duration (VOD), **IN without an OUT**, or a new break before the previous one ended | warning (a note on a live stream joined mid-break, or a break still open) |
| **Break length differs from the advertised duration** by more than 1 s (early or late IN) | warning |
| Signals of the same break (e.g. `DATERANGE` and `CUE-OUT`) **disagree on its duration** | warning |
| **Segmentation start without an end** (`0x34` without `0x35`, Program Start without End…), **end without a start**, or a start/end pair whose length differs from the segmentation duration | warning (a note when the duration closes it) |
| End signal with a **different event ID**, or a **splice_event_id reused** for a later break | note |
| `segment_num` above `segments_expected` | warning |
| **`CUE-OUT-CONT` elapsed time** doesn't match the time since its `CUE-OUT` | warning |
| `DATERANGE` `END-DATE` and `DURATION` disagree; `DURATION` differs from `PLANNED-DURATION` | warning; note |
| **Marker missing from a playlist** that covers its time (checked for every playlist the player has read) | warning for video, note for audio-only |
| **Late marker** (arrived after its splice time) or **short lead time** (below the threshold you set, 4 s by default) — live streams | error; warning |
| **Splice not on a segment boundary** (more than one frame off), or `DATERANGE` starting mid-segment | warning |
| A marker whose **`splice_time` doesn't match** where it sits, compared with the stream's other markers | warning |
| **Ad pod shorter or longer than its break** (underfill / overfill, more than 1 s) | warning |
| Inserted content without a marker; a break with no inserted content (in a stream that uses insertion) | note |
| Cancelled events, encrypted messages | note |

#### Splice timing

- **Lead time** (live streams): how early the marker was seen before its splice point. DASH `EventStream` and HLS `DATERANGE` markers are compared with the live edge when they first appeared; in-band `emsg` markers with the end of the media buffered at that moment (they arrive inside a segment). HLS tags that sit on the splice segment (`CUE-OUT`, `OATCLS`…) arrive with that segment by design, so they get no lead time.
- **Segment alignment:** where the splice falls inside the video segment that contains it. Segment-based players and server-side insertion can only switch at segment starts, so a mid-segment splice lands early or late.
- **`splice_time`:** the PTS in the message (with `pts_adjustment`). The PTS clock and the player timeline differ by a constant per stream, so a marker whose offset differs from the others is mis-timed.

#### Ad insertion detection

Inserted ads come from somewhere else than the programme. In **HLS**, PlayProbe splits one video playlist into runs at each `EXT-X-DISCONTINUITY`; a run that starts with a discontinuity and comes from another host or folder than the main content (the origin with the most playing time) is inserted content. Back-to-back runs form one **pod**. In **DASH**, each period's origin (from `BaseURL` and the segment template) is compared the same way. **HLS Interstitials** (`EXT-X-DATERANGE CLASS="com.apple.hls.interstitial"`) are listed from their `X-ASSET-URI` / `X-ASSET-LIST`. Each pod is matched with an SCTE OUT within 2 s, and its length compared with the break.

---

## Audio levels and loudness

The meters measure the audio **as it is in the stream**, not what your speakers play. Muting or turning the volume down doesn't change them, and a 5.1 track shows six channels even on stereo speakers.

### Where the measurements come from

| Source | Used when | What it measures |
| --- | --- | --- |
| **Audio segments, decoded with WebCodecs** (preferred) | fMP4 / CMAF audio the browser's WebCodecs decoder supports: Opus and AAC everywhere WebCodecs exists; FLAC; Dolby only where WebCodecs can decode it | Every encoded channel. Readings are released in step with the playhead. Starts by itself, with no click needed. |
| **Browser audio output, via Web Audio** (fallback) | Other formats, such as MPEG-2 TS, WebM or packed audio | What the browser decoded. **Chrome mixes multichannel down to your output device first**, so on stereo speakers a 5.1 track shows 2 channels; the Audio tab flags this. Browsers only allow it after a click, so the overlay shows *Click to start audio meters* until then. |

The **Audio tab** shows which source is in use (*Measured from*), and whether the decoded channel count matches the manifest.

### Browser support

| Audio | Stereo meters | 5.1 meters |
| --- | --- | --- |
| AAC or Opus, fMP4/CMAF | ✅ browsers with WebCodecs audio decoding (Chrome, Edge, Firefox; recent Safari). Others use the Web Audio fallback. | ✅ |
| AAC in MPEG-2 TS (HLS) | ✅ (Web Audio fallback, after a click) | ⚠️ only if your output device is 5.1, otherwise downmixed |
| Dolby Digital / Digital Plus (AC-3, E-AC-3) | Only where the browser plays Dolby at all (Safari; Edge on Windows) | Same, if the browser hands over all channels |
| Dolby Atmos (E-AC-3 JOC) | as above | 5.1 bed only; height objects can't be metered |

Chrome and Firefox can't decode Dolby at all, so those streams don't play there. The Audio tab says so, including when a stream has Dolby tracks the browser had to hide.

### What is measured

- **Levels:** sample peak per channel in dBFS (−60 to 0), with a 2-second peak hold. Green below −18, yellow to −6, red above; a red outline means the hold reached 0 dBFS. Channel order is L R (stereo) or L R C LFE Ls Rs (5.1).
- **Loudness** (ITU-R BS.1770-4: K-weighting, surrounds +1.5 dB, LFE excluded):
  - **Momentary** (400 ms), **short-term** (3 s)
  - **Integrated:** gated at −70 LUFS absolute and −10 LU relative, measured since the stream or audio track was loaded. **Reset** restarts it.
  - **Loudness range (LRA):** EBU Tech 3342
  - **True peak:** 4× oversampled, maximum since reset
- **L/R correlation:** +1 = mono-compatible, about 0 = wide or unrelated, below −0.2 = phase problem (cancels when mixed to mono).
- **Standard switch:** **EBU R128** (target −23 LUFS ±1, true peak ≤ −1 dBTP) or **ATSC A/85** (−24 LKFS ±2, ≤ −2 dBTP). The integrated and true-peak tiles turn green or amber/red against the selected target. The choice is remembered.

The measurement code is checked against the EBU reference signals (Tech 3341 and 3342) in the unit tests.

---

## DRM: Widevine, PlayReady and FairPlay

Open the **DRM** panel from the header (the lock button). The button shows the active mode.

| | Widevine | PlayReady | FairPlay |
| --- | --- | --- | --- |
| Browsers | Chrome, Edge, Firefox, Android | Edge on Windows; Chrome and Firefox on Windows with hardware PlayReady; Smart TVs, Xbox | Safari on macOS, iOS and iPadOS |
| Streams | DASH, and HLS with fMP4 segments (`cenc` or `cbcs`) | DASH, and HLS with fMP4 segments (`cenc`, or `cbcs` with PlayReady 4) | HLS (`cbcs`, `skd://` keys) |
| You need | License URL | License URL, or nothing if the stream carries one | License URL and the **FairPlay certificate** (URL or file) |

**Mode:** *Off*, *Auto* (configure several; the browser uses whichever it supports, so one setting works in Chrome, Edge and Safari; on Edge, PlayReady wins over Widevine when both are set), *Widevine*, *PlayReady* or *FairPlay*.

Chrome, Firefox and Safari on macOS or Linux have no PlayReady. If the chosen DRM doesn't exist in the browser, the error says so; the **Device** tab lists what's available.

### Settings

- **License URL** (with any query string) and **license request headers** (`Name: value` per line, e.g. `Authorization: Bearer …`). The headers are also sent with the FairPlay certificate request.
- **Widevine security level:** *Auto* (best available), *L1 only* (hardware) or *L3 only* (software). The DRM tab shows what was obtained.
- **PlayReady license URL:** leave it empty to use the license URL inside the stream's PlayReady header (`LA_URL`). The DRM tab shows that URL with a **Use this** button, which copies it into the field so you can edit it (for example, to add a token or a `cfg=` query).
- **PlayReady security level:** *Auto* (SL3000, else SL2000), *SL3000 only* (hardware) or *SL2000 only* (software). It applies to Edge and Firefox on Windows; Chrome on Windows only offers SL3000, and TVs and consoles use their own level.
- **PlayReady requests:** Edge wraps the license request in an XML envelope with the HTTP headers the server expects. The player unwraps it and sends the SOAP request with its `Content-Type` and `SOAPAction` headers (also through the CORS proxy), so most servers work with just the URL.
- **FairPlay certificate:** a URL, or upload the file. Binary (`.der`/`.cer`) or base64 both work. An uploaded file overrides the URL.
- **FairPlay content ID** (the "asset ID" many servers want): from the `skd://` key URI (host part, the default, or the whole URI), the key ID, or a custom value.
- **Safari playback:** *Auto* plays with Shaka first, keeping every stat, and falls back to Safari's native HLS player if that fails. *Player only* never falls back. *Native* uses Safari's player directly (fewer stats: no segment log, playlist ad markers or direct audio metering).
- **Send license requests through the CORS proxy:** for license servers that don't allow browser access. On Cloudflare the license host must also be in `PROXY_ALLOWED_HOSTS`.

### Any license server, without provider presets

Most servers take the DRM module's message as-is and return the license as-is, so the URL plus headers is enough. For the rest, **Advanced: request & response format** covers the common variations:

| | Options |
| --- | --- |
| **Request body** | *Raw* (standard; PlayReady: the SOAP XML) · *Base64 text* · *Form* (FairPlay, e.g. `spc={{spc}}&assetId={{contentId}}`) · *JSON template*, e.g. `{"spc":"{{spc}}","assetId":"{{contentId}}"}` |
| **Placeholders** | `{{challenge}}` / `{{spc}}` (the message, base64), `{{contentId}}`, `{{keyId}}` |
| **Response** | *Auto-detect* (default) · *Raw* · *Base64* · *`<ckc>…</ckc>`* · *JSON field* (dotted path, e.g. `data.license`) |

Auto-detect recognises raw binary licenses, base64 text, `<ckc>` tags, and JSON with a `license`, `ckc`, `CkcMessage` or `License` field. If a server still doesn't work, the **DRM tab** shows the exact request body sent and the raw response, which usually reveals the expected format.

### Profiles

**Save as…** stores the current DRM settings, plus the stream URL, under a name such as "QA – FairPlay". Pick it from **Profile** to restore both. Profiles stay in this browser.

### Privacy of tokens

DRM settings, headers and tokens are only sent to the license and certificate servers. They're **never** put into *Copy link* URLs or *Export JSON*: the export includes which DRM was used, key statuses and the request timing, but no settings, header values or request/response bodies. Settings are kept after a reload only if you tick *Remember these settings on this browser* (stored in this browser only).

### Testing DRM

- **Widevine:** pick *Angel One — DASH/HLS Widevine* from **Test streams…** in Chrome or Edge. It fills in Google's public Widevine test license server.
- **PlayReady:** in Edge on Windows, pick *Tears of Steel — DASH PlayReady* or *Big Buck Bunny — HLS PlayReady, CBCS* from **Test streams…**. They fill in Microsoft's public PlayReady test server (`test.playready.microsoft.com`). To try the stream's own license URL, clear the PlayReady license URL and load again.
- **FairPlay:** there are no public FairPlay test streams, because the certificate comes from Apple via your DRM provider. Use your own stream, certificate and license URL in Safari.
- **Automated:** headless Chromium has no Widevine, PlayReady or FairPlay, so `npm run test:e2e:drm` uses **ClearKey**, which goes through the same browser DRM (EME) and license path. It plays Shaka's public encrypted *Angel One ClearKey* stream against a local test license server, and checks:
  - the standard license exchange and key status
  - a JSON-wrapped request and response with an auth header, sent through the proxy
  - that a wrong token gives HTTP 403 with a clear message
  - that Widevine settings entered in the UI reach the player
  - that a PlayReady header added to the MPD is decoded (key ID, version, license URL), that *Use this* fills the PlayReady settings, that the PlayReady test-stream preset works, that PlayReady mode with no URL uses the stream's, and that the missing PlayReady is explained

Notes:
- Audio meters can't decode encrypted segments directly, so they fall back to the browser's audio output. With hardware-protected playback (Widevine L1, PlayReady SL3000, usually FairPlay) browsers return silence, so levels may be unavailable.
- Offline or persistent licenses are not supported (out of scope).

---

## Architecture

The app is plain TypeScript with no UI framework, built with **Vite**. Playback uses **[Shaka Player](https://github.com/shaka-project/shaka-player)**: one engine for both DASH and HLS, and one that supports Widevine, PlayReady and FairPlay.

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
  subgraph "Vite dev server (local) or Cloudflare Worker (deployed)"
    PROXY["CORS proxy<br/>server/proxy-plugin.ts · worker/index.ts"]
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
| `server/proxy-shared.ts` | Proxy rules shared by the local server and the Worker: URL mapping, which headers are passed through, CORS headers, redirect rewriting, host allowlist, segment detection and the `/health` capability format. |
| `worker/index.ts` | Cloudflare Worker: serves the built site and, when `PROXY_ENABLED` is `true`, runs the CORS proxy (limited to `PROXY_ALLOWED_HOSTS`, and to manifests/playlists unless `PROXY_SEGMENTS` is `true`). |
| `server/proxy-plugin.ts` | Adds the CORS proxy to the Vite dev and preview servers. Passes ranges, headers and redirects through, and follows the HTTPS proxy settings. |
| `src/scte/scte35.ts` | SCTE-35 decoder, CRC check, summaries, and out/in and duration helpers. No dependencies; unit-tested against published sample messages. |
| `src/scte/hls-cues.ts` | Finds ad-marker tags in HLS playlists and links each one to its segment, timestamp and position. |
| `src/scte/monitor.ts` | Merges markers from all sources, removes duplicates, fills in timings that arrive later, and works out whether an ad break is active. Also records which playlists carry each marker, what each playlist covers, the player state when a marker arrives, segment alignment, `CUE-OUT-CONT` elapsed times and the content runs used for ad insertion. |
| `src/scte/health.ts`, `timing.ts` | The health checks (pure functions of the markers) and splice timing: lead time, segment alignment, PTS with `pts_adjustment` and wrap handling. |
| `src/scte/timeline.ts`, `structure.ts`, `navigation.ts` | Lanes and spans for the timeline, nesting for the structure view, and where to seek for marker and break navigation. |
| `src/scte/ssai.ts` | Content runs from HLS playlists and DASH periods, ad pods and interstitials, and their match with breaks. |
| `src/scte/encode.ts`, `csv.ts` | SCTE-35 encoder (checked against the specification's sample) with HLS tag and DASH EventStream output; CSV export and hourly counts. |
| `src/media/segment.ts` | Reads segments without decoding: fMP4 init (tracks, timescales, codec strings from avcC / hvcC / vpcC / av1C / esds), fMP4 fragments (decode time, duration, sync sample) and MPEG-2 TS (PTS, IDR / IRAP). |
| `src/stream/monitor.ts`, `health.ts`, `mpd.ts` | Records playlist and MPD refreshes and downloaded segments; the stream health checks; SegmentTimeline parsing. |
| `src/stream/alignment.ts` | Compares the same segments across renditions. |
| `src/alarms/monitor.ts`, `picture.ts` | Alarm conditions with hold and release in content time; the picture sampler. |
| `src/ui/stats/health.ts`, `src/ui/health/*`, `src/ui/stats/alarms.ts` | The Health tab (stream checks and alignment) and the Alarms tab. |
| `src/ui/scte/*` | The SCTE-35 sub-views (health, timeline, structure, ad insertion, monitor and alerts, builder) and the navigator shared by the keys, buttons and banner. |
| `src/ui/controls.ts`, `seekbar.ts` | Control bar, track selectors, keyboard shortcuts, and the seek bar with buffered regions and SCTE markers and breaks. |
| `src/ui/stats/*` | One file per tab. Only the visible tab updates (at most once per animation frame). |
| `src/ui/splitter.ts` | Drag handle that resizes the stats panel against the player (mouse, touch, keyboard), remembered in browser storage. |
| `src/ui/dashboard/*`, `src/ui/viewmode.ts` | The Inspect and Monitor dashboards (cards, timeline under the player, facts), their data (health score, events feed, bitrate ladder) as pure functions, and the view switch with its remembered defaults. |
| `src/ui/theme.ts` | System / Light / Dark toggle. Colours are CSS custom properties switched by `data-theme` on `<html>` (or the OS setting in System mode); a small inline script in `index.html` applies the saved theme before the page first appears. |
| `src/drm/settings.ts` | DRM settings model (generic: URLs, headers, formats), Widevine and PlayReady security levels, profiles and storage. |
| `src/drm/transform.ts` | Generic license request wrapping (raw / base64 / form / JSON template) and response unwrapping (auto-detect / base64 / `<ckc>` / JSON field), FairPlay content ID. |
| `src/drm/inspect.ts` | Reads declared protection: PSSH boxes (incl. Widevine PSSH data and PlayReady headers: key IDs, `LA_URL`, version), MPD `ContentProtection` and `mspr:pro`, HLS `EXT-X-KEY`, and `pssh`/`schm`/`tenc` in init segments. |
| `src/drm/monitor.ts`, `src/drm/errors.ts` | License/certificate exchange log, key statuses, expiry; plain-language explanations of DRM errors and key statuses. |
| `src/ui/drm/panel.ts`, `src/ui/stats/drm.ts` | DRM settings panel with profiles, and the DRM tab. |
| `src/audio/dsp.ts` | Measurement maths shared by both sources: BS.1770 K-weighting filters, 4× true-peak interpolator, and 100 ms measurement blocks (peak, RMS, K-weighted energy, correlation sums). |
| `src/audio/loudness.ts` | Turns blocks into momentary, short-term, gated integrated loudness and LRA (fixed-size histograms, so memory stays constant), plus peak hold; the EBU R128 / ATSC A/85 definitions. |
| `src/audio/mp4.ts` | Minimal fMP4 reader: codec configuration from audio init segments (Opus, AAC, FLAC, AC-3/E-AC-3), sample ranges from media segments. |
| `src/audio/stream-meter.ts` | Decodes downloaded audio segments with WebCodecs and timestamps each measurement block with its presentation time. |
| `src/audio/meter.worklet.ts` | AudioWorklet for the Web Audio fallback: measures on the audio thread. |
| `src/audio/engine.ts` | Picks the source, releases stream measurements as the playhead reaches them, and owns the Web Audio graph (the player volume becomes a gain node, so meters stay pre-volume). |
| `src/ui/audio/*`, `src/ui/stats/audio.ts` | Meter rows (shared), the overlay on the video, and the Audio tab. |
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
├── wrangler.jsonc             Cloudflare Workers config (assets, proxy variables)
├── worker/
│   └── index.ts               Cloudflare Worker: static site + optional CORS proxy
├── server/
│   ├── proxy-shared.ts        Proxy logic shared by Vite plugin and Worker
│   └── proxy-plugin.ts        Local CORS proxy (dev + preview)
├── src/
│   ├── main.ts                Connects everything: load, settings, overlay, export, share
│   ├── player/                PlayerController (Shaka wrapper), proxy URL helpers
│   ├── scte/                  SCTE-35 decoder/encoder, HLS cue parser, marker monitor, health checks, timing, ad insertion
│   ├── audio/                 Audio meters: DSP, loudness, fMP4 reader, WebCodecs + Web Audio sources
│   ├── drm/                   DRM settings, license request/response formats, protection parsing, monitor
│   ├── media/                 Segment reader (fMP4 init and fragments, MPEG-2 TS)
│   ├── stream/                Stream health checks, MPD timelines, rendition alignment
│   ├── alarms/                Picture and sound alarms, picture sampler
│   ├── ui/                    Controls, seek bar, chart, view switch, helpers
│   │   ├── dashboard/         Inspect and Monitor dashboards, health score, events feed, bitrate ladder
│   │   ├── scte/              SCTE-35 views: health, timeline, structure, ad insertion, monitor, builder
│   │   └── stats/             Overview, Tracks, SCTE-35, Network, Manifest, Device, Log tabs
│   ├── presets.ts             Test stream list
│   ├── settings.ts            Saved settings / history
│   └── styles.css
├── public/logo.svg, favicon.* App logo, favicons and home-screen icon
├── public/samples/scte-demo/  Bundled offline DASH + HLS sample with SCTE-35
├── public/samples/scte-issues/ SCTE-35 health demo (HLS with an inserted pod and signalling errors)
├── public/samples/alarms-demo/ Stream health & alarms demo (picture, sound and stream problems)
├── scripts/
│   ├── make-sample.mjs        Builds the sample with ffmpeg + adds SCTE-35 markers
│   ├── make-issues-sample.mjs Builds the SCTE-35 health demo from the sample
│   ├── e2e-scte.mjs           End-to-end checks of the SCTE-35 tools
│   ├── make-alarms-sample.mjs Builds the stream health & alarms demo with ffmpeg
│   ├── e2e-health.mjs         End-to-end checks of stream health, alignment and alarms
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
- **SCTE-35 health and tools**: every health check (break pairing and durations, merged signals, segmentation pairs, CRC and cancels, `CUE-OUT-CONT`, missing renditions, lead time, segment alignment, `splice_time` outliers), the encoder (round trips, the specification's `splice_insert` sample byte for byte, PTS wrap), HLS tag and EventStream output, builder form validation, navigation, timeline lanes, structure nesting, CSV escaping and hourly counts, UPID formats, and ad insertion (HLS pods, live refreshes, DASH periods, interstitials, underfill).
- **Proxy URL conversion**: round trips, relative URLs, how the server reads the target URL, and the host allowlist.
- **Cloudflare Worker**: static files passed through, proxy off by default, health check and capabilities, CORS and Range/custom header forwarding, redirect rewriting, allowlist blocking, and the segment guardrail (blocked by extension without contacting the origin, blocked by Content-Type, playlists still allowed, `PROXY_SEGMENTS=true` override).
- **Loudness**: BS.1770-4 K-weighting coefficients; EBU Tech 3341 tests 1, 2, 3 and 5 (integrated, momentary, short-term, relative and absolute gates); 5.1 surround weighting and LFE exclusion; EBU Tech 3342 loudness range; true peak against an inter-sample-peak signal; correlation.
- **fMP4 audio parsing** on the bundled sample: Opus stereo and 5.1 configuration (OpusHead with channel mapping), video init ignored, sample tables.
- **DRM**: request formats (raw, base64, JSON template with escaping, form), response formats (auto-detect of binary, base64, `<ckc>`, JSON fields; ClearKey passed through), FairPlay content ID from `skd://` (UTF-8 and UTF-16), Widevine and ClearKey PSSH decoding from real streams, PlayReady headers v4.0 to v4.3 (GUID key IDs, `LA_URL`, entities) from PSSH, `mspr:pro` and HLS data URIs, SOAP licenses passed through, MPD and HLS key tags, init-segment boxes, error messages. The Worker tests also cover license POST forwarding and the size limit. The end-to-end DRM run is `npm run test:e2e:drm` (see [Testing DRM](#testing-drm)).
- **Request routing**: manifests proxied, segments sent directly, relative segment URLs taken back out of the proxy, own-site files never proxied.

- **Stream health, alignment and alarms**: the segment reader on the bundled sample and on synthetic TS (H.264 IDR / non-IDR), codec comparison, every playlist refresh check (sequence numbers, discontinuity sequence, target duration, PDT drift and changes, stale, ended), MPD timelines (repeats, gaps, long segments, stale), downloaded segment checks (codecs, duration, bitrate, timestamp gaps), rendition comparison (boundaries, timestamps, durations, keyframes, missing segments), and every alarm (hold, release, seeks, content-time at 4×, LFE ignored, disabled alarms).

`npm run test:e2e:health` plays the stream health & alarms demo in headless Chromium at 4× and checks that every alarm raises, the banner, the timeline marks and the CSV; the stream checks (target duration, codec, bandwidth after switching to 360p) and the alignment failure; and that the clean sample has no stream problems, aligned renditions and no alarms.

`npm run test:e2e:scte` plays the two bundled samples in headless Chromium and checks that every problem planted in the health demo is reported, that the clean sample passes, the ad pod and its fill, the timeline, structure, navigation keys, CSV download, the marker missing from the 240p playlist (after switching to it) and the builder.

For end-to-end checks, `npm run screenshots` drives the real app in Chromium against both bundled samples. It's a quick smoke test for DASH, HLS, SCTE detection and the UI.

---

## The bundled sample stream

`public/samples/scte-demo/` contains a 40-second sample that works offline, made by `npm run sample` (needs `ffmpeg` with VP9 and Opus support):

- VP9 video at 240p and 480p, English and Italian WebVTT subtitles, and three Opus audio tracks:
  - English stereo and Italian stereo
  - **English 5.1**: a different tone and level on each channel (L/R about −20 dBFS, C about −16, LFE 50 Hz about −22, Ls/Rs about −28), each slowly pulsing, to test the 5.1 meters
- The same segments are used by `dash.mpd` and by the HLS `master.m3u8`.
- SCTE-35 markers:
  - **6 s → 14 s:** `splice_insert` OUT (8 s) and IN, in a DASH `<EventStream>` / HLS `EXT-X-DATERANGE SCTE35-OUT` + `CUE-OUT` / `CUE-OUT-CONT` / `CUE-IN`.
  - **20 s → 26 s:** `time_signal` with a segmentation descriptor (Provider Placement Opportunity Start/End, Ad-ID UPID), as **in-band `emsg`** boxes in the video segments (both DASH and HLS).

VP9/Opus is used so the sample also plays in open-source Chromium, which is used for the automated screenshots.

### SCTE-35 health demo

`public/samples/scte-issues/` (pick **SCTE-35 health demo** from **Test streams…**) is an HLS stream built from the same segments by `npm run sample:issues`, with problems planted on purpose:

- **6 s:** an 8 s break (`DATERANGE` + `CUE-OUT`) filled by a **6 s inserted pod** (segments from another folder, between discontinuities): underfill. One `CUE-OUT-CONT` states 7 s elapsed when 4 s have.
- **16 s:** a Provider Placement Opportunity (2 s) with an advertisement inside it, whose end signal comes after 4 s. It is **missing from the 240p playlist** (switch the quality to 240p to see that check).
- **32 s:** a `CUE-OUT` with no duration and no IN, carrying an `OATCLS` message with a **broken CRC**.

### Stream health & alarms demo

`public/samples/alarms-demo/` (pick **Stream health & alarms demo** from **Test streams…**) is a 76 s HLS stream made with ffmpeg by `npm run sample:alarms`:

- **6–10 s** black picture, **10–18 s** frozen picture, **12–20 s** silence, **22–36 s** right channel lost, **38–62 s** too loud with true peaks, **64–72 s** out of phase.
- The **180p** rendition has a keyframe every 3 s (3 s segments against 2 s for 360p, so rendition alignment fails) and claims a 2 s target duration. The master playlist declares a wrong codec level and a too-low `BANDWIDTH` for **360p** (switch to 360p to see those).

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
| `a` | Audio meters on the video |
| `l` | Jump to live edge |
| `n` / `p` | Next / previous SCTE marker |
| `b` | Jump to a few seconds before the next ad break (3–30 s, set in the SCTE-35 tab) |
| `s` | Skip the current ad break (to its advertised end or its IN marker) |

---

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Shaka error 1002 HTTP_ERROR` | Usually CORS or a network failure. With `npm run dev`, set the proxy to **Auto** or **Always**. Check the **Network** tab for the failing URL and status. |
| `4032 CONTENT_UNSUPPORTED_BY_BROWSER` | The browser can't decode those codecs (for example HEVC in Firefox, or H.264 in headless Chromium). The **Device** tab shows what this device supports. |
| Nothing plays from a deployed `https://` site | The stream is `http://` (blocked as mixed content) or doesn't allow browser access. Run locally with `npm run dev`. |
| Proxy can't reach the origin behind a corporate proxy | Set `HTTPS_PROXY` (and `NODE_EXTRA_CA_CERTS` if your company inspects HTTPS) before `npm run dev`. |
| On Cloudflare, a stream fails with a CORS error and the app doesn't offer the proxy | The proxy is off on the Worker. Set `PROXY_ENABLED=true` (and `PROXY_ALLOWED_HOSTS`), then redeploy. Check with `/__proxy/health`. |
| *This browser cannot use the requested DRM* (6001), or *This browser has no …* | Widevine needs Chrome, Edge or Firefox; PlayReady needs Windows (Edge, or Chrome/Firefox with hardware PlayReady), a Smart TV or Xbox; FairPlay needs Safari. Also try security level *Auto*: Widevine L1 and PlayReady SL3000 need a hardware-backed device. |
| PlayReady fails in Edge with SL3000 | The graphics driver or display path doesn't support hardware DRM. Choose *SL2000 only*, update the GPU driver, or use a directly connected screen. |
| DRM stream: audio plays but the picture is blank (white or black), in other players too | The device blocks protected video on that screen. Most often a **DisplayLink** dock or adapter: use a monitor connected directly, or the laptop screen. Also check for screen sharing or recording (Teams, Zoom, OBS), remote desktop, Chrome's *graphics acceleration* setting (`chrome://settings/system`), and the Widevine module (`chrome://components`). |
| License request fails with HTTP 401/403 | Wrong or missing token: check the license request headers (or the JSON template). The DRM tab shows the server's reply. |
| License request fails with no HTTP status | Usually CORS: tick *Send license requests through the CORS proxy* (and, on Cloudflare, add the license host to `PROXY_ALLOWED_HOSTS`). |
| *The DRM module rejected the license* (6008) | The response isn't in the expected form: choose a different *Response* format, and compare with the raw response in the DRM tab. |
| FairPlay: *needs a certificate* (6015) or *certificate rejected* (6004) | Add the certificate URL or file; make sure it belongs to this license server. |
| A key shows *output-restricted* | Output protection (HDCP) blocks that rendition on this display or connection; the player skips it. |
| On Cloudflare the manifest loads but segments fail; the Log says *"This proxy only carries manifests/playlists"* | The segment CDN blocks CORS. Enable CORS on that CDN, use `npm run dev`, or set `PROXY_SEGMENTS=true` (one Worker request per segment). |
| Proxy returns `403 … not in PROXY_ALLOWED_HOSTS` | Add the origin's host (or `*.domain`) to `PROXY_ALLOWED_HOSTS`. |
| Audio tab says *downmixed by browser* for a 5.1 track | The stream couldn't be decoded directly (see *Measured from*), so the meters use the browser's output, which Chrome mixes to your speakers' channel count. With fMP4 Opus/AAC audio this doesn't happen. |
| The overlay shows *Click to start audio meters* | This stream's audio can't be decoded directly (e.g. MPEG-2 TS or WebM), and browsers only allow the Web Audio fallback after a click. |
| `npm run screenshots` can't find a browser | Run `npx playwright install chromium`, or set `CHROMIUM_PATH` to a Chrome or Chromium executable. |

---

## Roadmap

- Persistent/offline licenses.
- Thumbnail previews on the seek bar.
- Low-latency stats (part and chunk timing, playback-rate catch-up).
- CMCD / CMSD reporting and inspection.
- Direct audio metering for MPEG-2 TS and packed-audio HLS (demux ADTS/AC-3), so those streams don't need the Web Audio fallback.

---

## Versions and releases

PlayProbe uses [Semantic Versioning](https://semver.org): a minor version (1.1, 1.2) adds features, a patch version (1.2.1) fixes bugs. Every change is listed in [CHANGELOG.md](CHANGELOG.md), and the header shows the version and its release date (or *pre-release* for work not released yet), linking to the changelog.

To release a version:

1. In `package.json`, set `version` (e.g. `1.1.0`) and `releaseDate` (`YYYY-MM-DD`). Leave `releaseDate` empty on a feature branch: the header then shows *pre-release*.
2. In `CHANGELOG.md`, move the *Unreleased* notes under a new `## [1.1.0] - YYYY-MM-DD` heading and update the compare links at the bottom.
3. Merge to `main`, then on GitHub create the release: **Releases → Draft a new release**, tag `v1.1.0` on `main`, and paste that version's changelog section as the notes.

---

## License

[MIT](LICENSE) © 2026 garghe.

Third-party components keep their own licenses. In particular, [Shaka Player](https://github.com/shaka-project/shaka-player) is Apache-2.0, and the public test streams listed in the app belong to their respective owners. The bundled sample stream in `public/samples/` is generated by this project (`npm run sample`) and is covered by the MIT license.

<!-- deploy trigger -->

<!-- deploy trigger -->
