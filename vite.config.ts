import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

export default defineConfig({
  base: './',
  // 版本号唯一来源是 package.json，避免 APP_VERSION 与安装包版本各写一份而不同步
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('react-markdown') ||
            id.includes('remark-') ||
            id.includes('rehype-') ||
            id.includes('micromark') ||
            id.includes('mdast-') ||
            id.includes('hast-') ||
            id.includes('unified') ||
            id.includes('vfile')
          ) {
            return 'vendor-markdown';
          }
          if (id.includes('fflate')) {
            return 'vendor-archive';
          }
          if (id.includes('dexie')) {
            return 'vendor-db';
          }
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
});
