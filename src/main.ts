import './styles.css';
import { AudioEngine } from './audio/engine';
import { PlayerController, describeShakaError } from './player/controller';
import { AudioOverlay } from './ui/audio/overlay';
import { drmHint, drmUnavailableHint } from './drm/errors';
import { isDrmConfigured, normaliseDrm } from './drm/settings';
import { DrmPanel } from './ui/drm/panel';
import { ScteNavigator } from './ui/scte/navigator';
import { BuilderView } from './ui/scte/builder';
import { MonitorView, ScteAlerts } from './ui/scte/monitor';
import { APP_VERSION, RELEASE_DATE, renderVersion } from './version';
import { presets, type Preset } from './presets';
import { loadHistory, loadSettings, parseHeaders, pushHistory, saveSettings, type Settings } from './settings';
import { snapshot } from './ui/stats/overview';
import { StatsPanel } from './ui/stats/panel';
import { Controls } from './ui/controls';
import { $, clear, h } from './ui/dom';
import { formatBitrate, formatTime } from './ui/format';
import { icons } from './ui/icons';
import { installSplitter } from './ui/splitter';
import { installThemeToggle } from './ui/theme';
import { ALARM_LABELS, AlarmMonitor } from './alarms/monitor';
import { PictureSampler } from './alarms/picture';
import { AlarmsTab, loadAlarmSettings } from './ui/stats/alarms';
import { STANDARDS } from './audio/loudness';
import { audioPrefs } from './audio/prefs';
import { Dashboard } from './ui/dashboard/dashboard';
import { ViewModeSwitch, defaultView, parseView } from './ui/viewmode';
import { installTooltips } from './ui/tooltip';
import { WelcomeGuide, shouldShowWelcome } from './ui/welcome';

