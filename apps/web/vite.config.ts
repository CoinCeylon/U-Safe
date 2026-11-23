import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const html = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
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
      },
    },
  },
});
