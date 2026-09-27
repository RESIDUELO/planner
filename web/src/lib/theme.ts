/**
 * Aparência: claro/escuro (segue o sistema por padrão) e a paleta de cores.
 * A paleta só troca cores (papel, tinta, linhas, destaques); nada muda de lugar.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Palette = 'classico' | 'lavanda' | 'rosa' | 'sage' | 'azul' | 'butter';
const KEY = 'rp-theme';
const PALETTE_KEY = 'rp-palette';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Nome e as três cores que representam a paleta (fundo, destaque, tinta). */
export const PALETTES: { id: Palette; name: string; swatch: [string, string, string] }[] = [
  { id: 'classico', name: 'Clássico', swatch: ['#f1eee8', '#d9d4ca', '#1c1b19'] },
  { id: 'lavanda', name: 'Lavanda', swatch: ['#f1eef3', '#d7cdea', '#262233'] },
  { id: 'rosa', name: 'Rosa', swatch: ['#f5ece9', '#ecc9cf', '#4a2029'] },
  { id: 'sage', name: 'Sage', swatch: ['#eef0e9', '#c9d5c0', '#23302a'] },
  { id: 'azul', name: 'Azul', swatch: ['#edf1f3', '#c8dbe6', '#173746'] },
  { id: 'butter', name: 'Butter', swatch: ['#f5f0e0', '#f0e2a0', '#1f1d16'] },
];

export function getTheme(): ThemePref {
  try { return (localStorage.getItem(KEY) as ThemePref) || 'system'; } catch { return 'system'; }
}

export function getPalette(): Palette {
  try { const p = localStorage.getItem(PALETTE_KEY) as Palette; return PALETTES.some((x) => x.id === p) ? p : 'classico'; } catch { return 'classico'; }
}

export function applyTheme(pref: ThemePref = getTheme(), palette: Palette = getPalette()) {
  const root = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  root.classList.toggle('dark', dark);
  if (palette === 'classico') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', palette);
  // Barra do navegador/celular na cor do papel
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas || (dark ? '#000000' : '#ffffff'));
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* sem armazenamento: vale só nesta sessão */ }
  applyTheme(pref);
}

export function setPalette(p: Palette) {
  try { localStorage.setItem(PALETTE_KEY, p); } catch { /* sem armazenamento: vale só nesta sessão */ }
  applyTheme(getTheme(), p);
}

export function initTheme() {
  applyTheme();
  media().addEventListener('change', () => getTheme() === 'system' && applyTheme('system'));
}
