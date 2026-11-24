import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const html = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The Mesh SDK (Lace wallet) uses Node built-ins (crypto, Buffer, process).
  plugins: [nodePolyfills()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
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
