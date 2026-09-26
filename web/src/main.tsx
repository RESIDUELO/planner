import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { PomodoroProvider } from './lib/pomodoro';
import { initSupabase } from './lib/supabase';
import { App } from './App';
import { SetupNeeded } from './pages/SetupNeeded';
import { initTheme } from './lib/theme';
import { initZoom } from './lib/zoom';
import { IS_LOCAL } from './lib/platform';
import './index.css';

initTheme();
initZoom();

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: false } },
});

// GitHub Pages: o 404.html redireciona rotas profundas para cá (ver vite.config.ts)
const redirect = sessionStorage.getItem('rp-redirect');
if (redirect) {
  sessionStorage.removeItem('rp-redirect');
  history.replaceState(null, '', redirect);
}

// Versão nova publicada? Recarrega uma vez (o GitHub Pages guarda o HTML em cache por até 10 min)
async function checkForNewVersion() {
  try {
    const html = await (await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' })).text();
    const latest = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    const current = [...document.scripts].map((s) => s.src).find((src) => /assets\/index-[\w-]+\.js/.test(src));
    if (!latest || !current || current.endsWith(latest)) { sessionStorage.removeItem('rp-reloaded-for'); return; }
    if (sessionStorage.getItem('rp-reloaded-for') === latest) return; // já tentou para esta versão
    sessionStorage.setItem('rp-reloaded-for', latest);
    location.reload();
  } catch { /* sem rede: segue com a versão atual */ }
}
if (import.meta.env.PROD && !IS_LOCAL) {
  checkForNewVersion();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForNewVersion(); });
}

const root = createRoot(document.getElementById('root')!);
initSupabase().catch((e) => {
  // App off-line: o banco do aparelho não abriu (mostra o motivo em vez de uma tela vazia)
  root.render(
    <div style={{ padding: '64px 24px', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 28 }}>Não foi possível abrir o planner.</p>
      <p style={{ marginTop: 12, color: 'var(--ink-2)' }}>{String(e?.message ?? e)}</p>
    </div>,
  );
  return undefined;
}).then((cfg) => {
  if (cfg === undefined) return;
  root.render(
    <StrictMode>
      {!cfg ? <SetupNeeded /> : (
        <QueryClientProvider client={qc}>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthProvider>
              <PomodoroProvider>
                <App />
              </PomodoroProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      )}
    </StrictMode>,
  );
});
