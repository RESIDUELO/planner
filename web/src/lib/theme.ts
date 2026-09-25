/** Aparência: segue o sistema por padrão; o aluno pode fixar claro ou escuro. */
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'rp-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getTheme(): ThemePref {
  try { return (localStorage.getItem(KEY) as ThemePref) || 'system'; } catch { return 'system'; }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#ffffff');
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* sem armazenamento: vale só nesta sessão */ }
  applyTheme(pref);
}

export function initTheme() {
  applyTheme();
  media().addEventListener('change', () => getTheme() === 'system' && applyTheme('system'));
}
