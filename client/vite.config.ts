import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true, port: 5173,
    // local gateway (node server/index.js) handles auth/API in dev
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
  build: { target: 'es2020' },
});
