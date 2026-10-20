#!/usr/bin/env node
// End-to-end check of the DRM pipeline in a real (headless) browser.
//
//   npm run test:e2e:drm            # checks only
//   npm run test:e2e:drm -- --shots # also refreshes the DRM screenshots
//
// Headless Chromium has no Widevine or FairPlay, but it has ClearKey, which
// goes through the same EME + license-request path. The script plays Shaka's
// public "Angel One" ClearKey stream against a local test license server and
// checks the generic machinery: license URL, headers, request/response
// formats, the CORS proxy for license POSTs, key statuses, the DRM tab and
// the error hints. It also checks that the Widevine settings in the UI reach
// the player (the browser then reports Widevine as unavailable).
//
// Set CHROMIUM_PATH to use a specific Chromium/Chrome binary.

import { createServer as createHttpServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv.includes('--shots');
const STREAM = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-clearkey/dash.mpd';
const WIDEVINE_STREAM = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd';
const KEYS = { feedf00deedeadbeeff0baadf00dd00d: '00112233445566778899aabbccddeeff' };
const TOKEN = 'test-token';

const b64url = (hex) => Buffer.from(hex, 'hex').toString('base64url');
function clearKeyResponse(requestJson) {
  const kids = JSON.parse(requestJson).kids ?? [];
  const keys = kids
    .map((kid) => Buffer.from(kid, 'base64url').toString('hex'))
    .filter((hex) => KEYS[hex])
    .map((hex) => ({ kty: 'oct', kid: b64url(hex), k: b64url(KEYS[hex]) }));
  return JSON.stringify({ keys, type: 'temporary' });
}

// ---------------------------------------------------------- test license server
//   POST /raw      standard ClearKey request/response, CORS enabled
//   POST /wrapped  needs "Authorization: Bearer test-token", takes
//                  {"challenge": <base64>, ...}, answers {"data":{"license": <base64>}},
//                  and sends no CORS headers (so it only works through the proxy)
const license = createHttpServer(async (req, res) => {
  const body = await new Promise((r) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => r(Buffer.concat(chunks)));
  });
  const cors = req.url.startsWith('/raw');
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    if (req.url.startsWith('/raw')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(clearKeyResponse(body.toString()));
    }
    if (req.url.startsWith('/wrapped')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(403).end('bad token');
      const { challenge, asset } = JSON.parse(body.toString());
      if (asset !== 'angel-one') return res.writeHead(400).end('missing asset');
      const lic = clearKeyResponse(Buffer.from(challenge, 'base64').toString());
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ data: { license: Buffer.from(lic).toString('base64') } }));
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
await new Promise((r) => license.listen(0, '127.0.0.1', r));
const LIC = `http://127.0.0.1:${license.address().port}`;

const vite = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: 5191, strictPort: false }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};

const DRM = (over = {}) => ({
  mode: 'off',
  widevine: {
    licenseUrl: '',
    level: 'auto',
    requestFormat: 'raw',
    template: '{"challenge":"{{challenge}}"}',
    responseFormat: 'auto',
    responseField: 'license',
    ...over.widevine,
  },
  fairplay: {
    licenseUrl: '',
    certificateUrl: '',
    certificateData: '',
    certificateName: '',
    contentId: 'skd-host',
    customContentId: '',
    playback: 'auto',
    requestFormat: 'raw',
    template: '',
    responseFormat: 'auto',
    responseField: 'ckc',
  },
  headers: '',
  useProxy: false,
  ...over,
});

