import { fromBase64, toHex } from './transform';

/**
 * Reads what protection a stream declares, from the MPD, HLS playlists and
 * init segments: DRM systems, key IDs, schemes and decoded PSSH boxes.
 */

export const SYSTEM_IDS: Record<string, string> = {
  edef8ba979d64acea3c827dcd51d21ed: 'Widevine',
  '94ce86fb07ff4f43adb893d2fa968ca2': 'FairPlay',
  '9a04f07998404286ab92e65be0885f95': 'PlayReady',
  '1077efecc0b24d02ace33c1e52e2fb4b': 'ClearKey (W3C common)',
  e2719d58a985b3c9781ab030af78d30e: 'ClearKey (DASH-IF)',
  '5e629af538da4063897797ffbd9902d4': 'Marlin',
  adb41c242dbf4a6d958b4457c0d27b95: 'Nagra',
  '80a6be7e14484c379e70d5aebe04c8d2': 'Irdeto',
  '9a27dd82fde247258cbc4234aa06ec09': 'Verimatrix VCAS',
  '3ea8778f77424bf9b18be834b2acbd47': 'ChinaDRM',
};

export const systemName = (id: string): string => SYSTEM_IDS[id.replace(/-/g, '').toLowerCase()] ?? `urn:uuid:${id}`;

export const formatKid = (hex: string): string => {
  const h = hex.replace(/-/g, '').toLowerCase();
  return h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : h;
};

export interface WidevinePsshData {
  keyIds: string[];
  provider?: string;
  contentId?: string;
  protectionScheme?: string;
}

/** Fields of a PlayReady header (WRMHEADER) we show. */
export interface PlayReadyHeader {
  /** WRMHEADER version, e.g. 4.0.0.0 or 4.3.0.0. */
  version: string;
  /** Key IDs as CENC (big-endian) hex. */
  keyIds: string[];
  /** AESCTR (cenc) or AESCBC (cbcs). */
  algorithm?: string;
  /** License acquisition URL. */
  laUrl?: string;
  luiUrl?: string;
  dsId?: string;
  customAttributes?: string;
}

export interface Pssh {
  systemId: string;
  system: string;
  version: number;
  keyIds: string[];
  dataSize: number;
  widevine?: WidevinePsshData;
  playready?: PlayReadyHeader;
}

function readVarint(b: Uint8Array, pos: { i: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.i < b.length) {
    const byte = b[pos.i++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return result;
}

const printable = (b: Uint8Array) => /^[\x20-\x7e]+$/.test(new TextDecoder().decode(b));
const asText = (b: Uint8Array) => (printable(b) ? new TextDecoder().decode(b) : `0x${toHex(b)}`);

/** Decodes the WidevinePsshData protobuf (fields we care about). */
export function parseWidevinePsshData(data: Uint8Array): WidevinePsshData {
  const out: WidevinePsshData = { keyIds: [] };
  const pos = { i: 0 };
  while (pos.i < data.length) {
    const tag = readVarint(data, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 2) {
      const len = readVarint(data, pos);
      const v = data.subarray(pos.i, pos.i + len);
      pos.i += len;
      if (field === 2) out.keyIds.push(toHex(v));
      else if (field === 3) out.provider = asText(v);
      else if (field === 4) out.contentId = asText(v);
    } else if (wire === 0) {
      const v = readVarint(data, pos);
      if (field === 9) out.protectionScheme = String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    } else if (wire === 5) {
      pos.i += 4;
    } else if (wire === 1) {
      pos.i += 8;
    } else {
      break;
    }
  }
  return out;
}

/** PlayReady key IDs are GUIDs: the first three fields are little-endian. */
export function playReadyKidToHex(b64: string): string {
  const b = fromBase64(b64);
  if (b.length !== 16) return toHex(b);
  return toHex(Uint8Array.from([b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6], ...b.subarray(8)]));
}

const xmlText = (xml: string, tag: string) => {
  const v = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]?.trim();
  return v ? v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : undefined;
};

