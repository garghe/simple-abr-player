import { describe, expect, it } from 'vitest';
import { fromProxyUrl, isProxied, toProxyUrl } from '../src/player/proxy';
import { isHostAllowed, parseProxyPath } from '../server/proxy-shared';

const ORIGIN = 'http://localhost:5173';

describe('proxy URL mapping', () => {
  it('round-trips https URLs with query strings', () => {
    const url = 'https://cdn.example.com:8443/a/b/master.m3u8?token=abc&x=1';
    const proxied = toProxyUrl(url, ORIGIN);
    expect(proxied).toBe('http://localhost:5173/__proxy/https/cdn.example.com:8443/a/b/master.m3u8?token=abc&x=1');
    expect(isProxied(proxied, ORIGIN)).toBe(true);
    expect(fromProxyUrl(proxied, ORIGIN)).toBe(url);
    expect(toProxyUrl(proxied, ORIGIN)).toBe(proxied);
  });

  it('keeps relative segment URIs inside the proxy namespace', () => {
    const proxied = toProxyUrl('https://cdn.example.com/a/b/master.m3u8', ORIGIN);
    expect(new URL('../c/seg-1.m4s', proxied).toString()).toBe(
      'http://localhost:5173/__proxy/https/cdn.example.com/a/c/seg-1.m4s',
    );
  });

  it('leaves non-http URLs alone', () => {
    expect(toProxyUrl('data:text/plain,hi', ORIGIN)).toBe('data:text/plain,hi');
  });

  it('server parses the target from the path', () => {
    expect(parseProxyPath('/__proxy/https/example.com/x.mpd?a=1')?.toString()).toBe('https://example.com/x.mpd?a=1');
    expect(parseProxyPath('/__proxy/ftp/example.com/x')).toBeNull();
    expect(parseProxyPath('/other')).toBeNull();
  });
});

describe('isHostAllowed', () => {
  it('allows everything when the list is empty', () => {
    expect(isHostAllowed('any.example.com', [])).toBe(true);
  });
  it('matches exact hosts and *.wildcards', () => {
    const list = ['cdn.example.com', '*.akamaized.net'];
    expect(isHostAllowed('cdn.example.com', list)).toBe(true);
    expect(isHostAllowed('CDN.example.com', list)).toBe(true);
    expect(isHostAllowed('a.b.akamaized.net', list)).toBe(true);
    expect(isHostAllowed('akamaized.net', list)).toBe(true);
    expect(isHostAllowed('evil-akamaized.net', list)).toBe(false);
    expect(isHostAllowed('other.example.com', list)).toBe(false);
  });
});