async function playClearKey(page, drm) {
  return page.evaluate(
    async ({ url, drm }) => {
      const c = window.abrPlayer;
      let error = null;
      // License errors arrive after load() has resolved, as player error events.
      c.on('error', (e) => (error ??= { code: e?.code, message: String(e?.message ?? e) }));
      try {
        await c.load({ url, proxyMode: 'off', headers: {}, lowLatency: false, drm });
        c.video.muted = true;
        await c.video.play();
        await new Promise((r) => setTimeout(r, 4000));
      } catch (e) {
        error = { code: e?.code, message: String(e?.message ?? e) };
      }
      const x = c.drm.exchanges.find((e) => e.kind === 'license');
      return {
        error,
        uiMessage: document.querySelector('#player-message')?.hidden ? '' : document.querySelector('#player-message')?.textContent,
        time: c.video.currentTime,
        active: c.activeDrm(),
        exchange: x && { status: x.status, error: x.error, detected: x.detected, proxied: x.proxied, headers: x.requestHeaders, format: x.requestFormat },
        keyStatuses: c.drm.keyStatuses,
        declared: [...c.drm.declared.values()].map((d) => `${d.source}:${d.system}`),
      };
    },
    { url: STREAM, drm },
  );
}

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.abrPlayer?.proxy !== undefined && document.querySelector('#drm-btn span'));
  return page;
}

