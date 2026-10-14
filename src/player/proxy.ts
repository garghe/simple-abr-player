/**
 * Client side of the local CORS proxy (see server/proxy-plugin.ts).
 *
 * A URL such as https://cdn.example.com/live/master.m3u8?token=1 becomes
 * /__proxy/https/cdn.example.com/live/master.m3u8?token=1. Keeping the
 * original path structure means relative URIs inside manifests still resolve
 * to proxied URLs without rewriting the manifest body.
 */

export const PROXY_PREFIX = '/__proxy/';

export type ProxyMode = 'off' | 'auto' | 'always';

export function toProxyUrl(url: string, origin = globalThis.location?.origin ?? ''): string {
  if (isProxied(url, origin)) return url;
  const m = url.match(/^(https?):\/\/(.+)$/i);
  if (!m) return url;
  return `${origin}${PROXY_PREFIX}${m[1].toLowerCase()}/${m[2]}`;
}

export function isProxied(url: string, origin = globalThis.location?.origin ?? ''): boolean {
  return url.startsWith(`${origin}${PROXY_PREFIX}`) || url.startsWith(PROXY_PREFIX);
}

export function fromProxyUrl(url: string, origin = globalThis.location?.origin ?? ''): string {
  let rest: string | null = null;
  if (url.startsWith(`${origin}${PROXY_PREFIX}`)) rest = url.slice(origin.length + PROXY_PREFIX.length);
  else if (url.startsWith(PROXY_PREFIX)) rest = url.slice(PROXY_PREFIX.length);
  if (rest === null) return url;
  const m = rest.match(/^(https?)\/(.+)$/i);
  return m ? `${m[1]}://${m[2]}` : url;
}

export interface ProxyInfo {
  /** 'local' = Vite dev/preview server, 'cloudflare' = deployed Worker. */
  kind: 'local' | 'cloudflare';
  /** Whether media segments may go through the proxy. */
  segments: boolean;
}

/** Asks the server which proxy (if any) it offers. Null when there is none. */
export async function detectProxy(): Promise<ProxyInfo | null> {
  try {
    const res = await fetch(`${PROXY_PREFIX}health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    if (body === 'ok') return { kind: 'local', segments: true }; // older servers
    const json = JSON.parse(body) as { status?: string; kind?: string; segments?: boolean };
    if (json.status !== 'ok') return null;
    return { kind: json.kind === 'cloudflare' ? 'cloudflare' : 'local', segments: json.segments === true };
  } catch {
    return null;
  }
}

/**
 * Decides where one request goes. Manifests and playlists use the proxy when
 * proxying is on; segments only when the proxy allows them. A segment whose
 * URL was resolved against a proxied playlist (relative URI) is turned back
 * into a direct URL, so it never consumes a proxy request by accident.
 */
export function routeUri(
  uri: string,
  opts: { useProxy: boolean; isManifest: boolean; segmentsAllowed: boolean; origin?: string },
): string {
  const origin = opts.origin ?? globalThis.location?.origin ?? '';
  const proxyThis = opts.useProxy && (opts.isManifest || opts.segmentsAllowed);
  // Files on the app's own site never need the proxy.
  const sameSite = origin !== '' && uri.startsWith(`${origin}/`) && !isProxied(uri, origin);
  if (proxyThis) return /^https?:/i.test(uri) && !sameSite ? toProxyUrl(uri, origin) : uri;
  return isProxied(uri, origin) ? fromProxyUrl(uri, origin) : uri;
}