const video = $('#video') as HTMLVideoElement;
const playerEl = $('#player');
const urlInput = $('#url') as HTMLInputElement;
const presetSel = $('#presets') as HTMLSelectElement;
renderVersion($('#app-version') as HTMLAnchorElement);
const historyList = $('#url-history');
const settingsBtn = $('#settings-btn');
const settingsPanel = $('#settings');
const proxyModeSel = $('#proxy-mode') as HTMLSelectElement;
const proxyStatus = $('#proxy-status');
const headersInput = $('#headers') as HTMLTextAreaElement;
const lowLatencyInput = $('#low-latency') as HTMLInputElement;
const autoplayInput = $('#autoplay') as HTMLInputElement;
const message = $('#player-message');
const spinner = $('#spinner');
const adBanner = $('#ad-banner');
const alarmBanner = $('#alarm-banner');
const adBannerText = h('span');
adBanner.append(
  adBannerText,
  h('button', { type: 'button', class: 'skip-break', title: 'Skip to the end of this break (s)', onclick: () => scteNav.skipBreak() }, 'Skip ›'),
);
const nerdOverlay = $('#nerd-overlay');
// The sticky header's height positions the side panel and the Monitor rail.
const topbar = $('.topbar');
new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${topbar.offsetHeight}px`)).observe(topbar);
const factsEl = $('#stream-summary');
const formatChip = $('#format-chip');
const viewSwitch = new ViewModeSwitch($('#view-toggle'));
/** A view asked for by the link (?view=), applied once when that stream loads. */
let linkView = parseView(new URLSearchParams(location.search).get('view'));
const toast = $('#toast');

function showToast(text: string) {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(Number(toast.dataset.timer));
  toast.dataset.timer = String(window.setTimeout(() => (toast.hidden = true), 2500));
}

function showMessage(title: string | null, body = '', isError = false) {
  if (!title) {
    message.hidden = true;
    return;
  }
  message.hidden = false;
  message.classList.toggle('error', isError);
  clear(message, h('div', null, h('strong', null, title), body ? h('p', null, body) : ''));
}

// ------------------------------------------------------------------ settings

let settings: Settings = loadSettings();
proxyModeSel.value = settings.proxyMode;
headersInput.value = settings.headers;
lowLatencyInput.checked = settings.lowLatency;
autoplayInput.checked = settings.autoplay;

function readSettings() {
  settings = {
    proxyMode: proxyModeSel.value as Settings['proxyMode'],
    headers: headersInput.value,
    lowLatency: lowLatencyInput.checked,
    autoplay: autoplayInput.checked,
  };
  saveSettings(settings);
}
for (const el of [proxyModeSel, headersInput, lowLatencyInput, autoplayInput]) el.addEventListener('change', readSettings);

function renderSettingsButton() {
  settingsBtn.innerHTML = `${icons.settings}<span>Proxy: ${proxyModeSel.value}</span>`;
}
renderSettingsButton();
proxyModeSel.addEventListener('change', renderSettingsButton);
settingsBtn.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsBtn.setAttribute('aria-expanded', String(!settingsPanel.hidden));
});

function renderHistory(list = loadHistory()) {
  clear(historyList, list.map((u) => h('option', { value: u })));
}

// ---------------------------------------------------------------------- DRM

const drmBtn = $('#drm-btn');
const drmPanel = new DrmPanel($('#drm-panel'), {
  getUrl: () => urlInput.value.trim(),
  setUrl: (u) => (urlInput.value = u),
  toast: (m) => showToast(m),
});
function renderDrmButton() {
  const s = drmPanel.settings;
  const on = isDrmConfigured(s);
  drmBtn.innerHTML = `${icons.lock}<span>${on ? ({ auto: 'DRM auto', widevine: 'Widevine', playready: 'PlayReady', fairplay: 'FairPlay', off: 'DRM' } as const)[s.mode] : 'DRM'}</span>`;
  drmBtn.classList.toggle('active', on);
}
function toggleDrmPanel(open?: boolean) {
  drmPanel.toggle(open);
  drmBtn.setAttribute('aria-expanded', String(!$('#drm-panel').hidden));
}
drmBtn.addEventListener('click', () => toggleDrmPanel());
drmPanel.onChange(renderDrmButton);
renderDrmButton();

const presetByUrl = new Map<string, Preset>();
const groups = new Map<string, HTMLOptGroupElement>();
presetSel.append(h('option', { value: '' }, 'Test streams…'));
for (const p of presets()) {
  let group = groups.get(p.group);
  if (!group) {
    group = h('optgroup', { label: p.group });
    groups.set(p.group, group);
    presetSel.append(group);
  }
  group.append(h('option', { value: p.url, title: p.notes ?? p.url }, p.name));
  presetByUrl.set(p.url, p);
}
presetSel.addEventListener('change', () => {
  if (!presetSel.value) return;
  urlInput.value = presetSel.value;
  const preset = presetByUrl.get(presetSel.value);
  presetSel.value = '';
  if (preset?.drm) {
    // DRM test streams fill in their license server.
    const base = normaliseDrm(drmPanel.settings);
    drmPanel.setSettings({
      ...base,
      ...preset.drm,
      widevine: { ...base.widevine, ...preset.drm.widevine },
      playready: { ...base.playready, ...preset.drm.playready },
    } as typeof base);
    showToast('DRM settings filled in for this test stream');
  }
  void load(urlInput.value);
});

// -------------------------------------------------------------------- player

if (!PlayerController.isBrowserSupported()) {
  showMessage('Browser not supported', 'This browser lacks Media Source Extensions, which are required for DASH/HLS playback.', true);
  throw new Error('Browser not supported');
}

const ctrl = new PlayerController(video, playerEl);
const overlay = {
  visible: false,
  toggle() {
    this.visible = !this.visible;
    nerdOverlay.hidden = !this.visible;
    renderOverlay();
    return this.visible;
  },
};
installSplitter($('.layout'), $('#splitter'));
// Redraw canvas-based views (the chart) in the new colours.
installThemeToggle($('#theme-btn') as HTMLButtonElement, () => ctrl.dispatchEvent(new CustomEvent('tick')));
const audio = new AudioEngine(video);
ctrl.onAudioSegment = (kind, id, data, start) =>
  kind === 'init' ? audio.stream.init(id, data) : audio.stream.segment(id, data, start);
// Forward audio updates as controller events so the stats panel can subscribe.
audio.on('levels', () => ctrl.dispatchEvent(new CustomEvent('audio')));
audio.on('state', () => ctrl.dispatchEvent(new CustomEvent('audio')));
new AudioOverlay($('#audio-overlay'), audio, ctrl);
// Integrated loudness is "since load / since the audio track changed".
let audioTrackKey = '';
const resetAudioOnTrackChange = () => {
  const t = ctrl.loadedUrl ? ctrl.player.getAudioTracks().find((x) => x.active) : undefined;
  audio.activeStreamId = ctrl.loadedUrl ? (ctrl.player.getVariantTracks().find((v) => v.active)?.audioId ?? null) : null;
  const key = `${ctrl.loadedUrl}|${t?.language}|${t?.label}|${t?.channelsCount}|${t?.codecs}`;
  if (key !== audioTrackKey) {
    audioTrackKey = key;
    audio.reset();
  }
};
// A new load starts a new measurement session.
ctrl.on('reset', () => audio.clearStream());
ctrl.on('loaded', resetAudioOnTrackChange);
ctrl.on('tracks', resetAudioOnTrackChange);
const panel = new StatsPanel(ctrl, $('#tabs'), $('#tab-body'), audio, {
  open: () => toggleDrmPanel(true),
  useLicenseUrl: (system, url) => {
    drmPanel.useLicenseUrl(system, url);
    toggleDrmPanel(true);
    showToast(`License URL from the stream set for ${system === 'playready' ? 'PlayReady' : 'Widevine'}: reload the stream to use it`);
  },
});
const scteNav = new ScteNavigator(ctrl, showToast);
panel.scteTab.setNavigation(scteNav.toolbar());
// Picture and sound alarms (confidence monitoring).
const alarms = new AlarmMonitor();
alarms.settings = loadAlarmSettings();
const pictureSampler = new PictureSampler(video, alarms, () => ctrl.activeDrm() !== null);
pictureSampler.start();
audio.on('levels', () => {
  const std = STANDARDS[audioPrefs.standard];
  alarms.audio(video.paused || !ctrl.loadedUrl ? null : audio.reading, Date.now(), video.currentTime, std.target, std.maxTruePeak);
});
alarms.onAlarm((e, raised) => {
  if (raised) ctrl.addMark('alarm', `${ALARM_LABELS[e.type]}: ${e.detail}`, e.mediaStart);
  ctrl.dispatchEvent(new CustomEvent('alarms'));
  renderAlarmBanner();
});
const resetAlarms = () => {
  alarms.reset();
  pictureSampler.reset();
  renderAlarmBanner();
};
ctrl.on('reset', resetAlarms);
const alarmsTab = new AlarmsTab(ctrl, alarms, pictureSampler, showToast);
panel.addTab({ id: 'alarms', label: 'Alarms', view: alarmsTab, events: ['alarms', 'tick', 'loaded'], count: () => alarms.active.size }, 'health');
function renderAlarmBanner() {
  const active = [...alarms.active.values()];
  alarmBanner.hidden = !active.length || !ctrl.loadedUrl;
  alarmBanner.textContent = active.map((e) => `⚠ ${ALARM_LABELS[e.type].toUpperCase()} ${Math.max(0, Math.round(video.currentTime - e.mediaStart))}s`).join(' · ');
}
ctrl.on('tick', renderAlarmBanner);
const dashboard = new Dashboard(
  {
    ctrl,
    audio,
    alarms,
    scteHealth: panel.scteTab.health,
    streamHealth: panel.healthTab.cache,
    view: viewSwitch,
    open: (tab) => panel.show(tab),
    openMarker: (key) => {
      panel.show('scte');
      panel.scteTab.selectKey(key);
    },
  },
  factsEl,
  $('#stage-extras'),
);
panel.addTab({ id: 'dashboard', label: 'Dashboard', view: dashboard, events: ['tick', 'scte', 'stream', 'alarms', 'alignment', 'loaded', 'tracks', 'drm'] }, null);
const scteBuilder = new BuilderView(showToast);
const scteAlerts = new ScteAlerts(ctrl);
const scteMonitor = new MonitorView(ctrl, scteAlerts, panel.scteTab.health, showToast);
panel.scteTab.addView({ id: 'alerts', label: 'Alerts', el: scteMonitor.el, render: () => scteMonitor.render() });
panel.scteTab.addView({ id: 'builder', label: 'Builder', el: scteBuilder.el, render: () => scteBuilder.render() });
// Marker and ad-break shortcuts (the player's own keys live in Controls).
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (!ctrl.loadedUrl || target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const action = { n: () => scteNav.next(), p: () => scteNav.previous(), b: () => scteNav.beforeNextBreak(), s: () => scteNav.skipBreak() }[e.key];
  if (!action) return;
  e.preventDefault();
  action();
});
new Controls(ctrl, $('#controls'), playerEl, overlay, (e) => panel.showScteEvent(e), audio);

// ------------------------------------------------------------ guide / tooltips

installTooltips();
const demoUrl = presets()[0].url;
const guide = new WelcomeGuide({
  version: APP_VERSION,
  logo: `${import.meta.env.BASE_URL}logo.svg`,
  onDemo: () => {
    urlInput.value = demoUrl;
    void load(demoUrl);
  },
});
$('#help-btn').addEventListener('click', () => guide.show());
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.key !== '?' || target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  guide.show();
});
if (shouldShowWelcome(window.localStorage)) guide.show();

function renderOverlay() {
  if (!overlay.visible) return;
  const s = snapshot(ctrl);
  const rows: [string, string][] = [
    ['Format', `${s.format} ${s.live ? 'live' : 'VOD'}${s.proxied ? ' (proxy)' : ''}`],
    ['Viewport / frames', `${playerEl.clientWidth}×${playerEl.clientHeight} / ${s.droppedFrames} dropped of ${s.decodedFrames}`],
    ['Current / optimal res', `${s.resolution} / ${s.variant}`],
    ['Codecs', s.codecs],
    ['Connection speed', formatBitrate(s.estimatedBandwidth)],
    ['Buffer health', `${s.bufferAhead.toFixed(2)} s`],
    ...(s.live ? ([['Live latency', s.liveLatency !== null ? `${s.liveLatency.toFixed(2)} s` : '—']] as [string, string][]) : []),
    ['SCTE-35 markers', String(ctrl.scte.size)],
  ];
  clear(
    nerdOverlay,
    h('button', { type: 'button', class: 'close', 'aria-label': 'Close stats overlay', onclick: () => overlay.toggle() }, '×'),
    h('table', null, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v)))),
  );
}

function renderAdBanner() {
  const br = ctrl.loadedUrl ? ctrl.scte.activeBreak(video.currentTime) : null;
  adBanner.hidden = !br;
  playerEl.classList.toggle('in-break', Boolean(br));
  if (br) {
    adBannerText.textContent =
      br.remaining !== undefined ? `AD BREAK · ${Math.ceil(br.remaining)}s remaining` : `AD BREAK · since ${formatTime(br.start)}`;
    adBanner.title = br.event.summary;
  }
}

// DRM-protected frames can't be read back by the page (even Widevine L3),
// and hardware-secure ones (L1/L2) go through a protected overlay plane.
// Rounded clipping and backdrop blur over the video need those pixels, and
// Chrome then shows a blank (white) picture, so drop those effects while any
// DRM is in use.
function updateProtectedVideo() {
  playerEl.classList.toggle('drm-protected', ctrl.activeDrm() !== null);
}
ctrl.on('drm', updateProtectedVideo);
ctrl.on('loaded', updateProtectedVideo);

ctrl.on('tick', () => {
  renderOverlay();
  dashboard.renderStage();
});
ctrl.on('scte', () => dashboard.renderStage());
ctrl.on('tracks', () => dashboard.renderStage());

// Format chip in the load bar, and the view for this kind of stream.
ctrl.on('loaded', () => {
  const loaded = Boolean(ctrl.loadedUrl);
  formatChip.hidden = !loaded;
  if (loaded) {
    const live = ctrl.player.isLive();
    formatChip.textContent = `${ctrl.player.getManifestType() ?? ''}${live ? ' · LIVE' : ''}`;
    formatChip.classList.toggle('live', live);
    viewSwitch.live = live;
    viewSwitch.set(linkView ?? defaultView(live));
    linkView = null;
  } else {
    viewSwitch.live = null;
  }
  dashboard.renderStage();
});
viewSwitch.onChange(() => {
  dashboard.renderStage();
  if (panel.current === 'dashboard') dashboard.render();
});
video.addEventListener('timeupdate', renderAdBanner);
ctrl.on('scte', renderAdBanner);
ctrl.on('buffering', (b) => (spinner.hidden = !b));
ctrl.on('error', (err) => {
  const e = err as { severity?: number } | undefined;
  // Severity 2 = CRITICAL: playback stopped.
  if (e?.severity === 2) {
    showMessage('Playback error', `${describeShakaError(err)}. ${hintFor(err, ctrl.loadedUrl ?? '')}`, true);
  }
});

// ---------------------------------------------------------------------- load

function hintFor(err: unknown, url: string): string {
  const code = (err as { code?: number })?.code;
  const hints: string[] = [];
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    hints.push('This page is served over HTTPS, so the browser blocks http:// streams (mixed content). Run the app locally with `npm run dev`.');
  }
  if (code === 1002 || code === 1001) {
    hints.push(
      ctrl.proxyAvailable
        ? 'The request failed. If the server does not send CORS headers, set CORS proxy to "Always" in the settings (⚙).'
        : 'The request failed, most often because the server does not send CORS headers. Run the app with `npm run dev` to use the built-in CORS proxy.',
    );
  }
  if (code === 4032 || code === 4040) hints.push('The stream uses codecs this browser cannot decode — see the Device tab.');
  const drm = code && code >= 6000 && code < 7000 && ctrl.unavailableDrm ? drmUnavailableHint(ctrl.unavailableDrm) : drmHint(err);
  if (drm) hints.push(drm);
  if (drm || (code && code >= 6000 && code < 7000)) hints.push('Details are in the DRM tab.');
  return hints.join(' ');
}

let loading = false;
async function load(url: string) {
  url = url.trim();
  if (!url || loading) return;
  loading = true;
  readSettings();
  showMessage(null);
  spinner.hidden = false;
  const params = new URLSearchParams(location.search);
  params.set('url', url);
  // ?view= only decides the first load from a shared link.
  if (!linkView) params.delete('view');
  history.replaceState(null, '', `${location.pathname}?${params}`);
  try {
    await ctrl.load({
      url,
      proxyMode: settings.proxyMode,
      headers: parseHeaders(settings.headers),
      lowLatency: settings.lowLatency,
      drm: structuredClone(drmPanel.settings),
    });
    renderHistory(pushHistory(url));
    playerEl.classList.add('has-media');
    if (settings.autoplay) {
      try {
        await video.play();
      } catch {
        // Autoplay with sound is blocked until the user interacts: retry muted.
        audio.setMuted(true);
        await video.play().catch(() => undefined);
        showToast('Autoplay with sound was blocked — playing muted');
      }
    }
  } catch (err) {
    playerEl.classList.remove('has-media');
    showMessage('Could not load the stream', `${describeShakaError(err)}. ${hintFor(err, url)}`, true);
  } finally {
    spinner.hidden = true;
    loading = false;
  }
}

$('#load-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void load(urlInput.value);
});

// ------------------------------------------------------------ share / export

$('#share-btn').addEventListener('click', async () => {
  const url = ctrl.loadedUrl ?? urlInput.value;
  if (!url) return showToast('Load a stream first');
  const link = `${location.origin}${location.pathname}?url=${encodeURIComponent(url)}&view=${viewSwitch.mode}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link copied');
  } catch {
    prompt('Copy this link', link);
  }
});

