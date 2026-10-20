import { describe, expect, it } from 'vitest';
import { drmHint } from '../src/drm/errors';
import { parseHlsProtection, parseMpdProtection, parsePssh, scanInitSegment } from '../src/drm/inspect';
import { DEFAULT_DRM, normaliseDrm, widevineLevelName } from '../src/drm/settings';
import {
  buildLicenseRequest,
  fairPlayContentId,
  fromBase64,
  parseLicenseResponse,
  toBase64,
} from '../src/drm/transform';

const challenge = new Uint8Array([0x08, 0x01, 0x12, 0x00, 0xff, 0x10, 0x20]);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const fmt = (o: Partial<typeof DEFAULT_DRM.widevine> = {}) => ({ ...DEFAULT_DRM.widevine, ...o });

describe('license request formats', () => {
  it('raw passes the CDM message through', () => {
    expect(buildLicenseRequest(challenge, fmt()).body).toBe(challenge);
  });
  it('base64', () => {
    const r = buildLicenseRequest(challenge, fmt({ requestFormat: 'base64' }));
    expect(fromBase64(text(r.body))).toEqual(challenge);
  });
  it('JSON template with placeholders (escaped)', () => {
    const r = buildLicenseRequest(challenge, fmt({ requestFormat: 'json', template: '{"spc":"{{spc}}","assetId":"{{contentId}}","x":1}' }), { contentId: 'a"b' });
    const json = JSON.parse(text(r.body));
    expect(json).toEqual({ spc: toBase64(challenge), assetId: 'a"b', x: 1 });
    expect(r.contentType).toBe('application/json');
  });
  it('form template URL-encodes values', () => {
    const r = buildLicenseRequest(challenge, fmt({ requestFormat: 'form', template: 'spc={{spc}}&assetId={{contentId}}' }), { contentId: 'id 1' });
    const params = new URLSearchParams(text(r.body));
    expect(fromBase64(params.get('spc')!)).toEqual(challenge);
    expect(params.get('assetId')).toBe('id 1');
  });
  it('rejects a JSON template that is not JSON', () => {
    expect(() => buildLicenseRequest(challenge, fmt({ requestFormat: 'json', template: '{bad' }))).toThrow();
  });
});

describe('license response formats', () => {
  const license = new Uint8Array([0x08, 0x02, 0x12, 0x9a, 0x00, 0x01, 0xfe, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]);
  const enc = (s: string) => new TextEncoder().encode(s);
  const auto = fmt({ responseFormat: 'auto', responseField: '' });

  it('auto: binary stays raw', () => {
    expect(parseLicenseResponse(license, auto).license).toEqual(license);
  });
  it('auto: base64 text', () => {
    expect(parseLicenseResponse(enc(toBase64(license)), auto)).toMatchObject({ license, detected: 'base64' });
  });
  it('auto: <ckc> tags', () => {
    expect(parseLicenseResponse(enc(`<ckc>${toBase64(license)}</ckc>`), auto).license).toEqual(license);
  });
  it('auto: common JSON fields', () => {
    for (const f of ['license', 'ckc', 'CkcMessage', 'License']) {
      expect(parseLicenseResponse(enc(JSON.stringify({ [f]: toBase64(license) })), auto)).toMatchObject({ license, detected: `JSON field ${f}` });
    }
  });
  it('auto: leaves a ClearKey JSON key set alone', () => {
    const jwk = enc('{"keys":[{"kty":"oct","kid":"abc","k":"def"}],"type":"temporary"}');
    expect(parseLicenseResponse(jwk, auto).license).toEqual(jwk);
  });
  it('json: dotted path', () => {
    const r = parseLicenseResponse(enc(JSON.stringify({ data: { license: toBase64(license) } })), fmt({ responseFormat: 'json', responseField: 'data.license' }));
    expect(r.license).toEqual(license);
  });
  it('json: clear error when the field is missing', () => {
    expect(() => parseLicenseResponse(enc('{"other":1}'), fmt({ responseFormat: 'json', responseField: 'license' }))).toThrow(/not found/);
  });
});

describe('FairPlay content ID', () => {
  const skd = (s: string) => new TextEncoder().encode(s);
  const utf16 = (s: string) => new Uint8Array(new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer);
  it('from the skd:// host (default), UTF-8 or UTF-16', () => {
    expect(fairPlayContentId(skd('skd://asset-123?x=1'), 'skd', 'skd-host', '')).toBe('asset-123');
    expect(fairPlayContentId(utf16('skd://asset-123/path'), 'skd', 'skd-host', '')).toBe('asset-123');
  });
  it('whole URI or custom', () => {
    expect(fairPlayContentId(skd('skd://asset-123/path'), 'skd', 'skd-uri', '')).toBe('skd://asset-123/path');
    expect(fairPlayContentId(skd('skd://x'), 'skd', 'custom', 'MY-ID')).toBe('MY-ID');
  });
});

