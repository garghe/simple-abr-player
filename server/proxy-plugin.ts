import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Connect, Plugin } from 'vite';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import {
  CORS_HEADERS,
  CUSTOM_HEADER_PREFIX,
  type ProxyHealth,
  FORWARD_REQUEST_HEADERS,
  FORWARD_RESPONSE_HEADERS,
  PREFIX,
  parseProxyPath,
  proxiedLocation,
} from './proxy-shared.ts';

export { parseProxyPath };

/**
 * Local CORS proxy for the Vite dev and preview servers.
 *
 *   GET /__proxy/https/cdn.example.com/path/master.m3u8?x=1
 *     -> GET https://cdn.example.com/path/master.m3u8?x=1
 *
 * Many origin servers and CDNs do not send Access-Control-Allow-Origin, so a
 * browser page cannot fetch their manifests directly. The proxy fetches
 * server-side and adds the CORS headers. Redirects are turned into redirects
 * to the proxied target so relative segment URIs keep resolving correctly.
 *
 * Outbound requests honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY, so it also
 * works behind a corporate proxy.
 *
 * Only intended for local use: Vite binds to localhost by default. Do not
 * expose it on a public interface.
 */

const hasProxyEnv = () =>
  Boolean(
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
  );

let dispatcher: EnvHttpProxyAgent | undefined;
const getDispatcher = () => {
  if (!hasProxyEnv()) return undefined;
  dispatcher ??= new EnvHttpProxyAgent();
  return dispatcher;
};

function setCors(res: ServerResponse) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

async function handle(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const url = req.url ?? '';
  if (!url.startsWith(PREFIX)) return next();

  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (url === `${PREFIX}health`) {
    const health: ProxyHealth = { status: 'ok', kind: 'local', segments: true };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(health));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const target = parseProxyPath(url);
  if (!target) {
    res.statusCode = 400;
    return res.end('Expected /__proxy/<http|https>/<host>/<path>');
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = req.headers[name];
    if (typeof v === 'string') headers[name] = v;
  }
  // Custom headers set in the UI arrive as X-Proxy-Header-<Name>.
  for (const [name, v] of Object.entries(req.headers)) {
    if (name.startsWith(CUSTOM_HEADER_PREFIX) && typeof v === 'string') {
      headers[name.slice(CUSTOM_HEADER_PREFIX.length)] = v;
    }
  }

  const controller = new AbortController();
  req.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    const upstream = await undiciFetch(target, {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: controller.signal,
      dispatcher: getDispatcher(),
    });

    res.setHeader('X-Proxy-Target', target.toString());
    res.setHeader('X-Proxy-Status', String(upstream.status));

    const location = upstream.headers.get('location');
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      res.statusCode = upstream.status;
      res.setHeader('Location', proxiedLocation(location, target));
      return res.end();
    }

    res.statusCode = upstream.status;
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(name);
      // fetch() transparently decompresses, so the upstream length may be wrong.
      if (v && !(name === 'content-length' && upstream.headers.get('content-encoding'))) {
        res.setHeader(name, v);
      }
    }
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    Readable.fromWeb(upstream.body as never).pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    const message = err instanceof Error ? `${err.message}${err.cause ? ` (${String((err.cause as Error).message ?? err.cause)})` : ''}` : String(err);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Proxy error fetching ${target}: ${message}`);
  }
}

export function corsProxyPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    handle(req, res, next).catch(next);
  };
  return {
    name: 'local-cors-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
