import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { planet: resolve('index.html'), settings: resolve('settings.html') },
    },
    chunkSizeWarningLimit: 750,
  },
});