/** Reads the WRMHEADER XML (versions 4.0 to 4.3). */
export function parseWrmHeader(xml: string): PlayReadyHeader | null {
  const root = xml.match(/<WRMHEADER\b([^>]*)>/i);
  if (!root) return null;
  const out: PlayReadyHeader = { version: attr(root[1], 'version') ?? '', keyIds: [] };
  // 4.1+: <KID ALGID="…" VALUE="base64"/>; 4.0: <KID>base64</KID> with <ALGID> in PROTECTINFO.
  for (const m of xml.matchAll(/<KID\b([^>]*?)(?:\/>|>([^<]*)<\/KID>)/gi)) {
    const b64 = attr(m[1], 'VALUE') ?? m[2]?.trim();
    if (b64) {
      try {
        const kid = playReadyKidToHex(b64);
        if (!out.keyIds.includes(kid)) out.keyIds.push(kid);
      } catch {
        /* not base64 */
      }
    }
    out.algorithm ??= attr(m[1], 'ALGID');
  }
  out.algorithm ??= xmlText(xml, 'ALGID');
  out.laUrl = xmlText(xml, 'LA_URL');
  out.luiUrl = xmlText(xml, 'LUI_URL');
  out.dsId = xmlText(xml, 'DS_ID');
  out.customAttributes = xmlText(xml, 'CUSTOMATTRIBUTES');
  return out;
}

/**
 * Parses a PlayReady Object (the PSSH data of PlayReady, or <mspr:pro>):
 * a little-endian record list whose type-1 record is the UTF-16LE WRMHEADER.
 */
export function parsePlayReadyObject(pro: Uint8Array): PlayReadyHeader | null {
  if (pro.length < 10) return null;
  const v = new DataView(pro.buffer, pro.byteOffset, pro.byteLength);
  const count = v.getUint16(4, true);
  let p = 6;
  for (let i = 0; i < count && p + 4 <= pro.length; i++) {
    const type = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    p += 4;
    if (type === 1 && p + len <= pro.length) return parseWrmHeader(new TextDecoder('utf-16le').decode(pro.subarray(p, p + len)));
    p += len;
  }
  // Some packagers put the bare header in without the record list.
  const text = new TextDecoder('utf-16le').decode(pro);
  return text.includes('<WRMHEADER') ? parseWrmHeader(text.slice(text.indexOf('<WRMHEADER'))) : null;
}

/** Base64 PlayReady data from a manifest: either a whole pssh box or a PlayReady Object. */
export function parsePlayReadyBase64(b64: string): PlayReadyHeader | null {
  const bytes = fromBase64(b64);
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'pssh') return parsePssh(bytes)?.playready ?? null;
  return parsePlayReadyObject(bytes);
}

/** Short descriptions of a PlayReady header for the DRM tab. */
export function playReadyDetails(h: PlayReadyHeader): string[] {
  return [
    `PlayReady header v${h.version || '?'}`,
    ...(h.algorithm ? [`algorithm ${h.algorithm}`] : []),
    ...(h.dsId ? [`DS_ID ${h.dsId}`] : []),
    ...(h.luiUrl ? [`LUI_URL ${h.luiUrl}`] : []),
    ...(h.customAttributes ? [`custom attributes ${h.customAttributes.slice(0, 120)}`] : []),
  ];
}

/** Parses one pssh box (starting at its size field). */
export function parsePssh(box: Uint8Array): Pssh | null {
  if (box.length < 32) return null;
  const v = new DataView(box.buffer, box.byteOffset, box.byteLength);
  if (String.fromCharCode(box[4], box[5], box[6], box[7]) !== 'pssh') return null;
  const version = box[8];
  const systemId = toHex(box.subarray(12, 28));
  let p = 28;
  const keyIds: string[] = [];
  if (version > 0) {
    const count = v.getUint32(p);
    p += 4;
    for (let i = 0; i < count && p + 16 <= box.length; i++, p += 16) keyIds.push(toHex(box.subarray(p, p + 16)));
  }
  const dataSize = p + 4 <= box.length ? v.getUint32(p) : 0;
  const data = box.subarray(p + 4, p + 4 + dataSize);
  const pssh: Pssh = { systemId, system: systemName(systemId), version, keyIds, dataSize };
  if (systemId === 'edef8ba979d64acea3c827dcd51d21ed' && data.length) {
    try {
      pssh.widevine = parseWidevinePsshData(data);
    } catch {
      /* not a protobuf */
    }
  }
  if (systemId === '9a04f07998404286ab92e65be0885f95' && data.length) {
    try {
      pssh.playready = parsePlayReadyObject(data) ?? undefined;
    } catch {
      /* not a PlayReady Object */
    }
  }
  return pssh;
}

