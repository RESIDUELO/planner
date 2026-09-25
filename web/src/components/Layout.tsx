import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { BarChart2, BookOpen, CalendarDays, ClipboardList, House } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo, LogoMark } from './Logo';
import { Menu } from './ui';

const NAV = [
  { to: '/provas', label: 'Provas', icon: ClipboardList },
  { to: '/planner', label: 'Planner', icon: BookOpen },
  { to: '/revisoes', label: 'Revisões', icon: CalendarDays },
  { to: '/desempenho', label: 'Desempenho', icon: BarChart2 },
];
const TABS = [{ to: '/', label: 'Início', icon: House, end: true }, ...NAV];

function initials(name?: string) {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '·';
}

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const profile = (
    <Menu label="Perfil" trigger={
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-strong text-[13px] font-medium text-ink">{initials(user?.isGuest ? 'Visitante' : user?.name)}</span>
    } items={[
      { label: user?.isGuest ? 'Criar conta' : 'Configurações', onClick: () => nav('/configuracoes') },
      { label: 'Configurações', onClick: () => nav('/configuracoes'), hidden: !user?.isGuest },
      { label: 'Sair', onClick: async () => { await logout(); nav('/login'); }, destructive: true },
    ]} />
  );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-13 max-w-5xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link to="/" className="flex shrink-0 items-center transition-opacity hover:opacity-70" aria-label="Início">
            <span className="hidden sm:flex"><Logo /></span>
            <span className="flex sm:hidden"><LogoMark className="h-7 w-7" /></span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((i) => (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('text-[14px] transition-colors duration-150', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          {profile}
        </div>
      </header>

      <main key={loc.pathname} className="mx-auto max-w-5xl px-5 pt-10 pb-32 sm:px-8 sm:pt-16 md:pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-canvas/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden">
        {TABS.map((i) => (
          <NavLink key={i.to} to={i.to} end={'end' in i} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] transition-colors', isActive ? 'text-accent' : 'text-ink-3')}>
            <i.icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
