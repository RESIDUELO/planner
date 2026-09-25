import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3001' } },
  build: { outDir: '../dist', emptyOutDir: true },
});
