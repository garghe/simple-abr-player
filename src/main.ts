import './styles.css';
import { PlayerController, describeShakaError } from './player/controller';
import { presets } from './presets';
import { loadHistory, loadSettings, parseHeaders, pushHistory, saveSettings, type Settings } from './settings';
import { snapshot } from './ui/stats/overview';
import { StatsPanel } from './ui/stats/panel';
import { Controls } from './ui/controls';
import { $, clear, h } from './ui/dom';
import { formatBitrate, formatTime } from './ui/format';
import { icons } from './ui/icons';
import { installSplitter } from './ui/splitter';
import { installThemeToggle } from './ui/theme';

const video = $('#video') as HTMLVideoElement;
const playerEl = $('#player');
const urlInput = $('#url') as HTMLInputElement;
const presetSel = $('#presets') as HTMLSelectElement;
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
const nerdOverlay = $('#nerd-overlay');
const summary = $('#stream-summary');
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

settingsBtn.innerHTML = icons.settings;
settingsBtn.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsBtn.setAttribute('aria-expanded', String(!settingsPanel.hidden));
});

function renderHistory(list = loadHistory()) {
  clear(historyList, list.map((u) => h('option', { value: u })));
}

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
}
presetSel.addEventListener('change', () => {
  if (!presetSel.value) return;
  urlInput.value = presetSel.value;
  presetSel.value = '';
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
const panel = new StatsPanel(ctrl, $('#tabs'), $('#tab-body'));
new Controls(ctrl, $('#controls'), playerEl, overlay, (e) => panel.showScteEvent(e));

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
    adBanner.textContent =
      br.remaining !== undefined ? `AD BREAK · ${Math.ceil(br.remaining)}s remaining` : `AD BREAK · since ${formatTime(br.start)}`;
    adBanner.title = br.event.summary;
  }
}

function renderSummary() {
  if (!ctrl.loadedUrl) {
    summary.replaceChildren();
    return;
  }
  const s = snapshot(ctrl);
  summary.replaceChildren(
    h('span', { class: 'badge accent' }, s.format),
    h('span', { class: `badge ${s.live ? 'live' : ''}` }, s.live ? 'LIVE' : 'VOD'),
    s.proxied ? h('span', { class: 'badge' }, 'via proxy') : '',
    h('span', null, `${s.variants} variants · ${s.audioTracks} audio · ${s.textTracks} subtitles`),
    h('span', { class: 'mono' }, s.codecs),
    h('span', null, `SCTE-35 markers: ${ctrl.scte.size}`),
  );
}

ctrl.on('tick', () => {
  renderOverlay();
  renderSummary();
});
ctrl.on('scte', renderSummary);
ctrl.on('tracks', renderSummary);
video.addEventListener('timeupdate', renderAdBanner);
ctrl.on('scte', renderAdBanner);
ctrl.on('buffering', (b) => (spinner.hidden = !b));
ctrl.on('error', (err) => {
  const e = err as { severity?: number } | undefined;
  // Severity 2 = CRITICAL: playback stopped.
  if (e?.severity === 2) showMessage('Playback error', describeShakaError(err), true);
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
  if (code === 6001 || code === 6007) hints.push('The stream is DRM-protected; DRM support is planned for the next iteration.');
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
  history.replaceState(null, '', `${location.pathname}?${params}`);
  try {
    await ctrl.load({
      url,
      proxyMode: settings.proxyMode,
      headers: parseHeaders(settings.headers),
      lowLatency: settings.lowLatency,
    });
    renderHistory(pushHistory(url));
    playerEl.classList.add('has-media');
    if (settings.autoplay) {
      try {
        await video.play();
      } catch {
        // Autoplay with sound is blocked until the user interacts: retry muted.
        video.muted = true;
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
  const link = `${location.origin}${location.pathname}?url=${encodeURIComponent(url)}`;
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
    userAgent: navigator.userAgent,
    snapshot: snapshot(ctrl),
    shakaStats: p.getStats(),
    variants: loaded ? p.getVariantTracks() : [],
    audioTracks: loaded ? p.getAudioTracks() : [],
    textTracks: loaded ? p.getTextTracks() : [],
    scte35: ctrl.scte.list().map(({ hls: _hls, ...e }) => e),
    network: ctrl.network,
    log: ctrl.log,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `abr-player-stats-${Date.now()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------------- boot

renderHistory();
await ctrl.init();
proxyStatus.textContent = ctrl.proxyAvailable
  ? 'Local proxy detected (dev/preview server).'
  : 'Local proxy not available — static build. Streams must send CORS headers.';
proxyStatus.className = ctrl.proxyAvailable ? 'ok' : 'warn';

const initial = new URLSearchParams(location.search).get('url');
if (initial) {
  urlInput.value = initial;
  void load(initial);
}

// Exposed for debugging from the console.
Object.assign(window, { abrPlayer: ctrl });