export interface InitProtection {
  psshs: Pssh[];
  /** Default key ID from the tenc box. */
  defaultKid?: string;
  /** Encryption scheme from schm (cenc, cbcs, cens, cbc1). */
  scheme?: string;
}

/** Scans an init segment for pssh, schm and tenc boxes. */
export function scanInitSegment(data: Uint8Array): InitProtection {
  const out: InitProtection = { psshs: [] };
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 4; i + 4 <= data.length; i++) {
    const t = String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]);
    if (t !== 'pssh' && t !== 'schm' && t !== 'tenc') continue;
    const start = i - 4;
    const size = v.getUint32(start);
    if (size < 8 || start + size > data.length) continue;
    const box = data.subarray(start, start + size);
    if (t === 'pssh') {
      const p = parsePssh(box);
      if (p) out.psshs.push(p);
    } else if (t === 'schm' && size >= 16) {
      out.scheme = String.fromCharCode(box[12], box[13], box[14], box[15]);
    } else if (t === 'tenc' && size >= 32) {
      out.defaultKid = toHex(box.subarray(16, 32));
    }
    i = start + size - 1;
  }
  return out;
}

export interface DeclaredProtection {
  source: 'MPD' | 'HLS' | 'Init segment';
  system: string;
  /** cenc / cbcs / SAMPLE-AES / AES-128 … */
  scheme?: string;
  keyIds: string[];
  details: string[];
  /** License URL declared by the stream (PlayReady LA_URL, DASH Laurl). */
  licenseUrl?: string;
}

/** Adds PlayReady header findings to a declared-protection entry. */
function addPlayReady(p: DeclaredProtection, header: PlayReadyHeader | null | undefined) {
  if (!header) return;
  for (const k of header.keyIds) if (!p.keyIds.includes(k)) p.keyIds.push(k);
  for (const d of playReadyDetails(header)) if (!p.details.includes(d)) p.details.push(d);
  if (header.laUrl) p.licenseUrl ??= header.laUrl;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];

/** ContentProtection elements of an MPD (deduplicated across AdaptationSets). */
export function parseMpdProtection(mpd: string): DeclaredProtection[] {
  const out = new Map<string, DeclaredProtection>();
  const re = /<(?:\w+:)?ContentProtection\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?ContentProtection>)/g;
  let scheme: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mpd))) {
    const attrs = m[1];
    const body = m[3] ?? '';
    const uri = (attr(attrs, 'schemeIdUri') ?? '').toLowerCase();
    if (uri === 'urn:mpeg:dash:mp4protection:2011') {
      scheme = attr(attrs, 'value') ?? scheme;
      const kid = attr(attrs, 'cenc:default_KID') ?? attr(attrs, 'default_KID');
      if (kid) {
        const p = out.get('mp4protection') ?? { source: 'MPD' as const, system: 'Common encryption', keyIds: [], details: [] };
        if (!p.keyIds.includes(kid.replace(/-/g, '').toLowerCase())) p.keyIds.push(kid.replace(/-/g, '').toLowerCase());
        p.scheme = scheme;
        out.set('mp4protection', p);
      }
      continue;
    }
    const uuid = uri.replace(/^urn:uuid:/, '');
    const system = systemName(uuid);
    const p = out.get(uuid) ?? { source: 'MPD' as const, system, keyIds: [], details: [] };
    const psshB64 = body.match(/<(?:\w+:)?pssh[^>]*>([^<]+)</)?.[1];
    if (psshB64) {
      try {
        const pssh = parsePssh(fromBase64(psshB64));
        if (pssh) {
          for (const k of [...pssh.keyIds, ...(pssh.widevine?.keyIds ?? [])]) if (!p.keyIds.includes(k)) p.keyIds.push(k);
          const d = `PSSH v${pssh.version}, ${pssh.dataSize} B data`;
          if (!p.details.includes(d)) p.details.push(d);
          if (pssh.widevine?.provider) p.details.push(`provider: ${pssh.widevine.provider}`);
          if (pssh.widevine?.contentId) p.details.push(`content ID: ${pssh.widevine.contentId}`);
          addPlayReady(p, pssh.playready);
        }
      } catch {
        p.details.push('PSSH present (undecodable)');
      }
    }
    const proB64 = body.match(/<(?:\w+:)?pro\b[^>]*>([^<]+)</i)?.[1];
    if (proB64) {
      try {
        addPlayReady(p, parsePlayReadyObject(fromBase64(proB64)));
      } catch {
        p.details.push('PlayReady Object (undecodable)');
      }
    }
    const laurl = body.match(/<(?:\w+:)?(?:Laurl|LA_URL)[^>]*>([^<]+)</i)?.[1] ?? attr(body, 'licenseUrl');
    if (laurl) p.licenseUrl ??= laurl.trim();
    out.set(uuid, p);
  }
  for (const p of out.values()) if (!p.scheme && scheme) p.scheme = scheme;
  return [...out.values()];
}

