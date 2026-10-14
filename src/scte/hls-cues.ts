/**
 * Extracts ad-signalling tags from HLS media playlists.
 *
 * Shaka Player only surfaces EXT-X-DATERANGE (and only when the playlist has
 * EXT-X-PROGRAM-DATE-TIME), so the app reads every media playlist response
 * itself and pulls out the common SCTE-35 carriage formats:
 *
 *  - #EXT-X-DATERANGE with SCTE35-OUT / SCTE35-IN / SCTE35-CMD (RFC 8216)
 *  - #EXT-X-CUE-OUT / #EXT-X-CUE-OUT-CONT / #EXT-X-CUE-IN (Adobe / AWS)
 *  - #EXT-X-SCTE35:CUE="..." (Elemental / Anvato)
 *  - #EXT-OATCLS-SCTE35:<base64> (Adobe / Elemental)
 *  - #EXT-X-SPLICEPOINT-SCTE35:<base64> (Adobe)
 */

export type HlsCueKind =
  | 'DATERANGE'
  | 'CUE-OUT'
  | 'CUE-OUT-CONT'
  | 'CUE-IN'
  | 'SCTE35'
  | 'OATCLS-SCTE35'
  | 'SPLICEPOINT-SCTE35';

export interface HlsCue {
  kind: HlsCueKind;
  /** The raw tag line. */
  tag: string;
  attributes: Record<string, string>;
  /** Absolute URI of the segment the tag applies to (the next segment). */
  segmentUri?: string;
  /** Seconds from the start of the playlist to that segment. */
  playlistOffset: number;
  /** Media sequence number of that segment. */
  mediaSequence: number;
  /** Wall-clock time of the cue (DATERANGE START-DATE or segment PDT). */
  date?: Date;
  /** SCTE-35 payload (hex or base64) when the tag carries one. */
  scte35?: string;
  /** Which SCTE35-* attribute carried the payload. */
  scte35Attribute?: 'SCTE35-OUT' | 'SCTE35-IN' | 'SCTE35-CMD';
  /** Advertised duration in seconds. */
  duration?: number;
  /** For CUE-OUT-CONT: seconds already elapsed in the break. */
  elapsed?: number;
  id?: string;
}

export interface HlsPlaylistInfo {
  isMaster: boolean;
  isLive: boolean;
  targetDuration?: number;
  mediaSequence: number;
  cues: HlsCue[];
}

/** Parses an attribute list like `ID="a",DURATION=30,SCTE35-OUT=0xFC..`. */
export function parseAttributeList(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function resolveUri(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseHlsCues(text: string, playlistUri: string): HlsPlaylistInfo {
  const lines = text.split(/\r?\n/);
  const info: HlsPlaylistInfo = {
    isMaster: false,
    isLive: true,
    mediaSequence: 0,
    cues: [],
  };
  if (!lines[0]?.startsWith('#EXTM3U')) return info;

  let pending: HlsCue[] = [];
  let offset = 0;
  let segDuration = 0;
  let sequence = 0;
  let pdt: Date | undefined;

  const flush = (segmentUri: string) => {
    for (const cue of pending) {
      cue.segmentUri = segmentUri;
      cue.playlistOffset = offset;
      cue.mediaSequence = sequence;
      if (!cue.date && pdt) cue.date = new Date(pdt.getTime());
      info.cues.push(cue);
    }
    pending = [];
  };

  const add = (cue: Omit<HlsCue, 'playlistOffset' | 'mediaSequence'>) =>
    pending.push({ ...cue, playlistOffset: offset, mediaSequence: sequence });

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (!line.startsWith('#')) {
      flush(resolveUri(line, playlistUri));
      offset += segDuration;
      if (pdt) pdt = new Date(pdt.getTime() + segDuration * 1000);
      segDuration = 0;
      sequence++;
      continue;
    }

    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1);

    switch (name) {
      case '#EXT-X-STREAM-INF':
        info.isMaster = true;
        break;
      case '#EXT-X-ENDLIST':
        info.isLive = false;
        break;
      case '#EXT-X-PLAYLIST-TYPE':
        if (value === 'VOD') info.isLive = false;
        break;
      case '#EXT-X-TARGETDURATION':
        info.targetDuration = num(value);
        break;
      case '#EXT-X-MEDIA-SEQUENCE':
        info.mediaSequence = sequence = num(value) ?? 0;
        break;
      case '#EXTINF':
        segDuration = num(value.split(',')[0]) ?? 0;
        break;
      case '#EXT-X-PROGRAM-DATE-TIME': {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) pdt = d;
        break;
      }
      case '#EXT-X-DATERANGE': {
        const attrs = parseAttributeList(value);
        const scteAttr = (['SCTE35-OUT', 'SCTE35-IN', 'SCTE35-CMD'] as const).find((a) => attrs[a]);
        const start = attrs['START-DATE'] ? new Date(attrs['START-DATE']) : undefined;
        add({
          kind: 'DATERANGE',
          tag: line,
          attributes: attrs,
          id: attrs.ID,
          date: start && !Number.isNaN(start.getTime()) ? start : undefined,
          scte35: scteAttr ? attrs[scteAttr] : undefined,
          scte35Attribute: scteAttr,
          duration: num(attrs.DURATION) ?? num(attrs['PLANNED-DURATION']),
        });
        break;
      }
      case '#EXT-X-CUE-OUT': {
        const attrs = parseAttributeList(value);
        add({
          kind: 'CUE-OUT',
          tag: line,
          attributes: attrs,
          duration: num(attrs.DURATION) ?? num(value),
        });
        break;
      }
      case '#EXT-X-CUE-OUT-CONT': {
        const attrs = parseAttributeList(value);
        // Variants: "ElapsedTime=5,Duration=30" or "5/30".
        const slash = value.match(/^([\d.]+)\/([\d.]+)/);
        add({
          kind: 'CUE-OUT-CONT',
          tag: line,
          attributes: attrs,
          elapsed: num(attrs.ELAPSEDTIME) ?? num(slash?.[1]),
          duration: num(attrs.DURATION) ?? num(slash?.[2]),
          scte35: attrs.SCTE35,
        });
        break;
      }
      case '#EXT-X-CUE-IN':
        add({ kind: 'CUE-IN', tag: line, attributes: {} });
        break;
      case '#EXT-X-SCTE35': {
        const attrs = parseAttributeList(value);
        add({
          kind: 'SCTE35',
          tag: line,
          attributes: attrs,
          scte35: attrs.CUE,
          duration: num(attrs.DURATION),
          id: attrs.ID,
        });
        break;
      }
      case '#EXT-OATCLS-SCTE35':
        add({ kind: 'OATCLS-SCTE35', tag: line, attributes: {}, scte35: value });
        break;
      case '#EXT-X-SPLICEPOINT-SCTE35':
        add({ kind: 'SPLICEPOINT-SCTE35', tag: line, attributes: {}, scte35: value });
        break;
    }
  }
  // Tags after the last segment (e.g. a CUE-IN at the live edge).
  for (const cue of pending) {
    if (!cue.date && pdt) cue.date = new Date(pdt.getTime());
    info.cues.push(cue);
  }
  return info;
}
