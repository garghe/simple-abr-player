import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainerServer, resolveStatic } from '../server/container';
import type { Env } from '../worker/index';

const root = mkdtempSync(join(tmpdir(), 'playprobe-static-'));
mkdirSync(join(root, 'assets'));
mkdirSync(join(root, 'samples'));
writeFileSync(join(root, 'index.html'), '<!doctype html><title>PlayProbe</title>');
writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(join(root, 'samples', 'dash.mpd'), '<MPD/>');
writeFileSync(join(root, 'samples', 'seg.m4s'), '0123456789');

const assets: Env['ASSETS'] = { fetch: async () => new Response('', { status: 404 }) };

async function start(env: Partial<Env>) {
  const server = createContainerServer({ staticDir: root, env: { ASSETS: assets, ...env } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

describe('container server: static files', () => {
  let base = '';
  let close = () => {};
  beforeAll(async () => {
    const s = await start({});
    base = s.base;
    close = () => s.server.close();
  });
  afterAll(() => close());

  it('serves the app with the right types and caching', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const js = await fetch(`${base}/assets/index-abc123.js`);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/samples/dash.mpd`)).headers.get('content-type')).toBe('application/dash+xml');
    expect((await fetch(`${base}/?url=x`)).status).toBe(200);
  });

  it('answers byte ranges', async () => {
    const part = await fetch(`${base}/samples/seg.m4s`, { headers: { Range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect((await fetch(`${base}/samples/seg.m4s`, { headers: { Range: 'bytes=-3' } }).then((r) => r.text()))).toBe('789');
    expect((await fetch(`${base}/samples/seg.m4s`, { headers: { Range: 'bytes=20-' } })).status).toBe(416);
  });

  it('never serves files outside the app', async () => {
    expect(resolveStatic(root, '/../../etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    expect(resolveStatic(root, '/%2e%2e/%2e%2e/etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    expect(resolveStatic(root, '/a%00b')).toBeNull();
    expect(resolveStatic(root, '/%E0%A4%A')).toBeNull();
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/samples`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('container server: CORS proxy', () => {
  it('is off unless PROXY_ENABLED is "true"', async () => {
    const { server, base } = await start({});
    const health = await fetch(`${base}/__proxy/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'disabled' });
    expect((await fetch(`${base}/__proxy/https/example.com/a.m3u8`)).status).toBe(404);
    server.close();
  });

  it('reports its capabilities and applies the host allowlist when on', async () => {
    const { server, base } = await start({ PROXY_ENABLED: 'true', PROXY_ALLOWED_HOSTS: 'cdn.example.com', PROXY_KIND: 'server' });
    expect(await (await fetch(`${base}/__proxy/health`)).json()).toEqual({ status: 'ok', kind: 'server', segments: false });
    const blocked = await fetch(`${base}/__proxy/https/other.example.org/a.m3u8`);
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get('access-control-allow-origin')).toBe('*');
    // Segments are refused before anything is fetched.
    expect((await fetch(`${base}/__proxy/https/cdn.example.com/seg-1.m4s`)).status).toBe(403);
    server.close();
  });
});
