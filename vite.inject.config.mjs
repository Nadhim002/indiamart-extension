import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the page-injected helper as a single self-executing (IIFE) classic
// script — it is injected via chrome.scripting with world:'MAIN' and files:[],
// so it cannot use runtime ESM. The shared parsers and lead policy are inlined
// at build time. Runs with emptyOutDir:false so it appends to dist/.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/panel'),
    },
  },
  build: {
    emptyOutDir: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: path.resolve(__dirname, 'src/inject/utils-inject.js'),
      name: '__imInject',
      formats: ['iife'],
      fileName: () => 'utils-inject.js',
    },
  },
});