$('#export-btn').addEventListener('click', () => {
  const p = ctrl.player;
  const loaded = Boolean(ctrl.loadedUrl);
  const data = {
    exportedAt: new Date().toISOString(),
    view: viewSwitch.mode,
    app: { name: 'PlayProbe', version: APP_VERSION, releaseDate: RELEASE_DATE || null },
    userAgent: navigator.userAgent,
    snapshot: snapshot(ctrl),
    shakaStats: p.getStats(),
    variants: loaded ? p.getVariantTracks() : [],
    audioTracks: loaded ? p.getAudioTracks() : [],
    textTracks: loaded ? p.getTextTracks() : [],
    scte35: ctrl.scte.list().map(({ hls: _hls, ...e }) => e),
    alarms: alarms.log,
    streamHealth: ctrl.streamHealth(),
    renditionAlignment: ctrl.alignment ? { ...ctrl.alignment, rows: ctrl.alignment.rows.map((r) => ({ ...r })) } : null,
    // DRM: what was used and what happened, but never settings, headers or bodies.
    drm: {
      active: ctrl.activeDrm(),
      declared: [...ctrl.drm.declared.values()],
      keyStatuses: ctrl.drm.keyStatuses,
      exchanges: ctrl.drm.exchanges.map(({ requestPreview: _q, responsePreview: _r, ...x }) => x),
    },
    audio: { state: audio.state, decodedChannels: audio.channels, sampleRate: audio.sampleRate, reading: audio.lastReading },
    network: ctrl.network,
    log: ctrl.log,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `playprobe-stats-${Date.now()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------------- boot

renderHistory();
await ctrl.init();
proxyStatus.textContent = ctrl.proxyAvailable
  ? `${ctrl.proxyDescription()[0].toUpperCase()}${ctrl.proxyDescription().slice(1)}.`
  : 'No CORS proxy on this server: streams must send CORS headers.';
proxyStatus.className = ctrl.proxyAvailable ? 'ok' : 'warn';
drmPanel.proxyAvailable = ctrl.proxyAvailable;

const initial = new URLSearchParams(location.search).get('url');
if (initial) {
  urlInput.value = initial;
  void load(initial);
}

// Exposed for debugging from the console.
Object.assign(window, { abrPlayer: ctrl, abrAudio: audio });
