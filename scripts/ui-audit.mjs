#!/usr/bin/env node
// Release check of the UI in a real (headless) browser:
//
//   npm run test:ui            # report problems, exit 1 if any
//   npm run test:ui -- --quick # fewer screen sizes
//
// Loads the bundled samples (on demand, a live copy, SCTE-35 and alarm demos),
// a broken URL and the empty start page, then opens every tab, sub-view and
// panel at phone to desktop sizes in the light and dark themes. Reports:
//   - page errors, console errors and failed same-origin requests
//   - anything that makes the page scroll sideways
//   - text clipped by its box, or spilling out of its card
//   - broken values in the page (NaN, undefined, [object Object], Infinity)
//   - tooltips and the welcome guide placed outside the screen
//
// Set CHROMIUM_PATH to use a specific Chromium/Chrome binary.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');

// A live copy of the bundled DASH sample (as in scripts/screenshots.mjs). Each
// page passes its own start (?start=ms) so every run gets ~25 s of live runway.
const liveSample = {
  name: 'playprobe-live-sample',
  configureServer(s) {
    s.middlewares.use('/samples/scte-demo/live.mpd', (req, res) => {
      const liveStart = new Date(Number(new URL(req.originalUrl ?? req.url, 'http://x').searchParams.get('start')) || Date.now() - 14000);
      const mpd = readFileSync(join(root, 'public', 'samples', 'scte-demo', 'dash.mpd'), 'utf8')
        .replace('type="static"', `type="dynamic" availabilityStartTime="${liveStart.toISOString()}" publishTime="${liveStart.toISOString()}" minimumUpdatePeriod="PT2S" timeShiftBufferDepth="PT30S" suggestedPresentationDelay="PT4S"`)
        .replace(/\s*mediaPresentationDuration="[^"]*"/, '');
      res.setHeader('Content-Type', 'application/dash+xml');
      res.end(mpd);
    });
  },
};

