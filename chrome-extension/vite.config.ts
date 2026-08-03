import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@content': resolve(__dirname, 'src/content'),
      '@background': resolve(__dirname, 'src/background'),
      '@maxun-helpers': resolve(__dirname, '../src/helpers'),
    },
  },
  server: {
    fs: {
      // Allow importing canonical helpers from the monorepo web app.
      allow: [resolve(__dirname, '..')],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        datatable: resolve(__dirname, 'src/datatable/index.html'),
      },
    },
  },
});
