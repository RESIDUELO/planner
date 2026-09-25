import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { initSupabase } from './lib/supabase';
import { App } from './App';
import { SetupNeeded } from './pages/SetupNeeded';
import { initTheme } from './lib/theme';
import './index.css';

initTheme();

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: false } },
});

// GitHub Pages: o 404.html redireciona rotas profundas para cá (ver vite.config.ts)
const redirect = sessionStorage.getItem('rp-redirect');
if (redirect) {
  sessionStorage.removeItem('rp-redirect');
  history.replaceState(null, '', redirect);
}

const root = createRoot(document.getElementById('root')!);
initSupabase().then((cfg) => {
  root.render(
    <StrictMode>
      {!cfg ? <SetupNeeded /> : (
        <QueryClientProvider client={qc}>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      )}
    </StrictMode>,
  );
});
