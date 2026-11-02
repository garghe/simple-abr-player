#!/usr/bin/env node
// End-to-end check of the SCTE-35 tools in a real (headless) browser, on the
// bundled samples (no network needed):
//
//   npm run test:e2e:scte            # checks only
//   npm run test:e2e:scte -- --shots # also refreshes the SCTE screenshots
//
// The "health demo" sample (public/samples/scte-issues, made by
// `npm run sample:issues`) has an inserted ad pod and deliberate signalling
// mistakes; the clean DASH sample must pass every check.
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

const vite = await createServer({ root, configFile: join(root, 'vite.config.ts'), server: { port: 5192, strictPort: false }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failures++;
};

async function open(sample, { rate = 4, wait = 11000 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`${base}?url=${encodeURIComponent(`${base}samples/${sample}`)}`);
  await page.waitForFunction(() => window.abrPlayer?.loadedUrl, null, { timeout: 15000 });
  await page.evaluate(async (r) => {
    const v = document.querySelector('video');
    v.muted = true;
    v.playbackRate = r;
    await v.play();
  }, rate);
  await page.waitForTimeout(wait);
  await page.evaluate(() => document.querySelector('video').pause());
  await page.click('button.tab:has-text("SCTE-35")');
  return page;
}

const sub = async (page, name) => {
  await page.click(`.subnav button:has-text("${name}")`);
  await page.waitForTimeout(400);
};
const shot = async (page, name) => {
  if (!shots) return;
  mkdirSync(shotDir, { recursive: true });
  await page.evaluate(() => document.querySelector('#tab-body').scrollTo(0, 0));
  await page.screenshot({ path: join(shotDir, name) });
  console.log(`  saved docs/screenshots/${name}`);
};

try {
  // 1. Health demo: every planted problem is found.
  {
    const page = await open('scte-issues/master.m3u8');
    const codes = await page.evaluate(() => window.abrPlayer.scteHealth().map((i) => `${i.severity}:${i.code}`));
    for (const c of ['error:crc', 'warn:cont-elapsed', 'warn:pod-fill', 'warn:seg-duration', 'warn:break-no-in']) {
      check(`health demo: ${c}`, codes.includes(c), codes.join(', '));
    }
    const pods = await page.evaluate(() => window.abrPlayer.adPods().map((r) => ({ start: r.pod.start, duration: r.pod.duration, fill: r.fill, ads: r.pod.ads.length })));
    check('ad pod found and matched with its break', pods.length === 1 && pods[0].start === 6 && pods[0].ads === 1 && pods[0].duration === 6 && pods[0].fill === -2, JSON.stringify(pods));

    await sub(page, 'Health');
    const healthText = await page.textContent('.scte-health');
    check('Health view lists the issues', /1 error/.test(healthText) && /underfill/.test(healthText), healthText.slice(0, 120));
    await shot(page, 'scte-health.png');

    await sub(page, 'Ad insertion');
    check('Ad insertion view shows the pod', /2\.0 s short/.test(await page.textContent('.scte-ads')));
    await shot(page, 'scte-ads.png');

    await sub(page, 'Timeline');
    const lanes = await page.$$eval('.timeline-svg .lane-label', (els) => els.map((e) => e.textContent));
    check('timeline lanes', ['OUT → IN breaks', 'Placement opp.', 'Advertisement', 'Inserted ads', 'Health issues', 'Quality'].every((l) => lanes.includes(l)), lanes.join(', '));
    await page.click('.timeline-svg .span.pod');
    check('clicking the timeline seeks', Math.abs((await page.evaluate(() => document.querySelector('video').currentTime)) - 6) < 0.5);
    await shot(page, 'scte-timeline.png');

    await sub(page, 'Structure');
    const nested = await page.$$eval('.structure-tree li .structure-tree, .structure-tree li li .structure-item.ad', (els) => els.length);
    const tree = await page.textContent('.scte-structure');
    check('structure nests the ad inside the placement opportunity', nested > 0 && /ISSU0000001H/.test(tree), tree.slice(0, 160));
    await shot(page, 'scte-structure.png');

    // Navigation keys.
    await page.evaluate(() => (document.querySelector('video').currentTime = 0));
    await page.click('#stream-summary');
    const key = async (k) => {
      await page.keyboard.press(k);
      await page.waitForTimeout(250);
      return page.evaluate(() => Math.round(document.querySelector('video').currentTime * 10) / 10);
    };
    check('n jumps to the next marker', (await key('n')) === 6);
    check('s skips the break', Math.abs((await key('s')) - 14) < 0.2);
    check('p goes back to the previous marker', (await key('p')) === 6);
    await page.evaluate(() => (document.querySelector('video').currentTime = 20));
    check('b lands 10 s before the next break', (await key('b')) === 22);

    // CSV export.
    await sub(page, 'Monitor');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export CSV")')]);
    const csv = readFileSync(await download.path(), 'utf8');
    check('CSV export', csv.startsWith('presentation_time_s,') && csv.split('\r\n').length > 8 && /CRC mismatch/.test(csv), download.suggestedFilename());

    // Missing from the 240p playlist shows once that playlist has been read.
    await page.evaluate(async () => {
      const p = window.abrPlayer.player;
      p.configure('abr.enabled', false);
      p.selectVariantTrack(p.getVariantTracks().find((t) => t.height === 240), true);
      document.querySelector('video').currentTime = 0;
    });
    await page.waitForTimeout(3000);
    const missing = await page.evaluate(() => window.abrPlayer.scteHealth().filter((i) => i.code === 'missing-rendition').map((i) => i.detail));
    check('marker missing from the 240p playlist', missing.some((d) => d.includes('240')), missing.join(' | '));
    await page.close();
  }

  // 2. The clean DASH sample passes every check.
  {
    const page = await open('scte-demo/dash.mpd');
    const issues = await page.evaluate(() => window.abrPlayer.scteHealth().map((i) => `${i.severity}:${i.code}`));
    check('clean sample: no errors or warnings', !issues.some((i) => !i.startsWith('info:')), issues.join(', ') || 'none');
    await sub(page, 'Markers');
    await page.click('.scte-table tbody tr:first-child td:nth-child(4) button');
    const detail = await page.textContent('.scte-detail');
    check('marker detail shows splice timing', /Splice timing/.test(detail) && /on boundary/.test(detail) && /6\.000 s PTS/.test(detail));

    // Builder: a preset produces a message that decodes with a valid CRC.
    await sub(page, 'Builder');
    await page.selectOption('.scte-builder select[aria-label="Start from a preset"]', { index: 3 });
    const out = await page.textContent('.builder-out');
    check('builder preset encodes and decodes', /decodes · CRC OK/.test(out) && /Provider Placement Opportunity Start/.test(out) && /#EXT-X-DATERANGE/.test(out), out.slice(0, 100));
    await shot(page, 'scte-builder.png');
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll SCTE checks passed');
process.exit(failures ? 1 : 0);
