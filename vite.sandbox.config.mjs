import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the Google Picker sandbox page as its own bundle, separate from the
// panel's React app — sandboxed pages (manifest `sandbox.pages`) run with no
// chrome.* access, so this must not pull in any panel code that assumes it.
// Runs after the panel build with emptyOutDir:false so it appends to dist/.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'picker-sandbox': path.resolve(__dirname, 'picker-sandbox.html'),
      },
    },
  },
});