const KEYFORMATS: Record<string, string> = {
  'com.apple.streamingkeydelivery': 'FairPlay',
  'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': 'Widevine',
  'com.microsoft.playready': 'PlayReady',
  'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95': 'PlayReady',
  identity: 'AES-128 (key file)',
};

/** EXT-X-KEY / EXT-X-SESSION-KEY tags of an HLS playlist. */
export function parseHlsProtection(text: string): DeclaredProtection[] {
  const out = new Map<string, DeclaredProtection>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#EXT-X-(SESSION-)?KEY:(.*)$/);
    if (!m) continue;
    const a: Record<string, string> = {};
    for (const [, k, v] of m[2].matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) a[k] = v.replace(/^"|"$/g, '');
    if (!a.METHOD || a.METHOD === 'NONE') continue;
    const format = (a.KEYFORMAT ?? 'identity').toLowerCase();
    const system = KEYFORMATS[format] ?? format;
    const key = `${system}|${a.METHOD}`;
    const p = out.get(key) ?? { source: 'HLS' as const, system, scheme: a.METHOD, keyIds: [], details: [] };
    const kid = a.KEYID?.replace(/^0x/i, '').toLowerCase();
    if (kid && !p.keyIds.includes(kid)) p.keyIds.push(kid);
    const data = system === 'PlayReady' ? a.URI?.match(/^data:[^,]*;base64,(.+)$/i)?.[1] : undefined;
    if (data) {
      try {
        addPlayReady(p, parsePlayReadyBase64(data));
      } catch {
        p.details.push('PlayReady data (undecodable)');
      }
    } else if (a.URI && p.details.length < 3 && !p.details.includes(`URI: ${a.URI}`)) p.details.push(`URI: ${a.URI.slice(0, 120)}`);
    if (m[1] && !p.details.includes('session key (master playlist)')) p.details.push('session key (master playlist)');
    out.set(key, p);
  }
  return [...out.values()];
}

/** Converts init segment findings into the same shape as the manifest ones. */
export function initProtectionToDeclared(p: InitProtection): DeclaredProtection[] {
  const list: DeclaredProtection[] = p.psshs.map((pssh) => {
    const d: DeclaredProtection = {
      source: 'Init segment',
      system: pssh.system,
      scheme: p.scheme,
      keyIds: [...new Set([...pssh.keyIds, ...(pssh.widevine?.keyIds ?? [])])],
      details: [
        `PSSH v${pssh.version}, ${pssh.dataSize} B data`,
        ...(pssh.widevine?.provider ? [`provider: ${pssh.widevine.provider}`] : []),
        ...(pssh.widevine?.contentId ? [`content ID: ${pssh.widevine.contentId}`] : []),
      ],
    };
    addPlayReady(d, pssh.playready);
    return d;
  });
  if (p.defaultKid || p.scheme) {
    list.push({
      source: 'Init segment',
      system: 'Common encryption',
      scheme: p.scheme,
      keyIds: p.defaultKid ? [p.defaultKid] : [],
      details: ['tenc / schm boxes'],
    });
  }
  return list;
}
