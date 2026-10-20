/** Plain-language explanations for Shaka's DRM errors (60xx) and related cases. */

interface ErrorLike {
  code?: number;
  data?: unknown[];
}

function httpStatus(data: unknown[] | undefined): number | null {
  // LICENSE_REQUEST_FAILED (6007) wraps the network error: data[0] is a shaka.util.Error.
  const inner = data?.[0] as ErrorLike | undefined;
  const status = inner?.data?.[1];
  return typeof status === 'number' ? status : null;
}

export function drmHint(err: unknown): string | null {
  const e = (err ?? {}) as ErrorLike;
  switch (e.code) {
    case 6001:
      return 'This browser cannot use the requested DRM. Widevine needs Chrome, Edge or Firefox (not Safari); FairPlay needs Safari. Check the Device tab, and try Widevine security level "Auto" or "Software".';
    case 6002:
    case 6003:
      return 'The browser could not start its DRM module. Reload the page; in Chrome check chrome://components that "Widevine Content Decryption Module" is up to date.';
    case 6004:
      return 'The FairPlay certificate was rejected. Check that it is the right certificate for this license server (binary .der or base64 both work).';
    case 6006:
      return 'The DRM module could not create a license request from the stream\'s init data. The stream may be packaged for a different DRM, or the FairPlay content ID is wrong.';
    case 6007: {
      const status = httpStatus(e.data);
      if (status === 401 || status === 403) return `The license server refused the request (HTTP ${status}). Check the token or other license request headers in the DRM settings.`;
      if (status) return `The license request failed with HTTP ${status}. The DRM tab shows the server's response.`;
      return 'The license request failed before reaching the server: usually CORS. Tick "Send license requests through the CORS proxy" in the DRM settings, or check the license URL.';
    }
    case 6008:
      return 'The DRM module rejected the license. The response format may be wrong: try a different "Response" format in the DRM settings, and check the raw response in the DRM tab.';
    case 6010:
      return 'The stream is encrypted but declares no DRM information the player can use. For HLS Widevine/FairPlay check the EXT-X-KEY tags; set the DRM type explicitly in the DRM settings.';
    case 6012:
      return 'The stream is encrypted, but no license server is set for its DRM system. Open the DRM settings and enter the license URL.';
    case 6014:
      return 'The license has expired.';
    case 6015:
      return 'FairPlay needs a certificate: add the certificate URL, or upload the file, in the DRM settings.';
    case 6016:
      return 'Could not prepare the FairPlay request. Check the content ID setting in the DRM settings.';
    case 6017:
      return 'The FairPlay certificate could not be downloaded. Check the certificate URL (and CORS: the proxy option applies to it too).';
    case 6018:
    case 6019:
      return 'The required HDCP version is not available on this display/output.';
    case 6020:
      return 'This browser has no Encrypted Media Extensions. DRM needs a secure page (https:// or localhost) in a recent browser.';
    default:
      return null;
  }
}

/** Plain explanation of an EME key status. */
export const KEY_STATUS_TEXT: Record<string, string> = {
  usable: 'usable',
  expired: 'expired: the license is no longer valid',
  released: 'released',
  'output-restricted': 'output restricted: blocked by output protection (HDCP / display); this rendition will be skipped',
  'output-downscaled': 'output downscaled because of output protection',
  'status-pending': 'pending',
  'internal-error': 'internal error in the DRM module',
  'usable-in-future': 'not yet usable (license start time in the future)',
};
