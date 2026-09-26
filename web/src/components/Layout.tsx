import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuth } from '../lib/auth';
import { clock, usePomodoro } from '../lib/pomodoro';
import { FocusOverlay } from '../pages/Focus';
import { Logo, LogoMark } from './Logo';
import { Menu } from './ui';

function initials(name?: string) {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '·';
}

/** Indicador discreto do Pomodoro em andamento (abre o foco por cima da tela). */
function FocusChip() {
  const p = usePomodoro();
  if (p.phase === 'idle') return null;
  return (
    <button onClick={() => p.setExpanded(true)} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[13px] transition hover:border-ink" aria-label="Pomodoro em andamento">
      <span className={clsx('h-1.5 w-1.5 rounded-full', p.phase === 'focus' ? 'bg-today' : 'dot-mint', !p.running && 'opacity-40')} />
      <span className="tabular">{clock(p.left)}</span>
      <span className="hidden max-w-[10rem] truncate text-ink-2 sm:inline">{p.phase === 'break' ? 'pausa' : p.subject?.name ?? 'foco'}</span>
    </button>
  );
}

/** Uma tela principal de estudo; o resto (provas, revisões, configurações) fica no menu do perfil. */
export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const home = loc.pathname === '/planner';
  const profile = (
    <Menu label="Perfil" trigger={
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-[13px] font-medium text-ink hover:border-ink">{initials(user?.isGuest ? 'Visitante' : user?.name)}</span>
    } items={[
      { label: user?.isGuest ? 'Criar conta' : 'Meu perfil', onClick: () => nav('/configuracoes') },
      { label: 'Provas', onClick: () => nav('/provas') },
      { label: 'Revisões', onClick: () => nav('/revisoes') },
      { label: 'Configurações', onClick: () => nav('/configuracoes') },
      { label: 'Sair', onClick: async () => { await logout(); nav('/login'); }, destructive: true, divider: true },
    ]} />
  );

  const width = 'max-w-7xl';
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md">
        <div className={clsx('mx-auto flex h-16 items-center', width, 'justify-between gap-6 px-5 sm:px-8')}>
          <Link to="/planner" className="flex shrink-0 items-center transition-opacity hover:opacity-70" aria-label="Planner">
            <span className="hidden sm:flex"><Logo /></span>
            <span className="flex sm:hidden"><LogoMark /></span>
          </Link>
          <div className="flex items-center gap-3">
            {!home && <Link to="/planner" className="text-[14px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">← Voltar ao planner</Link>}
            <FocusChip />
            {profile}
          </div>
        </div>
        <div className={clsx('mx-auto px-5 sm:px-8', width)}><div className="h-px bg-line" /></div>
      </header>

      <main key={loc.pathname} className={clsx('mx-auto px-5 pt-8 pb-24 sm:px-8 sm:pt-12', width, home && 'fit:pt-5 fit:pb-5')}>
        <Outlet />
      </main>
      <FocusOverlay />
    </div>
  );
}
