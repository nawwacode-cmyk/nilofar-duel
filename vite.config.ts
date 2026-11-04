/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// web/ holds the HTML entry, public/ is copied verbatim (landing page, models, sounds, icons, config.js).
// Output keeps the original URL layout: /index.html (landing) and /play/ (game).
export default defineConfig({
  root: 'web',
  publicDir: '../public',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'play/build',
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { play: resolve(__dirname, 'web/play/index.html') } },
  },
  server: { open: '/play/' },
  test: { root: resolve(__dirname), include: ['tests/**/*.test.ts'] },
});
