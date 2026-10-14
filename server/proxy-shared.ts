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
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Date, Age, X-Proxy-Target, X-Proxy-Status',
};

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
