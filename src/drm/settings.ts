/**
 * DRM settings, kept generic: no provider-specific presets. Any license
 * server is described by a URL, headers and, when needed, how the request
 * body is wrapped and where the license sits in the response.
 */

export type DrmMode = 'off' | 'auto' | 'widevine' | 'fairplay';

/** How the CDM's license request (Widevine challenge / FairPlay SPC) is sent. */
export type RequestFormat = 'raw' | 'base64' | 'form' | 'json';

/** Where the license (Widevine license / FairPlay CKC) is in the response. */
export type ResponseFormat = 'auto' | 'raw' | 'base64' | 'ckc-tags' | 'json';

export type WidevineLevel = 'auto' | 'hw' | 'sw';
export type ContentIdSource = 'skd-host' | 'skd-uri' | 'key-id' | 'custom';
export type SafariPlayback = 'auto' | 'mse' | 'native';

export interface LicenseFormat {
  requestFormat: RequestFormat;
  /** JSON or form template with {{challenge}}/{{spc}}, {{contentId}}, {{keyId}}. */
  template: string;
  responseFormat: ResponseFormat;
  /** Dotted JSON path for responseFormat "json", e.g. "license" or "data.ckc". */
  responseField: string;
}

export interface WidevineSettings extends LicenseFormat {
  licenseUrl: string;
  level: WidevineLevel;
}

export interface FairPlaySettings extends LicenseFormat {
  licenseUrl: string;
  certificateUrl: string;
  /** Uploaded certificate, base64 (takes precedence over certificateUrl). */
  certificateData: string;
  certificateName: string;
  contentId: ContentIdSource;
  customContentId: string;
  playback: SafariPlayback;
}

export interface DrmSettings {
  mode: DrmMode;
  widevine: WidevineSettings;
  fairplay: FairPlaySettings;
  /** "Name: value" lines, sent with license and certificate requests. */
  headers: string;
  /** Send license/certificate requests through the CORS proxy. */
  useProxy: boolean;
  /**
   * Not in the UI: lets automated tests drive the same license pipeline with
   * another key system (ClearKey runs in headless browsers, Widevine doesn't).
   * Uses the Widevine request/response format settings.
   */
  testKeySystem?: { keySystem: string; licenseUrl: string };
}

export interface DrmProfile {
  name: string;
  /** Optional stream URL saved with the profile. */
  url: string;
  drm: DrmSettings;
  savedAt: string;
}

export const DEFAULT_DRM: DrmSettings = {
  mode: 'off',
  widevine: {
    licenseUrl: '',
    level: 'auto',
    requestFormat: 'raw',
    template: '{"challenge":"{{challenge}}"}',
    responseFormat: 'auto',
    responseField: 'license',
  },
  fairplay: {
    licenseUrl: '',
    certificateUrl: '',
    certificateData: '',
    certificateName: '',
    contentId: 'skd-host',
    customContentId: '',
    playback: 'auto',
    requestFormat: 'raw',
    template: '{"spc":"{{spc}}","assetId":"{{contentId}}"}',
    responseFormat: 'auto',
    responseField: 'ckc',
  },
  headers: '',
  useProxy: false,
};

/** Robustness strings requested from the Widevine CDM, best first. */
export const WIDEVINE_ROBUSTNESS: Record<WidevineLevel, { video: string[]; audio: string[] }> = {
  auto: {
    video: ['HW_SECURE_ALL', 'HW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'SW_SECURE_CRYPTO'],
    audio: ['HW_SECURE_CRYPTO', 'SW_SECURE_CRYPTO'],
  },
  hw: { video: ['HW_SECURE_ALL'], audio: ['HW_SECURE_CRYPTO', 'SW_SECURE_CRYPTO'] },
  sw: { video: ['SW_SECURE_DECODE', 'SW_SECURE_CRYPTO'], audio: ['SW_SECURE_CRYPTO'] },
};

/** Human label for a Widevine robustness string. */
export function widevineLevelName(robustness: string): string {
  if (!robustness) return '';
  if (robustness === 'HW_SECURE_ALL') return 'L1 (hardware)';
  if (robustness.startsWith('HW_')) return 'L2 (hardware crypto)';
  return 'L3 (software)';
}

/** Merges a stored/partial object over the defaults (tolerates old shapes). */
export function normaliseDrm(value: unknown): DrmSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<DrmSettings>;
  return {
    ...DEFAULT_DRM,
    ...v,
    widevine: { ...DEFAULT_DRM.widevine, ...(v.widevine ?? {}) },
    fairplay: { ...DEFAULT_DRM.fairplay, ...(v.fairplay ?? {}) },
  };
}

export const isDrmConfigured = (s: DrmSettings): boolean =>
  Boolean(s.testKeySystem) || (s.mode !== 'off' && Boolean(s.widevine.licenseUrl.trim() || s.fairplay.licenseUrl.trim()));

// ------------------------------------------------------------- storage

const CURRENT_KEY = 'sap.drm.v1';
const PROFILES_KEY = 'sap.drmProfiles.v1';

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full (large certificate) */
  }
}

/** Settings remembered with "Remember on this browser", or null. */
export function loadRememberedDrm(): DrmSettings | null {
  const v = read(CURRENT_KEY);
  return v ? normaliseDrm(v) : null;
}

export function rememberDrm(settings: DrmSettings | null): void {
  write(CURRENT_KEY, settings);
}

export function loadProfiles(): DrmProfile[] {
  const v = read(PROFILES_KEY);
  if (!Array.isArray(v)) return [];
  return v
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({ name: p.name, url: typeof p.url === 'string' ? p.url : '', drm: normaliseDrm(p.drm), savedAt: p.savedAt ?? '' }));
}

export function saveProfile(profile: DrmProfile): DrmProfile[] {
  const list = [profile, ...loadProfiles().filter((p) => p.name !== profile.name)];
  write(PROFILES_KEY, list);
  return list;
}

export function deleteProfile(name: string): DrmProfile[] {
  const list = loadProfiles().filter((p) => p.name !== name);
  write(PROFILES_KEY, list);
  return list;
}
