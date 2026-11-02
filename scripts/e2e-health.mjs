#!/usr/bin/env node
// End-to-end check of stream health, rendition alignment and the picture /
// sound alarms in a real (headless) browser, on the bundled samples:
//
//   npm run test:e2e:health            # checks only
//   npm run test:e2e:health -- --shots # also refreshes the screenshots
//
// The "stream health & alarms demo" (public/samples/alarms-demo, made by
// `npm run sample:alarms`) trips every alarm and several stream checks; the
// clean DASH sample must pass.
//
// Set CHROMIUM_PATH to use a specific Chromium/Chrome binary.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv.includes('--shots');
const shotDir = join(root, 'docs', 'screenshots');

const vite = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: 5194, strictPort: false }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};
const shot = async (page, name) => {
  if (!shots) return;
  mkdirSync(shotDir, { recursive: true });
  await page.evaluate(() => document.querySelector('#tab-body').scrollTo(0, 0));
  await page.screenshot({ path: join(shotDir, name) });
  console.log(`  saved docs/screenshots/${name}`);
};

async function open(sample) {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, acceptDownloads: true });
  await page.addInitScript(() => localStorage.setItem('sap.welcome.v1', 'hide'));
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${base}?url=${encodeURIComponent(`${base}samples/${sample}`)}`);
  await page.waitForFunction(() => window.abrPlayer?.loadedUrl, null, { timeout: 20000 });
  return page;
}

const play = (page, rate) =>
  page.evaluate(async (r) => {
    const v = document.querySelector('video');
    v.muted = true;
    v.playbackRate = r;
    await v.play();
  }, rate);

try {
  // 1. Alarms demo: every alarm, the banner, timeline marks, CSV.
  {
    const page = await open('alarms-demo/master.m3u8');
    await page.click('button.tab:has-text("Alarms")');
    await play(page, 4);
    let bannerSeen = '';
    for (let i = 0; i < 90 && !(await page.evaluate(() => document.querySelector('video').ended)); i++) {
      await page.waitForTimeout(250);
      const b = await page.evaluate(() => (document.querySelector('#alarm-banner').hidden ? '' : document.querySelector('#alarm-banner').textContent));
      if (b && !bannerSeen) bannerSeen = b;
    }
    const log = await page.$$eval('.alarms > h3 + div tbody tr td:nth-child(2)', (els) => els.map((e) => e.textContent));
    for (const name of ['Black picture', 'Frozen picture', 'Silence', 'Channel lost', 'Loudness off target', 'True peak over limit', 'Out of phase']) {
      check(`alarm: ${name}`, log.includes(name), log.join(', '));
    }
    check('alarm banner on the video', /BLACK PICTURE/.test(bannerSeen), bannerSeen);
    const marks = await page.evaluate(() => window.abrPlayer.marks.filter((m) => m.kind === 'alarm').length);
    check('alarms on the timeline', marks >= 6, `${marks} marks`);
    await shot(page, 'alarms.png');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.alarms button:has-text("Export CSV")')]);
    const csv = readFileSync(await download.path(), 'utf8');
    check('alarm CSV export', csv.startsWith('start_utc,') && /Frozen picture/.test(csv), download.suggestedFilename());

    // 2. Stream health on the same stream.
    const codes = await page.evaluate(() => window.abrPlayer.streamHealth().map((i) => `${i.severity}:${i.code}`));
    check('health: segments longer than the target duration', codes.includes('error:over-td'), codes.join(', '));
    // The 360p rendition declares the wrong codec level: play some of it.
    await page.evaluate(async () => {
      const p = window.abrPlayer.player;
      p.configure('abr.enabled', false);
      p.selectVariantTrack(p.getVariantTracks().find((t) => t.height === 360), true);
      const v = document.querySelector('video');
      v.currentTime = 2;
      v.playbackRate = 1;
      await v.play();
    });
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => window.abrPlayer.streamHealth().map((i) => `${i.severity}:${i.code}`));
    check('health: wrong codec string and bandwidth on 360p', after.includes('warn:codecs') && after.includes('warn:bandwidth'), after.join(', '));
    await page.click('button.tab:has-text("Health")');
    await page.waitForTimeout(400);
    await shot(page, 'health-stream.png');

    // 3. Rendition alignment: 3 s against 2 s segments.
    await page.click('.subnav button:has-text("Rendition alignment")');
    await page.evaluate(() => (document.querySelector('video').currentTime = 0));
    await page.click('button:has-text("Check alignment at the playhead")');
    await page.waitForFunction(() => window.abrPlayer.alignment, null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const align = await page.evaluate(() => window.abrPlayer.alignment.issues.map((i) => `${i.severity}:${i.code}`));
    check('alignment: boundaries differ between renditions', align.includes('error:align-boundary'), align.join(', '));
    await shot(page, 'health-alignment.png');
    await page.close();
  }

  // 4. The clean sample passes.
  {
    const page = await open('scte-demo/dash.mpd');
    await play(page, 2);
    await page.waitForTimeout(8000);
    const health = await page.evaluate(() => window.abrPlayer.streamHealth().map((i) => `${i.severity}:${i.code}`));
    check('clean sample: no stream problems', health.length === 0, health.join(', ') || 'none');
    const align = await page.evaluate(async () => (await window.abrPlayer.checkAlignment(0, 3)).issues.map((i) => i.code));
    check('clean sample: renditions aligned', align.length === 0, align.join(', ') || 'none');
    await page.click('button.tab:has-text("Alarms")');
    const tiles = await page.$$eval('.alarm-tile', (els) => els.map((e) => e.className));
    check('clean sample: no alarms', tiles.every((c) => c.includes('alarm-ok')), tiles.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll health and alarm checks passed');
process.exit(failures ? 1 : 0);
