import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { BarChart2, BookOpen, CalendarDays, RotateCcw, Timer } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { clock, usePomodoro } from '../lib/pomodoro';
import { Logo, LogoMark } from './Logo';
import { Menu } from './ui';

const NAV = [
  { to: '/planner', label: 'Planner' },
  { to: '/foco', label: 'Foco' },
  { to: '/revisoes', label: 'Revisões' },
  { to: '/provas', label: 'Provas' },
  { to: '/desempenho', label: 'Desempenho' },
];
const TABS = [
  { to: '/planner', label: 'Planner', icon: BookOpen },
  { to: '/foco', label: 'Foco', icon: Timer },
  { to: '/revisoes', label: 'Revisões', icon: RotateCcw },
  { to: '/provas', label: 'Provas', icon: CalendarDays },
  { to: '/desempenho', label: 'Desempenho', icon: BarChart2 },
];

function initials(name?: string) {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '·';
}

/** Indicador discreto do Pomodoro em andamento. */
function FocusChip() {
  const p = usePomodoro();
  const loc = useLocation();
  if (p.phase === 'idle' || loc.pathname === '/foco') return null;
  return (
    <Link to="/foco" className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[13px] transition hover:border-ink" aria-label="Pomodoro em andamento">
      <span className={clsx('h-1.5 w-1.5 rounded-full', p.phase === 'focus' ? 'bg-today' : 'dot-mint', !p.running && 'opacity-40')} />
      <span className="tabular">{clock(p.left)}</span>
      <span className="hidden max-w-[10rem] truncate text-ink-2 sm:inline">{p.phase === 'break' ? 'pausa' : p.subject?.name ?? 'foco'}</span>
    </Link>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const profile = (
    <Menu label="Perfil" trigger={
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-[12px] font-medium text-ink hover:border-ink">{initials(user?.isGuest ? 'Visitante' : user?.name)}</span>
    } items={[
      { label: user?.isGuest ? 'Criar conta' : 'Configurações', onClick: () => nav('/configuracoes') },
      { label: 'Configurações', onClick: () => nav('/configuracoes'), hidden: !user?.isGuest },
      { label: 'Sair', onClick: async () => { await logout(); nav('/login'); }, destructive: true },
    ]} />
  );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link to="/planner" className="flex shrink-0 items-center transition-opacity hover:opacity-70" aria-label="Planner">
            <span className="hidden sm:flex"><Logo /></span>
            <span className="flex sm:hidden"><LogoMark /></span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((i) => (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('border-b py-0.5 text-[14px] transition-colors duration-150', isActive ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <FocusChip />
            {profile}
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-5 sm:px-8"><div className="h-px bg-line" /></div>
      </header>

      <main key={loc.pathname} className="mx-auto max-w-5xl px-5 pt-10 pb-32 sm:px-8 sm:pt-14 md:pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {TABS.map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] transition-colors', isActive ? 'text-ink' : 'text-ink-3')}>
            <i.icon className="h-[21px] w-[21px]" strokeWidth={1.5} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
