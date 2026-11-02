#!/usr/bin/env node
// Builds public/samples/alarms-demo: a 76 s HLS stream (VP9 + Opus, fMP4) that
// trips every picture/sound alarm and several stream health checks.
//
//   0–6 s    normal: moving test pattern, 1 kHz tone around −23 LUFS
//   6–10 s   BLACK picture                       → black alarm (after 2 s)
//   10–18 s  FROZEN picture                      → freeze alarm (after 5 s)
//   12–20 s  SILENCE                             → silence alarm (after 5 s)
//   22–36 s  right channel lost                  → channel alarm (after 10 s)
//   38–62 s  loud (about −3 LUFS) with peaks     → loudness alarm (after 20 s) and true-peak events
//   64–72 s  out of phase (R = −L)               → phase alarm (after 5 s)
//
// Stream health: the 180p rendition has a keyframe every 3 s (segments of
// 3 s against 2 s for 360p: rendition alignment fails) and claims a 2 s
// target duration; the master playlist declares a wrong codec level and a
// too-low BANDWIDTH for 360p.
//
// Requires ffmpeg with libvpx-vp9, libopus and drawtext. Usage: npm run sample:alarms

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'samples', 'alarms-demo');
const D = 76;

const fonts = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'];
const font = fonts.find((f) => existsSync(f));
const label = (t, from, to) =>
  font ? `,drawtext=fontfile='${font.replace(/:/g, '\\:')}':text='${t}':fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-tw)/2:y=h*0.75:enable='between(t,${from},${to})'` : '';

// Video: pattern 0–6, black 6–10, a still frame 10–18, pattern again 18–76.
const video =
  `testsrc2=size=640x360:rate=25:duration=${D}[src];[src]split=3[a][b][c];` +
  `[a]trim=0:6,setpts=PTS-STARTPTS[p1];` +
  `color=black:size=640x360:rate=25:duration=4[p2];` +
  `[b]trim=start=10:duration=0.04,setpts=PTS-STARTPTS,loop=loop=199:size=1:start=0,setpts=N/25/TB[p3];` +
  `[c]trim=18:${D},setpts=PTS-STARTPTS[p4];` +
  `[p1][p2][p3][p4]concat=n=4:v=1:a=0` +
  label('ALARMS DEMO', 0, 6) +
  label('FROZEN PICTURE', 10, 18) +
  label('SILENCE', 18, 20) +
  label('RIGHT CHANNEL LOST', 22, 36) +
  label('TOO LOUD + PEAKS', 38, 62) +
  label('OUT OF PHASE', 64, 72) +
  `,split=2[v1][v2];[v1]scale=640:360[v360];[v2]scale=320:180[v180]`;

// Audio: 1 kHz tone; amplitude 0.07 ≈ −23 LUFS in stereo, 0.99 when loud, 0 when silent.
const amp = `if(between(t,12,20),0,if(between(t,38,62),0.99,0.07))`;
const left = `${amp}*sin(2*PI*1000*t)`;
const right = `if(between(t,22,36),0,if(between(t,64,72),-1,1))*${left}`;

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f), { recursive: true, force: true });

console.log('Encoding with ffmpeg…');
execFileSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc='${left}|${right}':c=stereo:s=48000:d=${D}`,
    '-filter_complex', video,
    '-map', '[v180]', '-map', '[v360]', '-map', '0:a',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
    '-b:v:0', '80k', '-maxrate:v:0', '100k', '-bufsize:v:0', '200k', '-b:v:1', '200k', '-maxrate:v:1', '260k', '-bufsize:v:1', '520k',
    // 180p: keyframes every 3 s; 360p: every 2 s.
    '-force_key_frames:v:0', 'expr:gte(t,n_forced*3)', '-g:v:0', '75', '-keyint_min:v:0', '75',
    '-force_key_frames:v:1', 'expr:gte(t,n_forced*2)', '-g:v:1', '50', '-keyint_min:v:1', '50',
    '-c:a', 'libopus', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'stream_%v/seg_%03d.m4s',
    '-var_stream_map', 'v:0,name:180p v:1,name:360p a:0,name:audio',
    'stream_%v/index.m3u8',
  ],
  { cwd: out, stdio: 'inherit' },
);

// The 180p playlist claims 2 s segments although they are 3 s long.
const p180 = join(out, 'stream_180p', 'index.m3u8');
writeFileSync(p180, readFileSync(p180, 'utf8').replace(/#EXT-X-TARGETDURATION:\d+/, '#EXT-X-TARGETDURATION:2'));

// Hand-written master: wrong codec level for 360p and a BANDWIDTH far below its real bitrate.
writeFileSync(
  join(out, 'master.m3u8'),
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="stream_audio/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=260000,RESOLUTION=320x180,CODECS="vp09.00.11.08,opus",AUDIO="aud"',
    'stream_180p/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=640x360,CODECS="vp09.00.40.08,opus",AUDIO="aud"',
    'stream_360p/index.m3u8',
    '',
  ].join('\n'),
);
console.log(`Wrote ${out}`);
