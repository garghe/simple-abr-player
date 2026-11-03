/**
 * Plain-language explanations of why a stream could not load or play. The
 * player's own error (code and name) stays available as a detail line.
 */

const STATUS_TEXT: Record<number, string> = {
  400: 'bad request',
  401: 'not signed in: the stream needs a token or cookie',
  403: 'access denied: the stream may need a token, or be blocked in your region',
  404: 'not found: check the address',
  410: 'gone',
  429: 'too many requests',
  500: 'server error',
  502: 'bad gateway',
  503: 'service unavailable',
  504: 'gateway timeout',
};

export interface ErrorExplanation {
  /** One or two plain sentences: what went wrong. */
  summary: string;
  /** Technical detail (player error code and name), for a bug report. */
  detail: string;
}

interface PlayerErrorLike {
  code?: number;
  data?: unknown[];
  message?: string;
}

/** `codeName` maps a player error code to its name (e.g. 1001 → BAD_HTTP_STATUS). */
export function explainError(err: unknown, codeName: (code: number) => string | undefined = () => undefined): ErrorExplanation {
  const e = (err && typeof err === 'object' ? err : { message: String(err) }) as PlayerErrorLike;
  const code = typeof e.code === 'number' ? e.code : undefined;
  const data = Array.isArray(e.data) ? e.data : [];
  const name = code !== undefined ? codeName(code) : undefined;
  const info = data.filter((d) => typeof d === 'string' || typeof d === 'number').slice(0, 2).join(', ');
  const detail = code !== undefined ? `Player error ${code}${name ? ` ${name}` : ''}${info ? ` (${info})` : ''}` : (e.message ?? String(err));
  const viaProxy = typeof data[0] === 'string' && data[0].includes('/__proxy/');

  const summary = (() => {
    switch (code) {
      case 1001: {
        const status = Number(data[1]);
        if (viaProxy && status === 502) return 'The CORS proxy could not reach the server: check the address, or whether the server is up.';
        const text = STATUS_TEXT[status];
        return `The server answered HTTP ${status}${text ? ` (${text})` : ''}.`;
      }
      case 1002:
        return 'The request failed before the server answered: the address may be wrong or unreachable, or the server does not allow browser access (CORS).';
      case 1003:
        return 'The server took too long to answer.';
      case 4000: {
        const type = typeof data[1] === 'string' && data[1] ? ` (the server sent ${data[1]})` : '';
        return `This address is not a DASH (.mpd) or HLS (.m3u8) manifest${type}.`;
      }
      case 4001:
      case 4002:
      case 4003:
      case 4004:
        return 'The DASH manifest could not be read: it is not valid XML or misses required elements.';
      case 4015:
      case 4016:
      case 4017:
        return 'The HLS playlist could not be read: it is not a valid playlist.';
      case 4022:
      case 4023:
        return 'The manifest has no streams this player can use.';
      case 4032:
      case 4040:
        return 'This browser cannot decode the stream’s codecs.';
      case 7000:
        return 'Loading was interrupted (another stream was loaded).';
    }
    if (code !== undefined && code >= 6000 && code < 7000) return 'The stream is protected (DRM) and could not be unlocked.';
    if (code !== undefined && code >= 3000 && code < 4000) return 'The browser could not play the media (a decoding or media source error).';
    if (code === undefined && /close tag|xml|Line: \d+|parse/i.test(detail)) return 'The manifest could not be read: the server may have sent a web page or an error page instead.';
    return 'The player could not load this stream.';
  })();
  return { summary, detail };
}
