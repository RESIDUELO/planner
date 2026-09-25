import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { BarChart3, CalendarCheck, ClipboardList, LayoutDashboard, LogOut, Settings, BookOpenCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo } from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/provas', label: 'Provas', icon: ClipboardList },
  { to: '/planner', label: 'Planner', icon: BookOpenCheck },
  { to: '/revisoes', label: 'Revisões', icon: CalendarCheck },
  { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const items = NAV;
  return (
    <div className="min-h-full lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <i.icon className="h-4.5 w-4.5" /> {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <div className="truncate text-sm font-medium text-slate-900">{user?.name}</div>
          <div className="truncate text-xs text-slate-500">{user?.isGuest ? 'Modo visitante' : user?.email}</div>
          <button onClick={async () => { await logout(); nav('/login'); }} className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-800">
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">
        {user?.isGuest && (
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-xs text-brand-800">
            Você está no modo visitante: seu progresso fica salvo neste navegador. <NavLink to="/configuracoes" className="font-semibold underline">Crie uma conta</NavLink> para acessá-lo em outros dispositivos.
          </div>
        )}
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')}>
            <i.icon className="h-5 w-5" />
            <span className="max-w-full truncate px-0.5">{i.label === 'Configurações' ? 'Ajustes' : i.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
