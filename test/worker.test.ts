import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../worker/index';

const assets = { fetch: vi.fn(async () => new Response('asset', { status: 200 })) };
const env = (vars: Partial<Env> = {}): Env => ({ ASSETS: assets, PROXY_ENABLED: 'true', ...vars });
const req = (path: string, init?: RequestInit) => new Request(`https://player.example.workers.dev${path}`, init);

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Worker', () => {
  it('passes non-proxy paths to the assets binding', async () => {
    const res = await worker.fetch(req('/missing.txt'), env());
    expect(await res.text()).toBe('asset');
  });

  it('reports the proxy as unavailable when disabled', async () => {
    const health = await worker.fetch(req('/__proxy/health'), env({ PROXY_ENABLED: 'false' }));
    expect(health.status).toBe(404);
    const res = await worker.fetch(req('/__proxy/https/cdn.example.com/a.m3u8'), env({ PROXY_ENABLED: 'false' }));
    expect(res.status).toBe(404);
  });

  it('answers health when enabled', async () => {
    const res = await worker.fetch(req('/__proxy/health'), env());
    expect(await res.text()).toBe('ok');
  });

  it('proxies with CORS headers, forwards Range and custom headers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('#EXTM3U', { status: 206, headers: { 'content-type': 'application/vnd.apple.mpegurl', 'content-range': 'bytes 0-6/7' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(
      req('/__proxy/https/cdn.example.com/live/a.m3u8?t=1', { headers: { Range: 'bytes=0-6', 'X-Proxy-Header-Authorization': 'Bearer x' } }),
      env(),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-range')).toBe('bytes 0-6/7');
    expect(await res.text()).toBe('#EXTM3U');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cdn.example.com/live/a.m3u8?t=1');
    const headers = new Headers(init.headers);
    expect(headers.get('range')).toBe('bytes=0-6');
    expect(headers.get('authorization')).toBe('Bearer x');
  });

  it('rewrites redirects into the proxy namespace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://edge2.example.com/v/b.m3u8' } })));
    const res = await worker.fetch(req('/__proxy/https/cdn.example.com/a.m3u8'), env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/__proxy/https/edge2.example.com/v/b.m3u8');
  });

  it('enforces PROXY_ALLOWED_HOSTS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    const e = env({ PROXY_ALLOWED_HOSTS: '*.akamaized.net' });
    expect((await worker.fetch(req('/__proxy/https/cdn.example.com/a.mpd'), e)).status).toBe(403);
    expect((await worker.fetch(req('/__proxy/https/x.akamaized.net/a.mpd'), e)).status).toBe(200);
  });
});
