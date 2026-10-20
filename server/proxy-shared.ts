/**
 * Pieces of the CORS proxy shared by the Vite dev/preview plugin
 * (server/proxy-plugin.ts, Node) and the Cloudflare Worker (worker/index.ts).
 * No Node or Workers specific imports here.
 *
 *   GET /__proxy/https/cdn.example.com/path/master.m3u8?x=1
 *     -> GET https://cdn.example.com/path/master.m3u8?x=1
 */

export const PREFIX = '/__proxy/';

export const FORWARD_REQUEST_HEADERS = [
  'range',
  'content-type',
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'if-none-match',
  'if-modified-since',
  'user-agent',
];

export const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'date',
  'age',
];

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Date, Age, X-Proxy-Target, X-Proxy-Status',
};

/**
 * POST is accepted for DRM license requests only (small bodies). Media is
 * never POSTed, so this cannot be used to tunnel playback.
 */
export const MAX_POST_BYTES = 256 * 1024;

/** Custom headers set in the UI arrive as X-Proxy-Header-<Name>. */
export const CUSTOM_HEADER_PREFIX = 'x-proxy-header-';

export function parseProxyPath(path: string): URL | null {
  if (!path.startsWith(PREFIX)) return null;
  const rest = path.slice(PREFIX.length);
  const m = rest.match(/^(https?)\/(.+)$/i);
  if (!m) return null;
  try {
    return new URL(`${m[1].toLowerCase()}://${m[2]}`);
  } catch {
    return null;
  }
}

/** Maps an upstream redirect target back into the proxy namespace. */
export function proxiedLocation(location: string, base: URL): string {
  const next = new URL(location, base);
  return `${PREFIX}${next.protocol.replace(':', '')}/${next.host}${next.pathname}${next.search}`;
}

/**
 * Host allowlist check. Patterns are exact hosts or "*.example.com"
 * (matches subdomains). An empty list allows every host.
 */
export function isHostAllowed(host: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const pattern = p.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern.startsWith('*.')) return h.endsWith(pattern.slice(1)) || h === pattern.slice(2);
    return h === pattern;
  });
}

/** JSON returned by /__proxy/health so the app knows what the proxy allows. */
export interface ProxyHealth {
  status: 'ok';
  /** 'local' = Vite dev/preview server, 'cloudflare' = deployed Worker. */
  kind: 'local' | 'cloudflare';
  /** Whether media segments may be proxied (manifests/playlists always may). */
  segments: boolean;
}

/** File extensions of media segments, init segments, subtitles and thumbnails. */
const MEDIA_EXTENSIONS =
  /\.(m4s|m4v|m4a|m4f|mp4|cmfv|cmfa|cmft|ts|aac|ac3|ec3|mp3|webm|weba|vtt|webvtt|ttml|dfxp|srt|jpg|jpeg|png|key)$/i;

/** True when the URL path looks like a media segment rather than a manifest. */
export function isMediaPath(url: URL): boolean {
  return MEDIA_EXTENSIONS.test(url.pathname);
}

/** True when a response Content-Type is media rather than a manifest/playlist. */
export function isMediaContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const t = contentType.split(';')[0].trim().toLowerCase();
  if (/mpegurl/.test(t)) return false; // audio/mpegurl, application/vnd.apple.mpegurl …
  return /^(video|audio|image)\//.test(t) || t === 'application/mp4' || t === 'text/vtt' || t === 'application/ttml+xml';
}