const vite = await createServer({ root, configFile: join(root, 'vite.config.ts'), plugins: [liveSample], server: { port: 5193, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

const SIZES = {
  desktop: { width: 1480, height: 900 },
  laptop: { width: 1280, height: 760 },
  tablet: { width: 1024, height: 768 },
  portrait: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
};
const STREAMS = {
  dash: 'samples/scte-demo/dash.mpd',
  hls: 'samples/scte-demo/master.m3u8',
  scteIssues: 'samples/scte-issues/master.m3u8',
  alarms: 'samples/alarms-demo/master.m3u8',
  live: 'samples/scte-demo/live.mpd',
  broken: 'samples/does-not-exist.mpd',
};
// Which streams get every tab at which sizes (others: dashboard only).
const PLAN = quick
  ? [
      ['dash', 'desktop', 'light', true],
      ['live', 'phone', 'dark', true],
      ['scteIssues', 'tablet', 'dark', true],
      ['broken', 'phone', 'light', false],
      [null, 'phone', 'dark', false],
    ]
  : [
      ['dash', 'desktop', 'light', true],
      ['dash', 'phone', 'dark', true],
      ['dash', 'portrait', 'light', true],
      ['hls', 'laptop', 'dark', true],
      ['scteIssues', 'desktop', 'dark', true],
      ['scteIssues', 'phone', 'light', true],
      ['alarms', 'tablet', 'light', true],
      ['alarms', 'phone', 'dark', true],
      ['live', 'desktop', 'dark', true],
      ['live', 'phone', 'light', true],
      ['live', 'tablet', 'dark', false],
      ['broken', 'desktop', 'light', false],
      ['broken', 'phone', 'dark', false],
      [null, 'desktop', 'dark', false],
      [null, 'phone', 'light', false],
      [null, 'portrait', 'dark', false],
    ];

/** problem key → { kind, detail, where: Set } */
const problems = new Map();
const report = (kind, detail, where) => {
  const key = `${kind}|${detail}`;
  if (!problems.has(key)) problems.set(key, { kind, detail, where: new Set() });
  problems.get(key).where.add(where);
};

/** Runs in the page: layout and content checks of what is on screen now. */
function inspectPage() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const cls = [...e.classList].filter((c) => !/^(odd|ok|warn|out|on|active)$/.test(c)).slice(0, 2).join('.');
      parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls ? `.${cls}` : ''}`);
    }
    return parts.join(' > ');
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden], dialog:not([open])');
  };
  const scrollsX = (el) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if ((o === 'auto' || o === 'scroll') && e !== document.documentElement && e !== document.body) return true;
    }
    return false;
  };
  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);

  // 1. Page scrolls sideways.
  if (document.documentElement.scrollWidth > vw + 1) {
    const culprits = [...document.querySelectorAll('body *')].filter((e) => visible(e) && !scrollsX(e) && e.getBoundingClientRect().right > vw + 1);
    // Report the outermost culprits only.
    const outer = culprits.filter((e) => !culprits.includes(e.parentElement)).slice(0, 5);
    for (const e of outer) out.push(['page scrolls sideways', `${path(e)} ends at ${Math.round(e.getBoundingClientRect().right)} px (screen ${vw})`]);
  }

  // 2. Clipped text: a box that hides part of its own text.
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg, canvas, video, pre, textarea, select, .tooltip')) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    const clipX = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
    const clipY = cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && el.scrollHeight > el.clientHeight + 2;
    if ((clipX && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') || clipY) {
      const how = cs.textOverflow === 'ellipsis' ? 'cut short with …' : 'clipped';
      out.push([`text ${how}`, `${path(el)} "${text(el)}"`]);
    }
  }

  // 3. Text spilling out of its card or out of the screen.
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg, canvas, video, .tooltip, dialog')) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || scrollsX(el)) continue;
    const r = el.getBoundingClientRect();
    const card = el.parentElement?.closest('.card, .fact, .dash-card, .loud-tile, .drm-panel, .settings, .wl-cap, .alarm-tile, .chip-btn, button');
    if (card && card !== el) {
      const c = card.getBoundingClientRect();
      if (r.right > c.right + 2 || r.left < c.left - 2) out.push(['text spills out of its box', `${path(el)} "${text(el)}" (${Math.round(r.right - c.right)} px past ${path(card).split(' > ').pop()})`]);
    }
    if (r.right > vw + 1 && !document.documentElement.scrollWidth) out.push(['text off screen', `${path(el)} "${text(el)}"`]);
  }

  // 4. Broken values.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bad = /\bNaN\b|\bundefined\b|\[object \w+\]|(?<![−-])\bInfinity\b|(?<![_\w])null(?![_\w])/;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest('script, style, pre, textarea, code, .raw, .manifest-view, .log-body') || !visible(p)) continue;
    const m = n.textContent.match(bad);
    if (m) out.push(['broken value on screen', `${path(p)} "${n.textContent.trim().slice(0, 80)}"`]);
  }
  return out;
}

async function settle(page, ms = 350) {
  await page.waitForTimeout(ms);
}

async function audit(streamName, sizeName, theme, allTabs) {
  const size = SIZES[sizeName];
  const where = `${streamName ?? 'start page'} · ${sizeName} ${size.width}px · ${theme}`;
  const page = await browser.newPage({ viewport: size });
  const origin = new URL(base).origin;
  page.on('pageerror', (e) => report('page error', e.message.split('\n')[0], where));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The broken-URL case logs its own expected failures.
    if (streamName === 'broken' && /404|Failed to load|Shaka Error/i.test(t)) return;
    report('console error', t.slice(0, 160), where);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(origin) && !(streamName === 'broken' && r.url().includes('does-not-exist'))) report('failed request', `${r.status()} ${r.url().replace(origin, '')}`, where);
  });
  await page.addInitScript((t) => {
    localStorage.setItem('sap.welcome.v1', 'hide');
    localStorage.setItem('sap.theme.v1', t);
  }, theme);
  const streamUrl = streamName === 'live' ? `${base}${STREAMS.live}?start=${Date.now() - 14000}` : base + STREAMS[streamName];
  await page.goto(streamName ? `${base}?url=${encodeURIComponent(streamUrl)}` : base);

  if (streamName && streamName !== 'broken') {
    await page.waitForFunction(() => window.abrPlayer?.loadedUrl, null, { timeout: 30000 });
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.muted = true;
      v.playbackRate = 2;
      await v.play().catch(() => undefined);
    });
    await page.waitForTimeout(streamName === 'live' ? 7000 : 9000);
  } else {
    await page.waitForTimeout(2500);
  }

  const check = async (state) => {
    for (const [kind, detail] of await page.evaluate(inspectPage)) report(kind, detail, `${where} · ${state}`);
  };

  await check('dashboard');
  if (allTabs) {
    const tabs = await page.$$eval('button.tab .tab-label', (els) => els.map((e) => e.textContent));
    for (const tab of tabs) {
      await page.click(`button.tab:has-text("${tab}")`);
      await settle(page);
      await page.$$eval('#tab-body details', (d) => d.forEach((x) => (x.open = true)));
      const subs = await page.$$eval('#tab-body .subnav button', (els) => els.map((e) => e.textContent.replace(/\d+$/, '').trim()));
      if (!subs.length) await check(tab);
      for (const sub of subs) {
        await page.click(`#tab-body .subnav button:has-text("${sub}")`);
        await settle(page);
        await page.$$eval('#tab-body details', (d) => d.forEach((x) => (x.open = true)));
        await check(`${tab} › ${sub}`);
        // Open the first marker detail in the SCTE-35 list.
        if (tab === 'SCTE-35' && sub === 'Markers') {
          const btn = await page.$('.scte-table tbody tr td button.linklike');
          if (btn) {
            await btn.click();
            await settle(page);
            await check(`${tab} › ${sub} › marker detail`);
          }
        }
      }
    }
    await page.click('button.tab:has-text("Dashboard")');
    await settle(page);
  }

  // Panels from the load bar.
  for (const [btn, name] of [['#drm-btn', 'DRM settings'], ['#settings-btn', 'proxy settings']]) {
    await page.click(btn);
    await settle(page);
    await check(name);
    await page.click(btn);
    await settle(page, 150);
  }

  // Tooltips stay on screen: one near each edge.
  for (const sel of ['button.tab >> nth=0', 'button.tab >> nth=-1', '.fact >> nth=0', '.fact >> nth=-1']) {
    const loc = page.locator(sel).first();
    if (!(await loc.count()) || !(await loc.isVisible())) continue;
    await page.mouse.move(1, 1);
    await loc.hover();
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const t = document.querySelector('#tooltip');
      if (!t || t.hidden) return null;
      const b = t.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, vw: innerWidth, vh: innerHeight };
    });
    if (r && (r.l < 0 || r.r > r.vw || r.t < 0 || r.b > r.vh)) report('tooltip off screen', `${sel} (${Math.round(r.l)}–${Math.round(r.r)} of ${r.vw})`, where);
  }

  // Welcome guide fits the screen.
  await page.mouse.move(1, 1);
  await page.click('#help-btn');
  await settle(page);
  const guide = await page.evaluate(() => {
    const d = document.querySelector('dialog.welcome');
    const r = d.getBoundingClientRect();
    return { open: d.open, l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight };
  });
  if (!guide.open) report('welcome guide', 'does not open from ?', where);
  else if (guide.l < 0 || guide.r > guide.vw || guide.t < 0 || guide.b > guide.vh + 1) report('welcome guide off screen', JSON.stringify(guide), where);
  await check('welcome guide');
  await page.keyboard.press('Escape');

  await page.close();
  process.stdout.write('.');
}

try {
  for (const [s, size, theme, all] of PLAN) await audit(s, size, theme, all);
} finally {
  await browser.close();
  await vite.close();
}

console.log('\n');
const list = [...problems.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
for (const p of list) {
  const where = [...p.where];
  console.log(`✗ ${p.kind}: ${p.detail}\n    ${where.slice(0, 3).join('\n    ')}${where.length > 3 ? `\n    …and ${where.length - 3} more` : ''}`);
}
console.log(list.length ? `\n${list.length} problem(s)` : 'No UI problems found');
process.exit(list.length ? 1 : 0);
