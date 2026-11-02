#!/usr/bin/env node
// Builds public/samples/scte-issues: an HLS stream made from the bundled
// scte-demo segments, with a server-side inserted ad pod and deliberate
// signalling mistakes, to show the SCTE-35 Health, Ad insertion, Timeline
// and Structure views. No ffmpeg needed (run `npm run sample` first if
// public/samples/scte-demo is missing).
//
//   6 s  Break 1: DATERANGE SCTE35-OUT + CUE-OUT 8 s, filled by a 6 s ad pod
//        (segments from samples/scte-issues/ads, between discontinuities):
//        underfill. One CUE-OUT-CONT states the wrong elapsed time.
//  14 s  CUE-IN.
//  16 s  Break 2: time_signal Provider Placement Opportunity Start (2 s) with
//        a Provider Advertisement Start inside it; the end signal comes after
//        4 s. Missing from the 240p playlist. (The scte-demo segments also
//        carry their own in-band placement opportunity at 20–26 s.)
//  32 s  Break 3: CUE-OUT without a duration or an IN, with an OATCLS whose
//        CRC is broken.
//
// Usage: node scripts/make-issues-sample.mjs

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeScte35, toBase64, toHex } from './lib/scte35-encode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'samples', 'scte-demo');
const out = join(root, 'public', 'samples', 'scte-issues');
if (!existsSync(join(src, 'media_0.m3u8'))) throw new Error('Run `npm run sample` first: public/samples/scte-demo is missing');
mkdirSync(join(out, 'ads'), { recursive: true });

const PDT = Date.parse('2026-01-01T00:00:00.000Z');
const date = (s) => new Date(PDT + s * 1000).toISOString();
const AD_SEGMENTS = [4, 5, 6]; // 6–12 s, from ads/
const STREAMS = [
  { file: 'media_0.m3u8', stream: 0, hasBreak2: false },
  { file: 'media_1.m3u8', stream: 1, hasBreak2: true },
  { file: 'media_2.m3u8', stream: 2, hasBreak2: true },
];

const break1 = encodeScte35({ command: 'splice_insert', pts: 6, insert: { eventId: 3001, out: true, duration: 8 } });
const poStart = encodeScte35({ command: 'time_signal', pts: 16, segmentation: { eventId: 3002, typeId: 0x34, duration: 2, upidType: 0x09, upid: 'SIGNAL:issues-po-1' } });
const adStart = encodeScte35({ command: 'time_signal', pts: 16, segmentation: { eventId: 3003, typeId: 0x30, duration: 2, upidType: 0x03, upid: 'ISSU0000001H' } });
const poEnd = encodeScte35({ command: 'time_signal', pts: 20, segmentation: { eventId: 3002, typeId: 0x35, upidType: 0x09, upid: 'SIGNAL:issues-po-1' } });
const broken = encodeScte35({ command: 'splice_insert', pts: 32, insert: { eventId: 3004, out: true } });
broken[broken.length - 6] ^= 0x5a; // corrupt the message so its CRC no longer matches

/** Tags placed before segment n (1-based, 2 s each: segment n starts at 2(n-1) s). */
function tagsBefore(n, hasBreak2) {
  const t = [];
  if (n === 4) t.push(`#EXT-X-DATERANGE:ID="issues-1",START-DATE="${date(6)}",PLANNED-DURATION=8,SCTE35-OUT=${toHex(break1)}`, '#EXT-X-CUE-OUT:DURATION=8');
  if (n === 5) t.push('#EXT-X-CUE-OUT-CONT:ElapsedTime=2,Duration=8');
  if (n === 6) t.push('#EXT-X-CUE-OUT-CONT:ElapsedTime=7,Duration=8'); // wrong: 4 s have elapsed
  if (n === 7) t.push('#EXT-X-CUE-OUT-CONT:ElapsedTime=6,Duration=8');
  if (n === 8) t.push('#EXT-X-CUE-IN');
  if (hasBreak2 && n === 9) t.push(`#EXT-OATCLS-SCTE35:${toBase64(poStart)}`, `#EXT-X-SCTE35:CUE="${toBase64(adStart)}"`);
  if (hasBreak2 && n === 11) t.push(`#EXT-OATCLS-SCTE35:${toBase64(poEnd)}`);
  if (n === 17) t.push('#EXT-X-CUE-OUT', `#EXT-OATCLS-SCTE35:${toBase64(broken)}`);
  return t;
}

for (const { file, stream, hasBreak2 } of STREAMS) {
  const lines = readFileSync(join(src, file), 'utf8').split(/\r?\n/);
  const header = [];
  const segments = [];
  let extinf = null;
  for (const line of lines) {
    if (/^#EXT-X-(DATERANGE|CUE-OUT|CUE-OUT-CONT|CUE-IN|SCTE35|SPLICEPOINT)|^#EXT-OATCLS/.test(line) || line === '#EXT-X-ENDLIST' || !line.trim()) continue;
    if (line.startsWith('#EXTINF')) extinf = line;
    else if (!line.startsWith('#')) {
      segments.push({ extinf, uri: line });
      extinf = null;
    } else if (!segments.length) header.push(line.replace(/URI="([^"]+)"/, 'URI="../scte-demo/$1"'));
  }
  const body = [];
  segments.forEach((s, i) => {
    const n = i + 1;
    if (n === AD_SEGMENTS[0]) body.push('#EXT-X-DISCONTINUITY', `#EXT-X-MAP:URI="ads/init-stream${stream}.m4s"`);
    if (n === AD_SEGMENTS[AD_SEGMENTS.length - 1] + 1) body.push('#EXT-X-DISCONTINUITY', `#EXT-X-MAP:URI="../scte-demo/init-stream${stream}.m4s"`);
    body.push(...tagsBefore(n, hasBreak2), s.extinf);
    if (AD_SEGMENTS.includes(n)) {
      copyFileSync(join(src, s.uri), join(out, 'ads', s.uri));
      body.push(`ads/${s.uri}`);
    } else {
      body.push(`../scte-demo/${s.uri}`);
    }
  });
  copyFileSync(join(src, `init-stream${stream}.m4s`), join(out, 'ads', `init-stream${stream}.m4s`));
  writeFileSync(join(out, file), [...header, ...body, '#EXT-X-ENDLIST', ''].join('\n'));
}

writeFileSync(
  join(out, 'master.m3u8'),
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="media_2.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=340000,RESOLUTION=426x240,CODECS="vp09.00.20.08,opus",AUDIO="aud"',
    'media_0.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=610000,RESOLUTION=854x480,CODECS="vp09.00.30.08,opus",AUDIO="aud"',
    'media_1.m3u8',
    '',
  ].join('\n'),
);
console.log(`Wrote ${out}`);
