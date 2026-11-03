import { describe, expect, it } from 'vitest';
import { explainError } from '../src/player/errors';

const names: Record<number, string> = { 1001: 'BAD_HTTP_STATUS', 1002: 'HTTP_ERROR', 4000: 'UNABLE_TO_GUESS_MANIFEST_TYPE' };
const name = (c: number) => names[c];

describe('error explanations', () => {
  it('turns HTTP statuses into plain words', () => {
    const r = explainError({ code: 1001, data: ['https://cdn/x.mpd', 404, ''] }, name);
    expect(r.summary).toBe('The server answered HTTP 404 (not found: check the address).');
    expect(r.detail).toBe('Player error 1001 BAD_HTTP_STATUS (https://cdn/x.mpd, 404)');
    expect(explainError({ code: 1001, data: ['https://cdn/x.mpd', 403] }).summary).toContain('access denied');
  });

  it('explains an unreachable server behind the proxy', () => {
    expect(explainError({ code: 1001, data: ['http://localhost/__proxy/https/nope.invalid/a.m3u8', 502] }).summary).toContain('could not reach the server');
  });

  it('explains a URL that is not a manifest', () => {
    expect(explainError({ code: 4000, data: ['https://site/', 'text/html'] }, name).summary).toBe('This address is not a DASH (.mpd) or HLS (.m3u8) manifest (the server sent text/html).');
  });

  it('explains a web page served instead of an MPD', () => {
    const r = explainError(new Error('Unexpected close tag Line: 62 Column: 13 Char: >'));
    expect(r.summary).toContain('web page or an error page');
    expect(r.detail).toContain('Unexpected close tag');
  });

  it('has a fallback for anything else', () => {
    expect(explainError({ code: 9999 }).summary).toBe('The player could not load this stream.');
    expect(explainError('boom').detail).toBe('boom');
  });
});
