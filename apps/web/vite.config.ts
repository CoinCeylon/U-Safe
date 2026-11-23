import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const html = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: html('./index.html'),
        student: html('./student/index.html'),
        university: html('./university/index.html'),
        ugc: html('./ugc/index.html'),
      },
    },
  },
});
