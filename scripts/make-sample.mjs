#!/usr/bin/env node
// Builds the bundled offline sample in public/samples/scte-demo:
//   - 40 s test pattern, VP9 in fMP4 at 240p and 480p, 2 s segments
//   - Three Opus audio tracks: English and Italian stereo (440 / 660 Hz beeps)
//     and English 5.1 (a different tone and level on each channel)
//   - English and Italian WebVTT subtitles
//   - One set of CMAF segments shared by a DASH MPD and an HLS master playlist
//   - SCTE-35 markers in every common carriage format:
//       DASH: Period <EventStream> (xml+bin) at 6 s (OUT) and 14 s (IN)
//       DASH + HLS: in-band emsg (urn:scte:scte35:2013:bin) at 20 s and 26 s
//       HLS: EXT-X-DATERANGE SCTE35-OUT + EXT-X-CUE-OUT / CUE-OUT-CONT / CUE-IN
//
// Requires ffmpeg with libvpx-vp9 and libopus. VP9/Opus are used (rather than
// H.264/AAC) so the sample also plays in open-source Chromium builds.
//
// Usage: npm run sample

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeScte35, toBase64, toHex } from './lib/scte35-encode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'samples', 'scte-demo');
const DURATION = 40;
const SEG = 2;
const PDT_BASE = Date.parse('2026-01-01T00:00:00.000Z');

const BREAK1 = { start: 6, duration: 8, eventId: 1001 }; // splice_insert via EventStream / DATERANGE
const BREAK2 = { start: 20, duration: 6, eventId: 2001 }; // time_signal via emsg

// ------------------------------------------------------------------ encode

// 5.1 test signal (Web Audio channel order L R C LFE Ls Rs): a different tone
// and level per channel, each slowly pulsing so the meters move:
//   L/R 440/554 Hz ≈ -20 dBFS, C 1 kHz ≈ -16 dBFS (dialogue), LFE 50 Hz ≈ -22,
//   Ls/Rs 300/350 Hz ≈ -28 dBFS.
const pulse = (rate, phase) => `(0.55+0.45*abs(sin(2*PI*${rate}*t+${phase})))`;
const SURROUND = [
  `0.1*${pulse(0.5, 0)}*sin(2*PI*440*t)`,
  `0.1*${pulse(0.5, 1)}*sin(2*PI*554*t)`,
  `0.16*${pulse(0.33, 2)}*sin(2*PI*1000*t)`,
  `0.08*${pulse(0.25, 0)}*sin(2*PI*50*t)`,
  `0.04*${pulse(0.2, 1)}*sin(2*PI*300*t)`,
  `0.04*${pulse(0.2, 2)}*sin(2*PI*350*t)`,
].join('|');

const fonts = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
];
const font = fonts.find((f) => existsSync(f));
const text = (t, extra = '') =>
  font
    ? `,drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='${t}':fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8${extra}`
    : '';
const adText = (b, label) =>
  text(label, `:fontsize=h/12:x=(w-tw)/2:y=h*0.72:fontcolor=0xF59E0B:enable='between(t,${b.start},${b.start + b.duration})'`);
const common = `${text('SCTE-35 DEMO', ':fontsize=h/14:x=(w-tw)/2:y=h*0.08')}${adText(BREAK1, 'AD BREAK 1 - splice_insert')}${adText(BREAK2, 'AD BREAK 2 - time_signal')}`;

// Empty the folder rather than deleting it, so a running dev server keeps serving it.
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f), { recursive: true, force: true });

