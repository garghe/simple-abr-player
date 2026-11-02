/**
 * Reads what stream checks need from media segments, without decoding:
 *  - fMP4 / CMAF init segments: tracks, timescales, the real codec string
 *    (from avcC / hvcC / vpcC / av1C / esds…) and sample defaults;
 *  - fMP4 media segments: decode start time, duration and whether the first
 *    sample is a sync sample (keyframe), per track;
 *  - MPEG-2 TS segments: first PTS, duration and whether the first video
 *    frame is a random access point (IDR / IRAP).
 */

interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

function* boxes(v: DataView, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let size = v.getUint32(p);
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    let body = p + 8;
    if (size === 1) {
      size = Number(v.getBigUint64(p + 8));
      body += 8;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < 8 || p + size > end) return;
    yield { type, start: p, body, end: p + size };
    p += size;
  }
}

const child = (v: DataView, parent: Box | { body: number; end: number }, type: string, offset = 0) => {
  for (const b of boxes(v, parent.body + offset, parent.end)) if (b.type === type) return b;
  return null;
};

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const dataView = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);

export interface TrackInfo {
  id: number;
  timescale: number;
  /** 'vide', 'soun', 'text', 'subt'… */
  handler: string;
  /** Sample entry type (the original format for encrypted tracks). */
  fourcc: string;
  /** RFC 6381 codec string read from the configuration, e.g. "avc1.64001f". */
  codec: string;
  width?: number;
  height?: number;
  encrypted: boolean;
  defaultDuration: number;
  defaultFlags: number;
}

export interface InitInfo {
  tracks: TrackInfo[];
}

