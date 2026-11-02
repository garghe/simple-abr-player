#!/usr/bin/env node
// Renders the social link preview (Open Graph image) to public/og-image.png:
//
//   npm run og-image
//
// 1200×630 PNG with the logo, name, tagline and feature chips. LinkedIn, X,
// Slack and others need a PNG/JPG at an absolute URL (see index.html).
// Set CHROMIUM_PATH to use a specific Chromium/Chrome binary.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = `data:image/svg+xml;base64,${readFileSync(join(root, 'public', 'logo.svg')).toString('base64')}`;
const chips = ['Stream health', 'SCTE-35', 'DRM', 'Loudness', 'Alarms'];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, system-ui, sans-serif; color: #0f172a;
  background: radial-gradient(900px 480px at 0% 0%, #e0e7ff, transparent 65%), radial-gradient(800px 480px at 100% 100%, #cffafe, transparent 60%), #f4f6fb;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; text-align: center; }
.brand { display: flex; align-items: center; gap: 26px; }
.brand img { width: 128px; height: 128px; filter: drop-shadow(0 14px 30px rgba(37, 99, 235, 0.35)); }
.brand b { font-size: 92px; font-weight: 800; letter-spacing: -0.035em; }
h1 { font-size: 50px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 800; }
h1 span { background: linear-gradient(135deg, #4f46e5, #06b6d4); -webkit-background-clip: text; color: transparent; }
.chips { display: flex; gap: 12px; }
.chips i { font-style: normal; font-size: 22px; font-weight: 600; color: #334155; background: #fff; border: 1px solid #e3e8f1; border-radius: 999px; padding: 8px 20px; }
.url { font-size: 26px; font-weight: 700; color: #4338ca; }
</style></head><body>
<div class="brand"><img src="${logo}" alt=""><b>PlayProbe</b></div>
<h1>Inspect and monitor <span>DASH &amp; HLS</span> streams</h1>
<div class="chips">${chips.map((c) => `<i>${c}</i>`).join('')}</div>
<div class="url">playprobe.xyz</div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: join(root, 'public', 'og-image.png') });
await browser.close();
console.log('saved public/og-image.png');
