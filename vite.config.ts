/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { corsProxyPlugin } from './server/proxy-plugin.ts';

export default defineConfig({
  // Relative base so the static build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [corsProxyPlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
