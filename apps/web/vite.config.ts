import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3001', changeOrigin: true } } },
  build: { sourcemap: false, target: 'es2022' },
  test: { name: 'web', include: ['test/**/*.test.ts'] },
} as any);