try {
  // 1. Standard ClearKey license server: raw request/response.
  {
    const page = await newPage();
    const r = await playClearKey(page, DRM({ testKeySystem: { keySystem: 'org.w3.clearkey', licenseUrl: `${LIC}/raw` } }));
    check('raw license exchange plays encrypted content', !r.error && r.time > 2, `t=${r.time?.toFixed(1)} ${r.error ? JSON.stringify(r.error) : ''}`);
    check('license exchange recorded (HTTP 200)', r.exchange?.status === 200, JSON.stringify(r.exchange));
    check('key status usable', Object.values(r.keyStatuses).includes('usable'), JSON.stringify(r.keyStatuses));
    check('protection declared in MPD found', r.declared.some((d) => d.startsWith('MPD:ClearKey')), r.declared.join(', '));
    check('DRM in use reported', r.active?.name === 'ClearKey', JSON.stringify(r.active));
    await page.close();
  }

  // 2. Wrapped JSON request + JSON response field + auth header + license POST via the CORS proxy.
  {
    const page = await newPage();
    const r = await playClearKey(
      page,
      DRM({
        testKeySystem: { keySystem: 'org.w3.clearkey', licenseUrl: `${LIC}/wrapped` },
        headers: `Authorization: Bearer ${TOKEN}`,
        useProxy: true,
        widevine: { requestFormat: 'json', template: '{"challenge":"{{challenge}}","asset":"angel-one"}', responseFormat: 'json', responseField: 'data.license' },
      }),
    );
    check('JSON template + JSON field + header + proxy plays', !r.error && r.time > 2, `t=${r.time?.toFixed(1)} ${r.error ? JSON.stringify(r.error) : ''}`);
    check('license went through the proxy', r.exchange?.proxied === true);
    check('license found via JSON field', r.exchange?.detected === 'JSON field data.license', r.exchange?.detected);
    check('header names logged, values not', JSON.stringify(r.exchange?.headers) === '["Authorization"]');
    if (shots) {
      // The test loads through the controller, so tidy the page like a normal Load would.
      await page.evaluate((u) => {
        document.querySelector('#player-message').hidden = true;
        document.querySelector('#url').value = u;
      }, STREAM);
      await page.click('button.tab:has-text("DRM")');
      await page.waitForTimeout(300);
      await page.click('.drm-exchanges button.linklike');
      await page.evaluate(() => document.querySelector('#tab-body').scrollTo(0, 0));
      await page.hover('#video');
      await page.waitForTimeout(400);
      mkdirSync(join(root, 'docs', 'screenshots'), { recursive: true });
      await page.screenshot({ path: join(root, 'docs', 'screenshots', 'drm-tab.png') });
      console.log('  saved docs/screenshots/drm-tab.png');
    }
    await page.close();
  }

  // 3. Wrong token: 403 with a clear hint.
  {
    const page = await newPage();
    const r = await playClearKey(
      page,
      DRM({
        testKeySystem: { keySystem: 'org.w3.clearkey', licenseUrl: `${LIC}/wrapped` },
        headers: 'Authorization: Bearer wrong',
        useProxy: true,
        widevine: { requestFormat: 'json', template: '{"challenge":"{{challenge}}","asset":"angel-one"}', responseFormat: 'json', responseField: 'data.license' },
      }),
    );
    check('wrong token fails with 6007', r.error?.code === 6007, JSON.stringify(r.error));
    check('403 recorded in the license log', r.exchange?.status === 403, JSON.stringify(r.exchange));
    check('UI explains the 403', /refused the request \(HTTP 403\)/.test(r.uiMessage ?? ''), (r.uiMessage ?? '').slice(0, 160));
    await page.close();
  }

  // 4. UI path: Widevine settings typed into the panel reach the player.
  {
    const page = await newPage();
    await page.click('#drm-btn');
    await page.click('.drm-mode button:has-text("Widevine")');
    await page.fill('input[placeholder="https://license.example.com/widevine"]', 'https://cwip-shaka-proxy.appspot.com/no_auth');
    await page.fill('#url', WIDEVINE_STREAM);
    await page.click('#load-btn');
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => ({
      message: document.querySelector('#player-message')?.textContent ?? '',
      log: window.abrPlayer.log.map((l) => l.message).join(' | '),
      button: document.querySelector('#drm-btn').textContent,
    }));
    const hasWidevine = await page.evaluate(async () => {
      try {
        await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]);
        return true;
      } catch {
        return false;
      }
    });
    check('Widevine settings from the UI are applied', r.log.includes('DRM: Widevine configured'), r.log.slice(0, 200));
    check('header button shows the DRM mode', r.button.includes('Widevine'), r.button);
    if (!hasWidevine) check('no Widevine here: clear explanation shown', /Widevine needs Chrome/.test(r.message), r.message.slice(0, 160));
    if (shots) {
      await page.evaluate(() => document.querySelector('#player-message').setAttribute('hidden', ''));
      await page.screenshot({ path: join(root, 'docs', 'screenshots', 'drm-settings.png'), clip: { x: 0, y: 0, width: 1480, height: 520 } });
      console.log('  saved docs/screenshots/drm-settings.png');
    }
    await page.close();
  }

  // 5. Profiles (save, reload, restore) and the Widevine test-stream preset.
  {
    const page = await newPage();
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'QA FairPlay' : undefined));
    await page.click('#drm-btn');
    await page.click('.drm-mode button:has-text("FairPlay")');
    await page.fill('input[placeholder="https://license.example.com/fairplay"]', 'https://lic.example.com/fps');
    await page.fill('input[placeholder="https://license.example.com/fairplay.cer"]', 'https://lic.example.com/fps.cer');
    await page.fill('.drm-bottom textarea', 'Authorization: Bearer abc');
    await page.fill('#url', 'https://cdn.example.com/fp/master.m3u8');
    await page.click('button:has-text("Save as…")');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#drm-btn span'));
    const before = await page.evaluate(() => document.querySelector('#drm-btn').textContent);
    await page.click('#drm-btn');
    await page.selectOption('select[aria-label="Saved DRM profile"]', 'QA FairPlay');
    const after = await page.evaluate(() => ({
      url: document.querySelector('#url').value,
      lic: document.querySelector('input[placeholder="https://license.example.com/fairplay"]').value,
      headers: document.querySelector('.drm-bottom textarea').value,
      button: document.querySelector('#drm-btn').textContent,
    }));
    check('settings are not kept after reload unless "Remember" is ticked', before.trim() === 'DRM', before);
    check('profile restores DRM settings and URL', after.url.endsWith('/fp/master.m3u8') && after.lic === 'https://lic.example.com/fps' && after.headers.includes('Bearer abc') && after.button.includes('FairPlay'), JSON.stringify(after));
    await page.selectOption('#presets', { label: 'Angel One — DASH Widevine (Google test license server)' });
    await page.waitForTimeout(500);
    const preset = await page.evaluate(() => ({
      mode: document.querySelector('#drm-btn').textContent,
      lic: document.querySelector('input[placeholder="https://license.example.com/widevine"]').value,
    }));
    check('Widevine preset fills the license server', preset.mode.includes('Widevine') && preset.lic.includes('cwip-shaka-proxy'), JSON.stringify(preset));
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
  license.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll DRM checks passed');
process.exit(failures ? 1 : 0);
