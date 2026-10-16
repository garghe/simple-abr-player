/**
 * Just enough ISO-BMFF (fMP4 / CMAF) parsing to feed audio samples to
 * WebCodecs: the codec configuration from an init segment, and sample
 * byte ranges and durations from media segments.
 */

interface Box {
  type: string;
  start: number;
  /** First byte after the header. */
  body: number;
  end: number;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'sinf', 'schi']);

function* children(v: DataView, start: number, end: number): Generator<Box> {
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

function find(v: DataView, start: number, end: number, path: string[]): Box | null {
  for (const b of children(v, start, end)) {
    if (b.type !== path[0]) continue;
    if (path.length === 1) return b;
    // stsd and audio sample entries have fixed-size fields before their children.
    const inner = b.type === 'stsd' ? b.body + 8 : b.body;
    const r = find(v, inner, b.end, path.slice(1));
    if (r) return r;
  }
  return null;
}

function findAll(v: DataView, start: number, end: number, type: string): Box[] {
  const out: Box[] = [];
  for (const b of children(v, start, end)) {
    if (b.type === type) out.push(b);
    else if (CONTAINERS.has(b.type)) out.push(...findAll(v, b.body, b.end, type));
  }
  return out;
}

export interface AudioTrackConfig {
  /** WebCodecs codec string, e.g. "opus", "mp4a.40.2", "flac", "ec-3". */
  codec: string;
  sampleRate: number;
  channels: number;
  description?: Uint8Array;
  timescale: number;
  defaultSampleDuration: number;
  defaultSampleSize: number;
  /** Set when the track cannot be decoded here (e.g. encrypted). */
  unsupported?: string;
}

/** Reads an audio init segment (moov). Returns null when it holds no audio track. */
export function parseAudioInit(data: Uint8Array): AudioTrackConfig | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const moov = find(v, 0, v.byteLength, ['moov']);
  if (!moov) return null;
  for (const trak of findAll(v, moov.body, moov.end, 'trak')) {
    const hdlr = find(v, trak.body, trak.end, ['mdia', 'hdlr']);
    if (!hdlr || String.fromCharCode(...data.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'soun') continue;
    const mdhd = find(v, trak.body, trak.end, ['mdia', 'mdhd']);
    const stsd = find(v, trak.body, trak.end, ['mdia', 'minf', 'stbl', 'stsd']);
    if (!mdhd || !stsd) continue;
    const timescale = v.getUint8(mdhd.body) === 1 ? v.getUint32(mdhd.body + 20) : v.getUint32(mdhd.body + 12);
    const entry = children(v, stsd.body + 8, stsd.end).next().value as Box | undefined;
    if (!entry) continue;
    // AudioSampleEntry: 8 reserved/index + 8 reserved + channelcount(2) + samplesize(2) + 4 + samplerate(4, 16.16)
    const channelCount = v.getUint16(entry.body + 16);
    const sampleRate = v.getUint32(entry.body + 24) >>> 16;
    const boxesStart = entry.body + 28;
    const trex = find(v, moov.body, moov.end, ['mvex', 'trex']);
    const base = {
      sampleRate,
      channels: channelCount,
      timescale,
      defaultSampleDuration: trex ? v.getUint32(trex.body + 12) : 0,
      defaultSampleSize: trex ? v.getUint32(trex.body + 16) : 0,
    };
    const child = (type: string) => find(v, boxesStart, entry.end, [type]);

    switch (entry.type) {
      case 'Opus': {
        const dOps = child('dOps');
        if (!dOps) return { ...base, codec: 'opus', unsupported: 'missing dOps box' };
        return { ...base, ...opusConfig(data.subarray(dOps.body, dOps.end)) };
      }
      case 'mp4a': {
        const esds = child('esds');
        const asc = esds ? audioSpecificConfig(data.subarray(esds.body + 4, esds.end)) : null;
        if (!asc) return { ...base, codec: 'mp4a.40.2', unsupported: 'missing AudioSpecificConfig' };
        return { ...base, ...asc };
      }
      case 'fLaC': {
        const dfLa = child('dfLa');
        if (!dfLa) return { ...base, codec: 'flac', unsupported: 'missing dfLa box' };
        const blocks = data.subarray(dfLa.body + 4, dfLa.end);
        const description = new Uint8Array(4 + blocks.length);
        description.set([0x66, 0x4c, 0x61, 0x43]); // "fLaC"
        description.set(blocks, 4);
        return { ...base, codec: 'flac', description };
      }
      case 'ec-3':
      case 'ac-3':
        return { ...base, codec: entry.type };
      case 'enca':
        return { ...base, codec: 'enca', unsupported: 'encrypted audio' };
      default:
        return { ...base, codec: entry.type, unsupported: `codec ${entry.type}` };
    }
  }
  return null;
}

/** dOps (big-endian, ISO BMFF) → OpusHead (little-endian, RFC 7845) for WebCodecs. */
function opusConfig(d: Uint8Array): Pick<AudioTrackConfig, 'codec' | 'channels' | 'sampleRate' | 'description'> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const channels = d[1];
  const family = d[10];
  const head = new Uint8Array(19 + (family ? 2 + channels : 0));
  const hv = new DataView(head.buffer);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
  head[8] = 1;
  head[9] = channels;
  hv.setUint16(10, v.getUint16(2), true); // pre-skip
  hv.setUint32(12, v.getUint32(4), true); // input sample rate
  hv.setInt16(16, v.getInt16(8), true); // output gain
  head[18] = family;
  if (family) head.set(d.subarray(11, 13 + channels), 19);
  // Opus always decodes at 48 kHz.
  return { codec: 'opus', channels, sampleRate: 48000, description: head };
}

