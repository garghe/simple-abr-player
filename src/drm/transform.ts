import type { ContentIdSource, LicenseFormat } from './settings';

/**
 * Generic license request / response handling. The CDM produces a binary
 * message (Widevine challenge or FairPlay SPC); servers differ only in how
 * they want it wrapped and how they wrap the license that comes back.
 */

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Strict-ish check: printable base64 alphabet, sensible length. */
export function looksLikeBase64(text: string): boolean {
  const t = text.trim();
  return t.length >= 16 && t.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

function decodeText(bytes: Uint8Array): string | null {
  // Binary licenses contain control bytes; only treat clean UTF-8 as text.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x08\x0e-\x1f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export interface TemplateVars {
  contentId?: string;
  keyId?: string;
}

/** Fills {{challenge}} / {{spc}} / {{contentId}} / {{keyId}} placeholders. */
export function fillTemplate(template: string, challengeB64: string, vars: TemplateVars, escape: (s: string) => string): string {
  const values: Record<string, string> = {
    challenge: challengeB64,
    spc: challengeB64,
    contentId: vars.contentId ?? '',
    keyId: vars.keyId ?? '',
  };
  return template.replace(/\{\{\s*(challenge|spc|contentId|keyId)\s*\}\}/g, (_, k: string) => escape(values[k]));
}

const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);

export interface BuiltRequest {
  body: Uint8Array;
  contentType: string | null;
}

/** Wraps the CDM message as the license server expects. */
export function buildLicenseRequest(challenge: Uint8Array, fmt: LicenseFormat, vars: TemplateVars = {}): BuiltRequest {
  switch (fmt.requestFormat) {
    case 'raw':
      return { body: challenge, contentType: null }; // keep the CDM / Shaka default
    case 'base64':
      return { body: utf8(toBase64(challenge)), contentType: 'text/plain' };
    case 'form':
      return {
        body: utf8(fillTemplate(fmt.template || 'spc={{spc}}', toBase64(challenge), vars, encodeURIComponent)),
        contentType: 'application/x-www-form-urlencoded',
      };
    case 'json': {
      const text = fillTemplate(fmt.template || '{"challenge":"{{challenge}}"}', toBase64(challenge), vars, jsonEscape);
      JSON.parse(text); // fail early with a clear error if the template is not valid JSON
      return { body: utf8(text), contentType: 'application/json' };
    }
  }
}

export interface ParsedResponse {
  license: Uint8Array;
  /** How the license was found, for the DRM tab ("raw", "base64", "JSON field ckc", …). */
  detected: string;
}

const AUTO_FIELDS = ['license', 'ckc', 'CkcMessage', 'License', 'data.license', 'payload'];

/**
 * Unwraps the license. "auto" recognises raw binary, base64 text, <ckc>…</ckc>
 * and JSON with a common field; anything else is passed through unchanged
 * (e.g. a ClearKey JSON key set).
 */
export function parseLicenseResponse(data: Uint8Array, fmt: LicenseFormat): ParsedResponse {
  const text = decodeText(data);
  const unwrapTags = (t: string) => t.trim().replace(/^<ckc>/i, '').replace(/<\/ckc>$/i, '');
  switch (fmt.responseFormat) {
    case 'raw':
      return { license: data, detected: 'raw' };
    case 'base64':
      if (text === null) throw new Error('Response is not base64 text');
      return { license: fromBase64(text), detected: 'base64' };
    case 'ckc-tags':
      if (text === null) throw new Error('Response is not text');
      return { license: fromBase64(unwrapTags(text)), detected: '<ckc> tags' };
    case 'json': {
      if (text === null) throw new Error('Response is not JSON');
      const value = getPath(JSON.parse(text), fmt.responseField);
      if (typeof value !== 'string') throw new Error(`JSON field "${fmt.responseField}" not found in the response`);
      return { license: fromBase64(value), detected: `JSON field ${fmt.responseField}` };
    }
    case 'auto': {
      if (text === null) return { license: data, detected: 'raw (binary)' };
      const t = text.trim();
      if (/^<ckc>[\s\S]*<\/ckc>$/i.test(t)) return { license: fromBase64(unwrapTags(t)), detected: '<ckc> tags' };
      if (t.startsWith('{')) {
        try {
          const json = JSON.parse(t);
          const fields = fmt.responseField ? [fmt.responseField, ...AUTO_FIELDS] : AUTO_FIELDS;
          for (const f of fields) {
            const v = getPath(json, f);
            if (typeof v === 'string' && looksLikeBase64(v)) return { license: fromBase64(v), detected: `JSON field ${f}` };
          }
        } catch {
          /* not JSON after all */
        }
        return { license: data, detected: 'raw (JSON passed through)' };
      }
      if (looksLikeBase64(t)) return { license: fromBase64(t), detected: 'base64' };
      return { license: data, detected: 'raw' };
    }
  }
}

/** Finds the default key ID in a "sinf"/"tenc" box (FairPlay fMP4 init data). */
function tencKeyId(bytes: Uint8Array): string | null {
  for (let i = 4; i + 4 + 28 <= bytes.length; i++) {
    if (bytes[i] === 0x74 && bytes[i + 1] === 0x65 && bytes[i + 2] === 0x6e && bytes[i + 3] === 0x63) {
      // tenc: fullbox(4) + reserved/pattern(2) + isProtected(1) + perSampleIVSize(1) + KID(16)
      return toHex(bytes.subarray(i + 12, i + 28));
    }
  }
  return null;
}

/** Text of an skd:// URI carried as EME init data (UTF-8 or UTF-16LE). */
export function initDataText(initData: Uint8Array): string {
  const isUtf16 = initData.length > 1 && initData[1] === 0 && initData[0] !== 0;
  const text = isUtf16 ? new TextDecoder('utf-16le').decode(initData) : new TextDecoder().decode(initData);
  return text.replace(/\0/g, '').trim();
}

/** FairPlay content ID ("asset ID") for the license request. */
export function fairPlayContentId(
  initData: Uint8Array | null,
  initDataType: string | null,
  source: ContentIdSource,
  custom: string,
): string {
  if (source === 'custom') return custom;
  if (!initData) return '';
  if (initDataType === 'sinf' || source === 'key-id') {
    const kid = tencKeyId(initData);
    if (kid) return kid;
  }
  const text = initDataText(initData);
  const m = text.match(/skd:\/\/([^?#]*)/i);
  if (!m) return text;
  if (source === 'skd-uri') return text.slice(text.indexOf('skd://'));
  return m[1].split('/')[0];
}