console.log('Encoding with ffmpeg…');
execFileSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=854x480:rate=25:duration=${DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:beep_factor=4:duration=${DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=660:beep_factor=2:duration=${DURATION}`,
    '-f', 'lavfi', '-i', `aevalsrc='${SURROUND}':c=5.1:s=48000:d=${DURATION}`,
    '-filter_complex',
    `[0:v]null${common}[base];[base]split=2[a][b];` +
      `[a]scale=426:240${text('240p', ':fontsize=h/14:x=w-tw-12:y=h-th-12')}[v240];` +
      `[b]scale=854:480${text('480p', ':fontsize=h/14:x=w-tw-12:y=h-th-12')}[v480]`,
    '-map', '[v240]', '-map', '[v480]', '-map', '1:a', '-map', '2:a', '-map', '3:a',
    '-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1',
    '-g', '50', '-keyint_min', '50',
    '-b:v:0', '180k', '-maxrate:v:0', '240k', '-b:v:1', '450k', '-maxrate:v:1', '600k',
    '-c:a', 'libopus', '-b:a', '48k', '-ac:a:0', '2', '-ac:a:1', '2',
    // 5.1 Opus needs channel mapping family 1.
    '-b:a:2', '160k', '-mapping_family:a:2', '1',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=ita', '-metadata:s:a:2', 'language=eng',
    '-f', 'dash', '-seg_duration', String(SEG), '-use_template', '1', '-use_timeline', '0',
    '-dash_segment_type', 'mp4', '-hls_playlist', '1',
    '-adaptation_sets', 'id=0,streams=0,1 id=1,streams=2 id=2,streams=3 id=3,streams=4',
    'dash.mpd',
  ],
  { cwd: out, stdio: 'inherit' },
);

// --------------------------------------------------------------- SCTE-35

const b64 = (o) => toBase64(encodeScte35(o));
const break1Out = { command: 'splice_insert', pts: BREAK1.start, insert: { eventId: BREAK1.eventId, out: true, duration: BREAK1.duration } };
const break1In = { command: 'splice_insert', pts: BREAK1.start + BREAK1.duration, insert: { eventId: BREAK1.eventId + 1, out: false } };
const break2Start = {
  command: 'time_signal',
  pts: BREAK2.start,
  segmentation: { eventId: BREAK2.eventId, typeId: 0x34, duration: BREAK2.duration, upidType: 0x03, upid: 'DEMO0000001H' },
};
const break2End = {
  command: 'time_signal',
  pts: BREAK2.start + BREAK2.duration,
  segmentation: { eventId: BREAK2.eventId, typeId: 0x35, upidType: 0x03, upid: 'DEMO0000001H' },
};

// In-band emsg (version 1, absolute presentation time) before the first moof.
function emsgBox({ id, time, duration, data }) {
  const scheme = Buffer.from('urn:scte:scte35:2013:bin\0');
  const value = Buffer.from('1\0');
  const body = Buffer.alloc(4 + 4 + 8 + 4 + 4);
  let o = 0;
  body.writeUInt32BE(0x01000000, o); o += 4; // version 1, flags 0
  body.writeUInt32BE(90000, o); o += 4; // timescale
  body.writeBigUInt64BE(BigInt(Math.round(time * 90000)), o); o += 8;
  body.writeUInt32BE(Math.round(duration * 90000), o); o += 4;
  body.writeUInt32BE(id, o);
  const payload = Buffer.concat([body, scheme, value, Buffer.from(data)]);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write('emsg', 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function injectEmsg(file, box) {
  const seg = readFileSync(file);
  let pos = 0;
  while (pos + 8 <= seg.length) {
    const size = seg.readUInt32BE(pos);
    if (seg.toString('ascii', pos + 4, pos + 8) === 'moof') {
      writeFileSync(file, Buffer.concat([seg.subarray(0, pos), box, seg.subarray(pos)]));
      return;
    }
    if (size < 8) break;
    pos += size;
  }
  throw new Error(`No moof in ${file}`);
}

const segNumber = (t) => Math.floor(t / SEG) + 1;
for (const [cue, time, duration] of [
  [break2Start, BREAK2.start, BREAK2.duration],
  [break2End, BREAK2.start + BREAK2.duration, 0],
]) {
  const box = emsgBox({ id: cue.segmentation.eventId * 10 + cue.segmentation.typeId, time, duration, data: encodeScte35(cue) });
  for (const stream of [0, 1]) {
    injectEmsg(join(out, `chunk-stream${stream}-${String(segNumber(time)).padStart(5, '0')}.m4s`), box);
  }
}

// ------------------------------------------------------------- subtitles

const subs = {
  en: ['Programme content', 'Ad break 1: splice_insert OUT (DASH EventStream / HLS DATERANGE + CUE-OUT)', 'Back to the programme (splice_insert IN / CUE-IN)', 'Ad break 2: time_signal, Provider Placement Opportunity (in-band emsg)', 'Back to the programme', 'End of the demo'],
  it: ['Contenuto del programma', 'Pausa pubblicitaria 1: splice_insert OUT', 'Ritorno al programma (splice_insert IN)', 'Pausa pubblicitaria 2: time_signal (emsg)', 'Ritorno al programma', 'Fine della demo'],
};
const vttTime = (t) => `00:00:${String(Math.floor(t)).padStart(2, '0')}.${String(Math.round((t % 1) * 1000)).padStart(3, '0')}`;
const cueTimes = [
  [0.5, BREAK1.start],
  [BREAK1.start, BREAK1.start + BREAK1.duration],
  [BREAK1.start + BREAK1.duration, BREAK2.start],
  [BREAK2.start, BREAK2.start + BREAK2.duration],
  [BREAK2.start + BREAK2.duration, DURATION - 4],
  [DURATION - 4, DURATION - 0.5],
];
for (const [lang, lines] of Object.entries(subs)) {
  const body = cueTimes.map(([a, b], i) => `${i + 1}\n${vttTime(a)} --> ${vttTime(b)}\n${lines[i]}\n`).join('\n');
  writeFileSync(join(out, `subs_${lang}.vtt`), `WEBVTT\n\n${body}`);
  writeFileSync(
    join(out, `subs_${lang}.m3u8`),
    `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:${DURATION}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:${DURATION}.0,\nsubs_${lang}.vtt\n#EXT-X-ENDLIST\n`,
  );
}

