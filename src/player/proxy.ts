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

/** True when the dev/preview server exposes the proxy. */
export async function detectProxy(): Promise<boolean> {
  try {
    const res = await fetch(`${PROXY_PREFIX}health`, { cache: 'no-store' });
    return res.ok && (await res.text()).trim() === 'ok';
  } catch {
    return false;
  }
}
