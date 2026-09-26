import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GitHub Pages não conhece as rotas do app (/planner/revisoes etc.). O
 * 404.html guarda o caminho pedido e volta para o index.html, que o restaura.
 */
function spaFallback(): Plugin {
  let outDir = '';
  let base = '/';
  return {
    name: 'spa-fallback-404',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); base = c.base; },
    closeBundle() {
      writeFileSync(resolve(outDir, '404.html'), `<!doctype html><meta charset="utf-8"><title>Residência Planner</title>
<script>sessionStorage.setItem('rp-redirect', location.pathname + location.search + location.hash);location.replace(${JSON.stringify(base)});</script>`);
    },
  };
}

/** App off-line: as fontes vêm no próprio app (sem Google Fonts). */
function offlineHtml(): Plugin {
  return {
    name: 'offline-html',
    transformIndexHtml: (html) => html.replace(/\s*<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, ''),
  };
}

// VITE_LOCAL=1 → build do app Android (banco no aparelho, sem login), em dist-app/
const APP = process.env.VITE_LOCAL === '1';

export default defineConfig({
  root: 'web',
  base: APP ? '/' : process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), APP ? offlineHtml() : spaFallback()],
  server: { port: 5173 },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { outDir: APP ? '../dist-app' : '../dist', emptyOutDir: true },
});