/** Extracts the AudioSpecificConfig from an esds ES_Descriptor. */
function audioSpecificConfig(es: Uint8Array): Pick<AudioTrackConfig, 'codec' | 'channels' | 'sampleRate' | 'description'> | null {
  let p = 0;
  const readLen = () => {
    let len = 0;
    for (let i = 0; i < 4; i++) {
      const b = es[p++];
      len = (len << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return len;
  };
  while (p < es.length) {
    const tag = es[p++];
    const len = readLen();
    if (tag === 0x03) {
      // ES_Descriptor: ES_ID(2) + flags(1) [+ optional fields]
      const flags = es[p + 2];
      p += 3;
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + es[p];
      if (flags & 0x20) p += 2;
    } else if (tag === 0x04) {
      p += 13; // DecoderConfigDescriptor fixed part
    } else if (tag === 0x05) {
      const asc = es.slice(p, p + len);
      let objectType = asc[0] >> 3;
      let bit = 5;
      if (objectType === 31) {
        objectType = 32 + (((asc[0] & 0x07) << 3) | (asc[1] >> 5));
        bit = 11;
      }
      const read = (n: number) => {
        let val = 0;
        for (let i = 0; i < n; i++, bit++) val = (val << 1) | ((asc[bit >> 3] >> (7 - (bit & 7))) & 1);
        return val;
      };
      const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const fi = read(4);
      const sampleRate = fi === 15 ? read(24) : (RATES[fi] ?? 48000);
      const cfg = read(4);
      const channels = cfg === 7 ? 8 : cfg || 2;
      return { codec: `mp4a.40.${objectType}`, channels, sampleRate, description: asc };
    } else {
      p += len;
    }
  }
  return null;
}

export interface Mp4Sample {
  offset: number;
  size: number;
  /** In track timescale units. */
  duration: number;
}

/** Sample byte ranges and durations from every moof/traf in a media segment. */
export function parseMediaSamples(data: Uint8Array, cfg: AudioTrackConfig): Mp4Sample[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples: Mp4Sample[] = [];
  for (const moof of children(v, 0, v.byteLength)) {
    if (moof.type !== 'moof') continue;
    for (const traf of children(v, moof.body, moof.end)) {
      if (traf.type !== 'traf') continue;
      let defaultDuration = cfg.defaultSampleDuration;
      let defaultSize = cfg.defaultSampleSize;
      let base = moof.start;
      for (const b of children(v, traf.body, traf.end)) {
        if (b.type === 'tfhd') {
          const flags = v.getUint32(b.body) & 0xffffff;
          let o = b.body + 8;
          if (flags & 0x01) {
            base = Number(v.getBigUint64(o));
            o += 8;
          }
          if (flags & 0x02) o += 4;
          if (flags & 0x08) {
            defaultDuration = v.getUint32(o);
            o += 4;
          }
          if (flags & 0x10) defaultSize = v.getUint32(o);
        } else if (b.type === 'trun') {
          const flags = v.getUint32(b.body) & 0xffffff;
          const count = v.getUint32(b.body + 4);
          let o = b.body + 8;
          let pos = base;
          if (flags & 0x01) {
            pos = base + v.getInt32(o);
            o += 4;
          }
          if (flags & 0x04) o += 4;
          for (let i = 0; i < count; i++) {
            let duration = defaultDuration;
            let size = defaultSize;
            if (flags & 0x100) {
              duration = v.getUint32(o);
              o += 4;
            }
            if (flags & 0x200) {
              size = v.getUint32(o);
              o += 4;
            }
            if (flags & 0x400) o += 4;
            if (flags & 0x800) o += 4;
            samples.push({ offset: pos, size, duration });
            pos += size;
          }
        }
      }
    }
  }
  return samples.filter((s) => s.size > 0 && s.offset + s.size <= data.byteLength);
}
