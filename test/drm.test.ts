import { describe, expect, it } from 'vitest';
import { drmHint } from '../src/drm/errors';
import {
  parseHlsProtection,
  parseMpdProtection,
  parsePlayReadyObject,
  parsePssh,
  parseWrmHeader,
  playReadyKidToHex,
  scanInitSegment,
} from '../src/drm/inspect';
import { DEFAULT_DRM, isDrmConfigured, normaliseDrm, playReadyLevelName, usesPlayReady, widevineLevelName } from '../src/drm/settings';
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

// CENC key ID 800aacaa-5229-58ae-8880-62b5695db6bf as a PlayReady GUID (little-endian fields).
const KID = '800aacaa522958ae888062b5695db6bf';
const PR_KID = 'qqwKgClSrliIgGK1aV22vw==';
const WRM_40 = `<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.0.0.0"><DATA><PROTECTINFO><KEYLEN>16</KEYLEN><ALGID>AESCTR</ALGID></PROTECTINFO><KID>${PR_KID}</KID><LA_URL>https://lic.example.com/pr?x=1&amp;y=2</LA_URL><DS_ID>AH+03juKbUGbHl1V/QIwRA==</DS_ID></DATA></WRMHEADER>`;
const WRM_43 = `<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.3.0.0"><DATA><PROTECTINFO><KIDS><KID ALGID="AESCBC" VALUE="${PR_KID}"></KID></KIDS></PROTECTINFO><LA_URL>https://lic.example.com/rightsmanager.asmx?a=1&amp;b=2</LA_URL><CUSTOMATTRIBUTES><IIS_DRM_VERSION>8</IIS_DRM_VERSION></CUSTOMATTRIBUTES></DATA></WRMHEADER>`;

/** Builds a PlayReady Object: length, record count, then a type-1 UTF-16LE WRMHEADER record. */
function pro(xml: string): Uint8Array {
  const body = new Uint8Array(xml.length * 2);
  for (let i = 0; i < xml.length; i++) body[i * 2] = xml.charCodeAt(i);
  const out = new Uint8Array(10 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, out.length, true);
  v.setUint16(4, 1, true);
  v.setUint16(6, 1, true);
  v.setUint16(8, body.length, true);
  out.set(body, 10);
  return out;
}

/** Wraps data in a v0 pssh box for the given system ID. */
function psshBox(systemIdHex: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(32 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, out.length);
  out.set([0x70, 0x73, 0x73, 0x68], 4);
  out.set(systemIdHex.match(/../g)!.map((x) => parseInt(x, 16)), 12);
  v.setUint32(28, data.length);
  out.set(data, 32);
  return out;
}

describe('PlayReady', () => {
  it('converts GUID key IDs to CENC byte order', () => {
    expect(playReadyKidToHex(PR_KID)).toBe(KID);
  });

  it('reads a v4.0 header (KID element, ALGID in PROTECTINFO, entities)', () => {
    const h = parseWrmHeader(WRM_40)!;
    expect(h.version).toBe('4.0.0.0');
    expect(h.keyIds).toEqual([KID]);
    expect(h.algorithm).toBe('AESCTR');
    expect(h.laUrl).toBe('https://lic.example.com/pr?x=1&y=2');
    expect(h.dsId).toBe('AH+03juKbUGbHl1V/QIwRA==');
  });

  it('reads a v4.3 header (KIDS list, ALGID attribute)', () => {
    const h = parseWrmHeader(WRM_43)!;
    expect(h.keyIds).toEqual([KID]);
    expect(h.algorithm).toBe('AESCBC');
    expect(h.customAttributes).toContain('IIS_DRM_VERSION');
  });

  it('reads the PlayReady Object and PlayReady PSSH boxes', () => {
    expect(parsePlayReadyObject(pro(WRM_40))?.laUrl).toBe('https://lic.example.com/pr?x=1&y=2');
    const pssh = parsePssh(psshBox('9a04f07998404286ab92e65be0885f95', pro(WRM_43)))!;
    expect(pssh.system).toBe('PlayReady');
    expect(pssh.playready?.keyIds).toEqual([KID]);
    expect(parsePlayReadyObject(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('reads PlayReady from init segments', () => {
    const found = scanInitSegment(psshBox('9a04f07998404286ab92e65be0885f95', pro(WRM_40)));
    expect(found.psshs[0].playready?.version).toBe('4.0.0.0');
  });

  it('reads PlayReady HLS key tags (data URI with a PlayReady Object or a pssh box)', () => {
    const m3u8 = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.microsoft.playready",KEYFORMATVERSIONS="1",URI="data:text/plain;charset=UTF-16;base64,${toBase64(pro(WRM_43))}"
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95",URI="data:text/plain;base64,${toBase64(psshBox('9a04f07998404286ab92e65be0885f95', pro(WRM_40)))}"`;
    const list = parseHlsProtection(m3u8);
    expect(list.map((p) => `${p.system}/${p.scheme}`)).toEqual(['PlayReady/SAMPLE-AES', 'PlayReady/SAMPLE-AES-CTR']);
    expect(list[0].licenseUrl).toBe('https://lic.example.com/rightsmanager.asmx?a=1&b=2');
    expect(list[1].keyIds).toEqual([KID]);
    expect(list[1].details).toContain('algorithm AESCTR');
  });

  it('passes SOAP XML licenses through unchanged', () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><soap:Envelope><soap:Body><AcquireLicenseResponse/></soap:Body></soap:Envelope>');
    expect(parseLicenseResponse(xml, DEFAULT_DRM.playready)).toEqual({ license: xml, detected: 'raw' });
  });

  it('settings: PlayReady mode works without a URL, auto needs one', () => {
    const s = normaliseDrm({ mode: 'playready' });
    expect(s.playready.level).toBe('auto');
    expect(usesPlayReady(s)).toBe(true);
    expect(isDrmConfigured(s)).toBe(true);
    expect(usesPlayReady(normaliseDrm({ mode: 'auto' }))).toBe(false);
    expect(usesPlayReady(normaliseDrm({ mode: 'auto', playready: { ...DEFAULT_DRM.playready, licenseUrl: 'https://lic' } }))).toBe(true);
    expect(usesPlayReady(normaliseDrm({ mode: 'widevine', playready: { ...DEFAULT_DRM.playready, licenseUrl: 'https://lic' } }))).toBe(false);
  });

  it('names security levels', () => {
    expect(playReadyLevelName('com.microsoft.playready.recommendation', '3000')).toBe('SL3000 (hardware)');
    expect(playReadyLevelName('com.microsoft.playready.recommendation', '2000')).toBe('SL2000 (software)');
    expect(playReadyLevelName('com.microsoft.playready.recommendation.3000', '')).toBe('SL3000 (hardware)');
    expect(playReadyLevelName('com.microsoft.playready', '')).toBe('');
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
      <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"><mspr:pro>${toBase64(pro(WRM_43))}</mspr:pro></ContentProtection>
    </AdaptationSet>`;
    const list = parseMpdProtection(mpd);
    const common = list.find((p) => p.system === 'Common encryption')!;
    expect(common.scheme).toBe('cenc');
    expect(common.keyIds).toEqual(['800aacaa522958ae888062b5695db6bf']);
    expect(list.find((p) => p.system === 'Widevine')!.details).toContain('content ID: shaka_cec2f64aa7890a11');
    const pr = list.find((p) => p.system === 'PlayReady')!;
    expect(pr.details).toContain('PlayReady header v4.3.0.0');
    expect(pr.keyIds).toEqual([KID]);
    expect(pr.licenseUrl).toBe('https://lic.example.com/rightsmanager.asmx?a=1&b=2');
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
