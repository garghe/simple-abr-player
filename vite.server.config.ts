// Bundles server/container.ts (the Docker image's server) into
// dist-server/server.mjs: one file that needs only Node.js. `npm run build:server`.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/container.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
});