// ------------------------------------------------------------------- DASH

let mpd = readFileSync(join(out, 'dash.mpd'), 'utf8');
const signal = (o) => `<Signal xmlns="http://www.scte.org/schemas/35/2016"><Binary>${b64(o)}</Binary></Signal>`;
const eventStream = `
		<EventStream schemeIdUri="urn:scte:scte35:2014:xml+bin" timescale="90000">
			<Event presentationTime="${BREAK1.start * 90000}" duration="${BREAK1.duration * 90000}" id="${BREAK1.eventId}">${signal(break1Out)}</Event>
			<Event presentationTime="${(BREAK1.start + BREAK1.duration) * 90000}" duration="0" id="${BREAK1.eventId + 1}">${signal(break1In)}</Event>
		</EventStream>`;
const textSets = ['en', 'it']
  .map(
    (lang, i) => `
		<AdaptationSet id="${10 + i}" contentType="text" mimeType="text/vtt" lang="${lang}">
			<Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle"/>
			<Representation id="subs_${lang}" bandwidth="256">
				<BaseURL>subs_${lang}.vtt</BaseURL>
			</Representation>
		</AdaptationSet>`,
  )
  .join('');
mpd = mpd
  .replace(/<ProgramInformation>\s*<\/ProgramInformation>/, '<ProgramInformation><Title>SCTE-35 demo (PlayProbe)</Title></ProgramInformation>')
  .replace(/\s*<ServiceDescription id="0">\s*<\/ServiceDescription>/, '')
  .replace(/(<Period[^>]*>)/, `$1${eventStream}`)
  .replace(
    /(<AdaptationSet id="0" contentType="video"[^>]*>)/,
    '$1\n\t\t\t<InbandEventStream schemeIdUri="urn:scte:scte35:2013:bin" value="1"/>',
  )
  .replace(/(<\/AdaptationSet>)(\s*<\/Period>)/, `$1${textSets}$2`);
writeFileSync(join(out, 'dash.mpd'), mpd);

// -------------------------------------------------------------------- HLS

const iso = (t) => new Date(PDT_BASE + t * 1000).toISOString();
const daterange = `#EXT-X-DATERANGE:ID="splice-${BREAK1.eventId}",CLASS="urn:scte:scte35:2014:bin",START-DATE="${iso(BREAK1.start)}",PLANNED-DURATION=${BREAK1.duration}.0,SCTE35-OUT=${toHex(encodeScte35(break1Out))}`;

for (const file of readdirSync(out).filter((f) => /^media_\d+\.m3u8$/.test(f))) {
  const lines = readFileSync(join(out, file), 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#EXT-X-PROGRAM-DATE-TIME'));
  const result = [];
  let t = 0;
  let duration = 0;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP')) {
      result.push('#EXT-X-PLAYLIST-TYPE:VOD', `#EXT-X-PROGRAM-DATE-TIME:${iso(0)}`, line);
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      duration = parseFloat(line.slice(8));
      if (Math.abs(t - BREAK1.start) < 0.01) result.push(daterange, `#EXT-X-CUE-OUT:DURATION=${BREAK1.duration}`);
      else if (t > BREAK1.start && t < BREAK1.start + BREAK1.duration) {
        result.push(`#EXT-X-CUE-OUT-CONT:ElapsedTime=${t - BREAK1.start},Duration=${BREAK1.duration}`);
      } else if (Math.abs(t - (BREAK1.start + BREAK1.duration)) < 0.01) result.push('#EXT-X-CUE-IN');
    }
    result.push(line);
    if (line && !line.startsWith('#')) t += duration;
  }
  writeFileSync(join(out, file), result.join('\n'));
}

const master = readFileSync(join(out, 'master.m3u8'), 'utf8');
const variants = [...master.matchAll(/#EXT-X-STREAM-INF:(.*)\n(.*)/g)];
writeFileSync(
  join(out, 'master.m3u8'),
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="media_2.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Italiano",LANGUAGE="it",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="2",URI="media_3.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English 5.1",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="6",URI="media_4.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs_en.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Italiano",LANGUAGE="it",DEFAULT=NO,AUTOSELECT=YES,URI="subs_it.m3u8"',
    ...variants.map(([, attrs, uri]) => `#EXT-X-STREAM-INF:${attrs.replace(/AUDIO="[^"]+"/, 'AUDIO="aud",SUBTITLES="subs"')}\n${uri}`),
    '',
  ].join('\n'),
);

console.log(`Sample written to ${out}`);