/** Codec string from an AVC/HEVC/VP9/AV1/AAC… sample entry. */
function codecString(v: DataView, entry: Box, fourcc: string, visual: boolean): string {
  const inner = { body: entry.body + (visual ? 78 : 28), end: entry.end };
  if (fourcc === 'avc1' || fourcc === 'avc3') {
    const c = child(v, inner, 'avcC');
    if (c) return `${fourcc}.${hex2(v.getUint8(c.body + 1))}${hex2(v.getUint8(c.body + 2))}${hex2(v.getUint8(c.body + 3))}`;
  }
  if (fourcc === 'hvc1' || fourcc === 'hev1') {
    const c = child(v, inner, 'hvcC');
    if (c) {
      const b1 = v.getUint8(c.body + 1);
      const space = ['', 'A', 'B', 'C'][b1 >> 6];
      const tier = b1 & 0x20 ? 'H' : 'L';
      const profile = b1 & 0x1f;
      let compat = v.getUint32(c.body + 2);
      // The compatibility flags are written in reverse bit order.
      let rev = 0;
      for (let i = 0; i < 32; i++) {
        rev = (rev << 1) | (compat & 1);
        compat >>>= 1;
      }
      const constraints: string[] = [];
      for (let i = 0; i < 6; i++) constraints.push(hex2(v.getUint8(c.body + 6 + i)).toUpperCase());
      while (constraints.length && constraints[constraints.length - 1] === '00') constraints.pop();
      const level = v.getUint8(c.body + 12);
      return [`${fourcc}.${space}${profile}`, (rev >>> 0).toString(16).toUpperCase(), `${tier}${level}`, ...constraints].join('.');
    }
  }
  if (fourcc === 'vp09' || fourcc === 'vp08') {
    const c = child(v, inner, 'vpcC');
    if (c) {
      const p = c.body + 4; // full box
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${fourcc}.${pad(v.getUint8(p))}.${pad(v.getUint8(p + 1))}.${pad(v.getUint8(p + 2) >> 4)}`;
    }
  }
  if (fourcc === 'av01') {
    const c = child(v, inner, 'av1C');
    if (c) {
      const b1 = v.getUint8(c.body + 1);
      const b2 = v.getUint8(c.body + 2);
      const depth = b2 & 0x20 ? 12 : b2 & 0x40 ? 10 : 8;
      return `av01.${b1 >> 5}.${String(b1 & 0x1f).padStart(2, '0')}${b2 & 0x80 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
    }
  }
  if (fourcc === 'mp4a') {
    const c = child(v, inner, 'esds');
    if (c) {
      // ES_Descriptor (3) > DecoderConfigDescriptor (4) > DecoderSpecificInfo (5).
      const end = c.end;
      let p = c.body + 4;
      let oti = 0;
      let aot = 0;
      while (p < end) {
        const tag = v.getUint8(p++);
        let len = 0;
        for (let i = 0; i < 4; i++) {
          const b = v.getUint8(p++);
          len = (len << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        if (tag === 3) p += 3;
        else if (tag === 4) {
          oti = v.getUint8(p);
          p += 13;
        } else if (tag === 5) {
          aot = v.getUint8(p) >> 3;
          if (aot === 31) aot = 32 + (((v.getUint8(p) & 7) << 3) | (v.getUint8(p + 1) >> 5));
          break;
        } else p += len;
      }
      if (oti) return `mp4a.${oti.toString(16)}${aot ? `.${aot}` : ''}`;
    }
  }
  const names: Record<string, string> = { Opus: 'opus', fLaC: 'flac', 'ac-3': 'ac-3', 'ec-3': 'ec-3', 'ac-4': 'ac-4', wvtt: 'wvtt', stpp: 'stpp' };
  return names[fourcc] ?? fourcc;
}

/** Tracks of an fMP4 init segment, or null if it isn't one. */
export function parseInit(data: Uint8Array): InitInfo | null {
  const v = dataView(data);
  const moov = [...boxes(v, 0, v.byteLength)].find((b) => b.type === 'moov');
  if (!moov) return null;
  const tracks: TrackInfo[] = [];
  const trex = new Map<number, { duration: number; flags: number }>();
  const mvex = child(v, moov, 'mvex');
  if (mvex) {
    for (const b of boxes(v, mvex.body, mvex.end)) {
      if (b.type === 'trex') trex.set(v.getUint32(b.body + 4), { duration: v.getUint32(b.body + 12), flags: v.getUint32(b.body + 20) });
    }
  }
  for (const trak of boxes(v, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;
    const tkhd = child(v, trak, 'tkhd');
    const mdia = child(v, trak, 'mdia');
    if (!tkhd || !mdia) continue;
    const id = v.getUint32(tkhd.body + (v.getUint8(tkhd.body) === 1 ? 20 : 12));
    const mdhd = child(v, mdia, 'mdhd');
    const hdlr = child(v, mdia, 'hdlr');
    const timescale = mdhd ? v.getUint32(mdhd.body + (v.getUint8(mdhd.body) === 1 ? 20 : 12)) : 0;
    const handler = hdlr ? String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + hdlr.body + 8, 4)) : '';
    const minf = child(v, mdia, 'minf');
    const stbl = minf && child(v, minf, 'stbl');
    const stsd = stbl && child(v, stbl, 'stsd');
    const entry = stsd ? [...boxes(v, stsd.body + 8, stsd.end)][0] : undefined;
    let fourcc = entry?.type ?? '';
    const visual = handler === 'vide';
    let encrypted = false;
    if (entry && (fourcc === 'encv' || fourcc === 'enca')) {
      encrypted = true;
      const sinf = child(v, { body: entry.body + (visual ? 78 : 28), end: entry.end }, 'sinf');
      const frma = sinf && child(v, sinf, 'frma');
      if (frma) fourcc = String.fromCharCode(v.getUint8(frma.body), v.getUint8(frma.body + 1), v.getUint8(frma.body + 2), v.getUint8(frma.body + 3));
    }
    const defaults = trex.get(id) ?? { duration: 0, flags: 0 };
    tracks.push({
      id,
      timescale,
      handler,
      fourcc,
      codec: entry ? codecString(v, entry, fourcc, visual) : '',
      width: visual && entry ? v.getUint16(entry.body + 24) : undefined,
      height: visual && entry ? v.getUint16(entry.body + 26) : undefined,
      encrypted,
      defaultDuration: defaults.duration,
      defaultFlags: defaults.flags,
    });
  }
  return { tracks };
}

export interface FragmentTiming {
  trackId: number;
  /** tfdt baseMediaDecodeTime, in track timescale units. */
  decodeTime: number;
  /** Sum of the sample durations, in track timescale units. */
  duration: number;
  samples: number;
  /** First sample is a sync sample (keyframe); null if the segment doesn't say. */
  startsWithKeyframe: boolean | null;
}

const NON_SYNC = 0x10000;

/** Timing per track of an fMP4 media segment (all its fragments merged). */
export function parseFragments(data: Uint8Array, init?: InitInfo | null): FragmentTiming[] {
  const v = dataView(data);
  const out = new Map<number, FragmentTiming>();
  for (const moof of boxes(v, 0, v.byteLength)) {
    if (moof.type !== 'moof') continue;
    for (const traf of boxes(v, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      let trackId = 0;
      let defaultDuration = 0;
      let defaultFlags: number | null = null;
      let decodeTime: number | null = null;
      let duration = 0;
      let samples = 0;
      let firstFlags: number | null = null;
      for (const b of boxes(v, traf.body, traf.end)) {
        if (b.type === 'tfhd') {
          const flags = v.getUint32(b.body) & 0xffffff;
          trackId = v.getUint32(b.body + 4);
          const track = init?.tracks.find((t) => t.id === trackId);
          defaultDuration = track?.defaultDuration ?? 0;
          defaultFlags = track ? track.defaultFlags : null;
          let o = b.body + 8;
          if (flags & 0x01) o += 8;
          if (flags & 0x02) o += 4;
          if (flags & 0x08) {
            defaultDuration = v.getUint32(o);
            o += 4;
          }
          if (flags & 0x10) o += 4;
          if (flags & 0x20) defaultFlags = v.getUint32(o);
        } else if (b.type === 'tfdt') {
          decodeTime = v.getUint8(b.body) === 1 ? Number(v.getBigUint64(b.body + 4)) : v.getUint32(b.body + 4);
        } else if (b.type === 'trun') {
          const flags = v.getUint32(b.body) & 0xffffff;
          const count = v.getUint32(b.body + 4);
          let o = b.body + 8;
          if (flags & 0x01) o += 4;
          let firstSampleFlags: number | null = null;
          if (flags & 0x04) {
            firstSampleFlags = v.getUint32(o);
            o += 4;
          }
          for (let i = 0; i < count; i++) {
            let d = defaultDuration;
            let f = defaultFlags;
            if (flags & 0x100) {
              d = v.getUint32(o);
              o += 4;
            }
            if (flags & 0x200) o += 4;
            if (flags & 0x400) {
              f = v.getUint32(o);
              o += 4;
            }
            if (flags & 0x800) o += 4;
            if (i === 0 && firstSampleFlags !== null) f = firstSampleFlags;
            if (samples === 0 && i === 0) firstFlags = f;
            duration += d;
          }
          samples += count;
        }
      }
      const prev = out.get(trackId);
      if (prev) {
        prev.duration += duration;
        prev.samples += samples;
      } else {
        out.set(trackId, {
          trackId,
          decodeTime: decodeTime ?? 0,
          duration,
          samples,
          startsWithKeyframe: firstFlags === null ? null : !(firstFlags & NON_SYNC),
        });
      }
    }
  }
  return [...out.values()];
}

export interface TsTiming {
  /** First video PTS in seconds (first audio PTS for audio-only segments). */
  start: number;
  /** From the first to the last PTS, plus one frame. */
  duration: number;
  /** First video frame is an IDR / IRAP picture (or flagged as a random access point). */
  startsWithKeyframe: boolean | null;
  video: 'h264' | 'hevc' | null;
}

/** MPEG-2 TS segment timing, or null if it isn't TS. */
export function parseTs(data: Uint8Array): TsTiming | null {
  if (data.length < 188 || data[0] !== 0x47) return null;
  let pmtPid = -1;
  let videoPid = -1;
  let audioPid = -1;
  let video: TsTiming['video'] = null;
  const ptsList: number[] = [];
  let firstPayload: number[] | null = null;
  let collecting = false;
  let rai: boolean | null = null;
  for (let p = 0; p + 188 <= data.length; p += 188) {
    if (data[p] !== 0x47) return null;
    const pusi = (data[p + 1] & 0x40) !== 0;
    const pid = ((data[p + 1] & 0x1f) << 8) | data[p + 2];
    const afc = (data[p + 3] >> 4) & 3;
    let o = p + 4;
    if (afc & 2) {
      const len = data[o];
      if (len > 0 && pid === videoPid && rai === null && pusi) rai = (data[o + 1] & 0x40) !== 0;
      o += 1 + len;
    }
    if (!(afc & 1) || o >= p + 188) continue;
    if (pid === 0 && pusi) {
      o += 1 + data[o];
      pmtPid = ((data[o + 10] & 0x1f) << 8) | data[o + 11];
    } else if (pid === pmtPid && pusi) {
      o += 1 + data[o];
      const sectionLen = ((data[o + 1] & 0x0f) << 8) | data[o + 2];
      const infoLen = ((data[o + 10] & 0x0f) << 8) | data[o + 11];
      let q = o + 12 + infoLen;
      const end = o + 3 + sectionLen - 4;
      while (q + 5 <= end) {
        const type = data[q];
        const esPid = ((data[q + 1] & 0x1f) << 8) | data[q + 2];
        if ((type === 0x1b || type === 0x24) && videoPid < 0) {
          videoPid = esPid;
          video = type === 0x1b ? 'h264' : 'hevc';
        } else if ([0x0f, 0x11, 0x03, 0x04, 0x81, 0x87].includes(type) && audioPid < 0) audioPid = esPid;
        q += 5 + (((data[q + 3] & 0x0f) << 8) | data[q + 4]);
      }
    } else if (pid === (videoPid >= 0 ? videoPid : audioPid) && pid >= 0) {
      if (pusi) {
        if (data[o] === 0 && data[o + 1] === 0 && data[o + 2] === 1 && data[o + 7] & 0x80) {
          const b = data.subarray(o + 9, o + 14);
          const pts = (b[0] & 0x0e) * 2 ** 29 + b[1] * 2 ** 22 + (b[2] & 0xfe) * 2 ** 14 + b[3] * 2 ** 7 + (b[4] >> 1);
          ptsList.push(pts);
        }
        collecting = firstPayload === null;
        if (collecting) firstPayload = [];
        if (collecting) o += 9 + data[o + 8];
      }
      if (collecting && firstPayload && firstPayload.length < 64 * 1024) for (let i = o; i < p + 188; i++) firstPayload.push(data[i]);
    }
  }
  if (!ptsList.length) return null;
  let keyframe: boolean | null = rai;
  if (video && firstPayload) {
    const nal = firstNalTypes(Uint8Array.from(firstPayload), video);
    if (nal.length) keyframe = video === 'h264' ? nal.includes(5) : nal.some((t) => t >= 16 && t <= 21);
  }
  const sorted = [...ptsList].sort((a, b) => a - b);
  const frame = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : 0;
  return {
    start: sorted[0] / 90000,
    duration: (sorted[sorted.length - 1] - sorted[0] + frame) / 90000,
    startsWithKeyframe: keyframe,
    video,
  };
}

/** NAL unit types in an Annex B access unit. */
function firstNalTypes(b: Uint8Array, codec: 'h264' | 'hevc'): number[] {
  const types: number[] = [];
  for (let i = 0; i + 3 < b.length && types.length < 32; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      const h = b[i + 3];
      types.push(codec === 'h264' ? h & 0x1f : (h >> 1) & 0x3f);
      i += 3;
    }
  }
  return types;
}

export interface SegmentTiming {
  /** Seconds, on the segment's own media clock. */
  start: number;
  duration: number;
  startsWithKeyframe: boolean | null;
  format: 'fmp4' | 'ts';
}

/** Video timing (or the first track's) of a media segment, fMP4 or TS. */
export function segmentTiming(data: Uint8Array, init?: InitInfo | null): SegmentTiming | null {
  const ts = parseTs(data);
  if (ts) return { start: ts.start, duration: ts.duration, startsWithKeyframe: ts.startsWithKeyframe, format: 'ts' };
  const frags = parseFragments(data, init);
  if (!frags.length) return null;
  const video = init?.tracks.find((t) => t.handler === 'vide');
  const f = frags.find((x) => x.trackId === video?.id) ?? frags[0];
  const track = init?.tracks.find((t) => t.id === f.trackId);
  if (!track?.timescale) return null;
  return { start: f.decodeTime / track.timescale, duration: f.duration / track.timescale, startsWithKeyframe: f.startsWithKeyframe, format: 'fmp4' };
}

/** Compares declared codec strings (manifest) with the ones read from the media. */
export function compareCodecs(declared: string[], actual: string[]): { codec: string; declared?: string; problem: 'undeclared' | 'differs' }[] {
  const norm = (c: string) => {
    const parts = c.trim().toLowerCase().split('.');
    // vp09: profile.level.bitdepth is what matters; the rest is optional.
    return parts[0].startsWith('vp0') ? parts.slice(0, 4).join('.') : parts.join('.');
  };
  const family = (c: string) => {
    const f = c.trim().toLowerCase().split('.')[0];
    return f === 'avc3' ? 'avc1' : f === 'hev1' ? 'hvc1' : f;
  };
  const out: { codec: string; declared?: string; problem: 'undeclared' | 'differs' }[] = [];
  for (const a of actual) {
    if (!a || ['wvtt', 'stpp'].includes(a)) continue;
    const same = declared.filter((d) => family(d) === family(a));
    if (!same.length) out.push({ codec: a, problem: 'undeclared' });
    else if (!same.some((d) => norm(d) === norm(a))) out.push({ codec: a, declared: same[0], problem: 'differs' });
  }
  return out;
}
