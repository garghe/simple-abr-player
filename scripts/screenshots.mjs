#!/usr/bin/env node
// Regenerates the README screenshots in docs/screenshots.
//
//   npm run screenshots
//
// Starts the Vite dev server, drives the app with Playwright/Chromium and
// captures each view. Uses the bundled offline sample, plus Shaka's public
// "Angel One" stream when the network allows it.
//
// The bundled sample is VP9/Opus, so it plays in Playwright's open-source
// Chromium. Set CHROMIUM_PATH to use another Chromium/Chrome binary.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
console.log(`Dev server at ${base}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const DASH_SAMPLE = `${base}samples/scte-demo/dash.mpd`;
const HLS_SAMPLE = `${base}samples/scte-demo/master.m3u8`;
const ANGEL_ONE = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';

async function open(url, { width = 1480, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${base}?url=${encodeURIComponent(url)}`);
  await page.waitForFunction(() => window.abrPlayer?.loadedUrl, null, { timeout: 30000 });
  return page;
}

const tab = (page, name) => page.click(`button.tab:has-text("${name}")`);
const seek = (page, t) => page.evaluate((x) => (window.abrPlayer.video.currentTime = x), t);
const shot = async (page, name) => {
  await page.screenshot({ path: join(outDir, name) });
  console.log(`  ✓ ${name}`);
};
const showControls = (page) => page.hover('#video', { position: { x: 200, y: 200 } });

// 1. SCTE-35 view during an ad break (DASH sample).
{
  const page = await open(DASH_SAMPLE);
  await page.waitForTimeout(1500);
  await seek(page, 19);
  await page.waitForTimeout(3500);
  await tab(page, 'SCTE-35');
  await page.click('.scte-table button.linklike:has-text("Provider Placement Opportunity Start")');
  await page.evaluate(() => document.querySelector('#tab-body').scrollTo(0, 0));
  await showControls(page);
  await page.waitForTimeout(400);
  await shot(page, 'scte-dash.png');
  await page.close();
}

// 2. HLS sample: manifest tab with highlighted SCTE tags.
{
  const page = await open(HLS_SAMPLE);
  await page.waitForTimeout(2500);
  await seek(page, 9);
  await page.waitForTimeout(1500);
  await tab(page, 'Manifest');
  const media = await page.$$eval('.toolbar select option', (o) => o.map((x) => x.value).find((v) => v.endsWith('media_1.m3u8')));
  if (media) await page.selectOption('.toolbar select', media);
  await showControls(page);
  await page.waitForTimeout(400);
  await shot(page, 'manifest-hls.png');
  await tab(page, 'Network');
  await page.waitForTimeout(300);
  await shot(page, 'network.png');
  await page.close();
}

// 3. Overview + tracks on a richer public stream (falls back to the sample offline).
{
  let page;
  try {
    page = await open(ANGEL_ONE);
  } catch {
    console.log('  (Angel One unreachable — using the bundled sample)');
    page = await open(DASH_SAMPLE);
  }
  await page.waitForTimeout(9000);
  await page.keyboard.press('i');
  await tab(page, 'Overview');
  await showControls(page);
  await page.waitForTimeout(600);
  await shot(page, 'overview.png');
  await page.keyboard.press('i');
  await tab(page, 'Tracks');
  await page.selectOption('select[aria-label="Subtitles"]', { index: 3 }).catch(() => undefined);
  await showControls(page);
  await page.waitForTimeout(1500);
  await shot(page, 'tracks.png');
  await tab(page, 'Device');
  await page.waitForTimeout(2500);
  await shot(page, 'device.png');
  await page.close();
}

// 4. Audio tab with the 5.1 track (meters + loudness).
{
  const page = await open(DASH_SAMPLE);
  await page.waitForTimeout(1500);
  await page.selectOption('select[aria-label="Audio track"]', { label: 'English · 5.1' }).catch(() =>
    page.selectOption('select[aria-label="Audio track"]', { index: 2 }),
  );
  await page.waitForTimeout(6000);
  await tab(page, 'Audio');
  await showControls(page);
  await page.waitForTimeout(600);
  await shot(page, 'audio.png');
  await page.close();
}

// 5. Load settings (CORS proxy, headers).
{
  const page = await open(DASH_SAMPLE);
  await page.waitForTimeout(1500);
  await page.click('#settings-btn');
  await tab(page, 'Log');
  await page.waitForTimeout(300);
  await shot(page, 'settings.png');
  await page.close();
}

// 6. Light theme.
{
  const page = await open(DASH_SAMPLE);
  await page.waitForTimeout(1500);
  await seek(page, 19);
  await page.waitForTimeout(3000);
  await page.click('#theme-btn'); // System -> Light
  await tab(page, 'SCTE-35');
  await showControls(page);
  await page.waitForTimeout(600);
  await shot(page, 'light.png');
  await page.close();
}

// 7. Phone layout.
{
  const page = await open(DASH_SAMPLE, { width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await seek(page, 7);
  await page.waitForTimeout(1500);
  await tab(page, 'SCTE-35');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'mobile.png'), fullPage: false });
  console.log('  ✓ mobile.png');
  await page.close();
}

await browser.close();
await server.close();
