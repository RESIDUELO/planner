/**
 * Escala do site no computador: a referência é uma tela de 1000px de altura útil.
 * Em telas mais baixas (ex.: 1080p com a escala de 125% do Windows ≈ 770px úteis),
 * tudo diminui na mesma proporção, para ficar com o mesmo tamanho e as mesmas
 * proporções da tela de referência. Celular e tablet não mudam.
 * --app-h guarda a altura da janela já descontada a escala (use no lugar de 100vh).
 */
const REF_HEIGHT = 1000;
const MIN_ZOOM = 0.72;

export function applyZoom() {
  const d = document.documentElement;
  const desktop = innerWidth >= 1024 && innerHeight >= 600;
  const z = desktop ? Math.min(1, Math.max(MIN_ZOOM, innerHeight / REF_HEIGHT)) : 1;
  d.style.zoom = z === 1 ? '' : String(z);
  d.style.setProperty('--app-h', `${innerHeight / z}px`);
}

export function initZoom() {
  applyZoom();
  addEventListener('resize', applyZoom);
}
