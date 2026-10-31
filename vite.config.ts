/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { corsProxyPlugin } from './server/proxy-plugin.ts';

// Version and release date shown in the header: set both in package.json when releasing
// (an empty releaseDate shows "pre-release").
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __RELEASE_DATE__: JSON.stringify(pkg.releaseDate ?? ''),
  },
  // Relative base so the static build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [corsProxyPlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
