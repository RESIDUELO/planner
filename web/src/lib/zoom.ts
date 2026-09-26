/**
 * Tela larga (computador, tablet ou celular deitados): o workspace inteiro cabe
 * na tela, como no computador. A referência é uma tela de 1000px de altura útil;
 * em telas mais baixas (ex.: 1080p com escala de 125% do Windows ≈ 770px, tablet
 * deitado ≈ 800px, celular deitado ≈ 410px) tudo diminui na mesma proporção.
 * Em pé (celular, tablet) fica o layout empilhado, sem escala.
 *
 * Classes em <html>: `rp-wide` liga a variante `fit:` do Tailwind (index.css).
 * --app-h guarda a altura da janela já descontada a escala (use no lugar de 100vh).
 */
import { useSyncExternalStore } from 'react';

const REF_HEIGHT = 1000;
/** Abaixo disso a letra ficaria pequena demais (celular deitado usa este mínimo). */
const MIN_ZOOM = 0.6;

function mode() {
  const w = innerWidth, h = innerHeight;
  const wide = (w >= 1024 && h >= 600) || (w > h && w >= 640);
  const zoom = wide ? Math.min(1, Math.max(MIN_ZOOM, h / REF_HEIGHT)) : 1;
  return { wide, zoom };
}

const listeners = new Set<() => void>();
let wideNow = false;

export function applyZoom() {
  const d = document.documentElement;
  const { wide, zoom } = mode();
  d.classList.toggle('rp-wide', wide);
  d.style.zoom = zoom === 1 ? '' : String(zoom);
  d.style.setProperty('--app-h', `${innerHeight / zoom}px`);
  d.style.setProperty('--rp-zoom', String(zoom));
  if (wide !== wideNow) { wideNow = wide; listeners.forEach((l) => l()); }
}

export function initZoom() {
  applyZoom();
  addEventListener('resize', applyZoom);
  addEventListener('orientationchange', applyZoom);
}

/** true na tela larga (layout do computador). */
export function useWide() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => wideNow,
    () => false,
  );
}
