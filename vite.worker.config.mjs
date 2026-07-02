import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the MV3 service worker as a single self-contained ES module so it can
// import the shared modules in src/shared (channels, firebase config, lead
// policy, push payload) instead of the old hand-copied public/*.js twins.
// Runs after the panel build with emptyOutDir:false so it appends to dist/.
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
      entry: path.resolve(__dirname, 'src/background/service-worker.js'),
      formats: ['es'],
      fileName: () => 'service-worker.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
