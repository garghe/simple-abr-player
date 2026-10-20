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

  it('reports its capabilities on /health', async () => {
    const res = await worker.fetch(req('/__proxy/health'), env());
    expect(await res.json()).toEqual({ status: 'ok', kind: 'cloudflare', segments: false });
    const withSegments = await worker.fetch(req('/__proxy/health'), env({ PROXY_SEGMENTS: 'true' }));
    expect(await withSegments.json()).toMatchObject({ segments: true });
  });

  it('refuses segments by file extension without contacting the origin', async () => {
    const fetchMock = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetchMock);
    for (const path of ['/v/chunk-1.m4s', '/v/seg.ts', '/v/init.mp4', '/subs/en.vtt', '/a/seg.aac?x=1']) {
      const res = await worker.fetch(req(`/__proxy/https/cdn.example.com${path}`), env());
      expect(res.status, path).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses segments by Content-Type when the URL has no extension', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes', { headers: { 'content-type': 'video/mp4' } })));
    const res = await worker.fetch(req('/__proxy/https/cdn.example.com/QualityLevels(1)/Fragments(video=0)'), env());
    expect(res.status).toBe(403);
  });

  it('still proxies playlists served with an audio/mpegurl type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U', { headers: { 'content-type': 'audio/mpegurl' } })));
    const res = await worker.fetch(req('/__proxy/https/cdn.example.com/live/index'), env());
    expect(res.status).toBe(200);
  });

  it('proxies segments when PROXY_SEGMENTS is true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes', { headers: { 'content-type': 'video/mp4' } })));
    const res = await worker.fetch(req('/__proxy/https/cdn.example.com/v/chunk-1.m4s'), env({ PROXY_SEGMENTS: 'true' }));
    expect(res.status).toBe(200);
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

  it('forwards DRM license POSTs with their body and content type', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await worker.fetch(
      req('/__proxy/https/license.example.com/widevine?token=1', {
        method: 'POST',
        body: new Uint8Array([9, 8, 7]),
        headers: { 'Content-Type': 'application/octet-stream', 'X-Proxy-Header-Authorization': 'Bearer t' },
      }),
      env({ PROXY_ALLOWED_HOSTS: 'license.example.com' }),
    );
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://license.example.com/widevine?token=1');
    expect(init.method).toBe('POST');
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array([9, 8, 7]));
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t');
    expect(new Headers(init.headers).get('content-type')).toBe('application/octet-stream');
  });

  it('refuses oversized POST bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x')));
    const res = await worker.fetch(req('/__proxy/https/license.example.com/l', { method: 'POST', body: new Uint8Array(300 * 1024) }), env());
    expect(res.status).toBe(413);
  });
});
