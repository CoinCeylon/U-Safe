import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const html = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The dev server normally proxies to the default API port. The override lets
// isolated test harnesses run their own server/database and multiple web
// origins without disturbing a developer's running instance.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  // The Mesh SDK (Lace wallet) uses Node built-ins (crypto, Buffer, process).
  plugins: [nodePolyfills()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        landing: html('./index.html'),
        student: html('./student/index.html'),
        university: html('./university/index.html'),
        ugc: html('./ugc/index.html'),
        ui: html('./src/ui/dev.html'),
        crypto: html('./crypto.html'),
      },
    },
  },
});