describe('protection parsing', () => {
  it('decodes a Widevine PSSH (Shaka Angel One)', () => {
    const p = parsePssh(fromBase64('AAAAPnBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAB4iFnNoYWthX2NlYzJmNjRhYTc4OTBhMTFI49yVmwY='))!;
    expect(p.system).toBe('Widevine');
    expect(p.version).toBe(0);
    expect(p.widevine?.contentId).toBe('shaka_cec2f64aa7890a11');
    expect(p.widevine?.protectionScheme).toBe('cenc');
  });

  it('decodes a v1 PSSH with key IDs (ClearKey)', () => {
    const p = parsePssh(fromBase64('AAAANHBzc2gBAAAAEHfv7MCyTQKs4zweUuL7SwAAAAH+7fAN7t6tvu/wuq3wDdANAAAAAA=='))!;
    expect(p.system).toBe('ClearKey (W3C common)');
    expect(p.keyIds).toEqual(['feedf00deedeadbeeff0baadf00dd00d']);
  });

  it('reads MPD ContentProtection', () => {
    const mpd = `<AdaptationSet>
      <ContentProtection value="cenc" schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="800aacaa-5229-58ae-8880-62b5695db6bf"/>
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
        <cenc:pssh>AAAAPnBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAB4iFnNoYWthX2NlYzJmNjRhYTc4OTBhMTFI49yVmwY=</cenc:pssh>
      </ContentProtection>
      <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"><mspr:pro>AAAA</mspr:pro></ContentProtection>
    </AdaptationSet>`;
    const list = parseMpdProtection(mpd);
    const common = list.find((p) => p.system === 'Common encryption')!;
    expect(common.scheme).toBe('cenc');
    expect(common.keyIds).toEqual(['800aacaa522958ae888062b5695db6bf']);
    expect(list.find((p) => p.system === 'Widevine')!.details).toContain('content ID: shaka_cec2f64aa7890a11');
    expect(list.find((p) => p.system === 'PlayReady')!.details).toContain('PlayReady Object');
  });

  it('reads HLS key tags', () => {
    const m3u8 = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://twelve",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",URI="data:text/plain;base64,AAAA",KEYID=0x800AACAA522958AE888062B5695DB6BF
#EXT-X-KEY:METHOD=NONE`;
    const list = parseHlsProtection(m3u8);
    expect(list.map((p) => `${p.system}/${p.scheme}`)).toEqual(['FairPlay/SAMPLE-AES', 'Widevine/SAMPLE-AES-CTR']);
    expect(list[1].keyIds).toEqual(['800aacaa522958ae888062b5695db6bf']);
  });

  it('scans an init segment for pssh, schm and tenc', () => {
    const pssh = fromBase64('AAAANHBzc2gBAAAAEHfv7MCyTQKs4zweUuL7SwAAAAH+7fAN7t6tvu/wuq3wDdANAAAAAA==');
    const schm = new Uint8Array([0, 0, 0, 20, 0x73, 0x63, 0x68, 0x6d, 0, 0, 0, 0, 0x63, 0x62, 0x63, 0x73, 0, 1, 0, 0]);
    const tenc = new Uint8Array(32);
    tenc.set([0, 0, 0, 32, 0x74, 0x65, 0x6e, 0x63]);
    tenc.set(new Uint8Array(16).fill(0xab), 16);
    const init = new Uint8Array([...pssh, ...schm, ...tenc]);
    const r = scanInitSegment(init);
    expect(r.psshs).toHaveLength(1);
    expect(r.scheme).toBe('cbcs');
    expect(r.defaultKid).toBe('ab'.repeat(16));
  });
});

describe('settings and errors', () => {
  it('fills missing fields from defaults', () => {
    const s = normaliseDrm({ mode: 'widevine', widevine: { licenseUrl: 'https://x' } });
    expect(s.widevine.level).toBe('auto');
    expect(s.fairplay.contentId).toBe('skd-host');
  });
  it('names Widevine levels', () => {
    expect(widevineLevelName('HW_SECURE_ALL')).toMatch(/L1/);
    expect(widevineLevelName('SW_SECURE_CRYPTO')).toMatch(/L3/);
  });
  it('explains license failures by HTTP status', () => {
    expect(drmHint({ code: 6007, data: [{ code: 1001, data: ['https://lic', 403] }] })).toMatch(/403/);
    expect(drmHint({ code: 6007, data: [{ code: 1002, data: ['https://lic'] }] })).toMatch(/CORS/);
    expect(drmHint({ code: 6012 })).toMatch(/license URL/);
    expect(drmHint({ code: 1234 })).toBeNull();
  });
});
