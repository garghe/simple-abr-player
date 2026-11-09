/**
 * Server for the Docker image: serves the built app (./dist) and, when
 * PROXY_ENABLED is "true", the same CORS proxy as the Cloudflare Worker
 * (worker/index.ts), with the same variables:
 *
 *   PORT                 port to listen on (default 8080)
 *   STATIC_DIR           the built app (default ./dist)
 *   PROXY_ENABLED        "true" to turn the proxy on (default off)
 *   PROXY_ALLOWED_HOSTS  comma-separated hosts the proxy may fetch, e.g.
 *                        "*.akamaized.net,cdn.example.com"; empty = any host
 *   PROXY_SEGMENTS       "true" to also proxy media segments (default off)
 *
 * Bundled by `npm run build:server` into dist-server/server.mjs, which needs
 * nothing but Node.js.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { PREFIX } from './proxy-shared.ts';
import { handleProxy, type Env } from '../worker/index.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mpd': 'application/dash+xml',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.ts': 'video/mp2t',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt; charset=utf-8',
  '.webm': 'video/webm',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export interface ContainerOptions {
  staticDir: string;
  env: Env;
}

/** The file a URL path maps to inside `root`, or null if it would leave it. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(root, `.${normalize(`/${path}`)}`);
  return file === root || file.startsWith(root + sep) ? file : null;
}

async function proxy(req: IncomingMessage, res: ServerResponse, env: Env) {
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = new Uint8Array(Buffer.concat(chunks));
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body });
  const response = await handleProxy(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS }).end();
    return;
  }
  const file = resolveStatic(root, req.url ?? '/');
  let size = -1;
  if (file) {
    try {
      const st = statSync(file);
      if (st.isFile()) size = st.size;
    } catch {
      /* not found */
    }
  }
  if (!file || size < 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Not found');
    return;
  }

  // Hashed build files never change; the page itself is always revalidated.
  const rel = file.slice(root.length + 1).split(sep).join('/');
  const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : rel === 'index.html' ? 'no-cache' : 'public, max-age=3600';
  const headers: Record<string, string> = {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    ...SECURITY_HEADERS,
  };

  // Single byte ranges (players use them for SegmentBase streams).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...SECURITY_HEADERS }).end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(size ? end - start + 1 : 0);
  res.writeHead(headers['Content-Range'] ? 206 : 200, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  createReadStream(file, { start, end }).pipe(res);
}

export function createContainerServer({ staticDir, env }: ContainerOptions): Server {
  const root = resolve(staticDir);
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path.startsWith(PREFIX)) {
      proxy(req, res, env).catch((err) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    serveStatic(req, res, root);
  });
}

// Started as a program (not imported by the tests).
if (process.argv[1] && /server\.m?js$/.test(process.argv[1])) {
  const port = Number(process.env.PORT) || 8080;
  const env: Env = {
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
    PROXY_ENABLED: process.env.PROXY_ENABLED,
    PROXY_ALLOWED_HOSTS: process.env.PROXY_ALLOWED_HOSTS,
    PROXY_SEGMENTS: process.env.PROXY_SEGMENTS,
    PROXY_KIND: 'server',
  };
  const server = createContainerServer({ staticDir: process.env.STATIC_DIR ?? join(process.cwd(), 'dist'), env });
  server.listen(port, () => {
    const proxyState = env.PROXY_ENABLED === 'true' ? `on (hosts: ${env.PROXY_ALLOWED_HOSTS || 'any'}; segments: ${env.PROXY_SEGMENTS === 'true' ? 'yes' : 'no'})` : 'off';
    console.log(`PlayProbe listening on port ${port} · CORS proxy ${proxyState}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
