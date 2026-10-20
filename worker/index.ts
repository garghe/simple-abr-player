/**
 * Cloudflare Worker for the deployed app.
 *
 * Static files (the Vite build in ./dist) are served by Workers Static Assets
 * before this code runs. The Worker only sees requests that match no file:
 *
 *  - /__proxy/...  the CORS proxy, same contract as the local dev proxy.
 *                  Disabled unless the PROXY_ENABLED variable is "true".
 *  - anything else falls through to the assets binding (404).
 *
 * Variables (wrangler.jsonc "vars" or the Cloudflare dashboard):
 *   PROXY_ENABLED        "true" to turn the proxy on (default "false").
 *   PROXY_ALLOWED_HOSTS  Comma-separated origin hosts the proxy may fetch,
 *                        e.g. "*.akamaized.net,cdn.example.com".
 *                        Empty = any host (only do this behind Cloudflare Access).
 *   PROXY_SEGMENTS       "true" to also proxy media segments. Default "false":
 *                        only manifests/playlists are proxied, so playback does
 *                        not burn one Worker request per segment. The app reads
 *                        this from /__proxy/health and sends segments directly;
 *                        the Worker also refuses segment requests itself.
 */

import {
  CORS_HEADERS,
  CUSTOM_HEADER_PREFIX,
  MAX_POST_BYTES,
  type ProxyHealth,
  isMediaContentType,
  isMediaPath,
  FORWARD_REQUEST_HEADERS,
  FORWARD_RESPONSE_HEADERS,
  PREFIX,
  isHostAllowed,
  parseProxyPath,
  proxiedLocation,
} from '../server/proxy-shared.ts';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PROXY_ENABLED?: string;
  PROXY_ALLOWED_HOSTS?: string;
  PROXY_SEGMENTS?: string;
}

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...extra },
  });

export async function handleProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const enabled = env.PROXY_ENABLED === 'true';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  // The app calls /health at start-up to decide whether to offer the proxy.
  const segments = env.PROXY_SEGMENTS === 'true';
  if (url.pathname === `${PREFIX}health`) {
    if (!enabled) return text('disabled', 404);
    const health: ProxyHealth = { status: 'ok', kind: 'cloudflare', segments };
    return text(JSON.stringify(health), 200, { 'Content-Type': 'application/json' });
  }
  if (!enabled) return text('The CORS proxy is disabled on this deployment (PROXY_ENABLED is not "true").', 404);
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') return text('Method not allowed', 405);

  const target = parseProxyPath(url.pathname + url.search);
  if (!target) return text('Expected /__proxy/<http|https>/<host>/<path>', 400);

  const allowed = (env.PROXY_ALLOWED_HOSTS ?? '').split(',').filter((h) => h.trim());
  if (!isHostAllowed(target.hostname, allowed)) {
    return text(`Host ${target.hostname} is not in PROXY_ALLOWED_HOSTS`, 403);
  }

  // POST = DRM license request: small body, never media.
  let body: ArrayBuffer | undefined;
  if (request.method === 'POST') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_POST_BYTES) return text('Request body too large for the proxy (license requests only)', 413);
  }

  // Guardrail: refuse segments before fetching anything (no origin traffic).
  if (!segments && request.method !== 'POST' && isMediaPath(target)) {
    return text('Media segments are not proxied on this deployment (PROXY_SEGMENTS is not "true").', 403);
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  for (const [name, v] of request.headers) {
    if (name.startsWith(CUSTOM_HEADER_PREFIX)) headers.set(name.slice(CUSTOM_HEADER_PREFIX.length), v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { method: request.method, headers, body, redirect: 'manual' });
  } catch (err) {
    return text(`Proxy error fetching ${target}: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  // Guardrail, second check: segments without a telling file extension.
  if (!segments && isMediaContentType(upstream.headers.get('content-type'))) {
    await upstream.body?.cancel();
    return text('Media segments are not proxied on this deployment (PROXY_SEGMENTS is not "true").', 403);
  }

  const out = new Headers(CORS_HEADERS);
  out.set('X-Proxy-Target', target.toString());
  out.set('X-Proxy-Status', String(upstream.status));

  const location = upstream.headers.get('location');
  if (upstream.status >= 300 && upstream.status < 400 && location) {
    out.set('Location', proxiedLocation(location, target));
    return new Response(null, { status: upstream.status, headers: out });
  }
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v && !(name === 'content-length' && upstream.headers.get('content-encoding'))) out.set(name, v);
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(PREFIX)) return handleProxy(request, env);
    return env.ASSETS.fetch(request);
  },
};
