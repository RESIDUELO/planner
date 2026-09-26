import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Hospital, NotebookPen } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../lib/auth';
import { IS_LOCAL } from '../lib/platform';
import { clock, usePomodoro } from '../lib/pomodoro';
import { FocusOverlay } from '../pages/Focus';
import { LogoMark } from './Logo';
import { Menu } from './ui';

// Só no app Android: mantém o widget da tela inicial em dia
const WidgetSync = IS_LOCAL ? lazy(() => import('../local/widget').then((m) => ({ default: m.WidgetSync }))) : null;

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

/** PLANNER | AGENDA | RESIDÊNCIAS: as áreas principais, separadas. */
function Tabs() {
  const tab = ({ isActive }: { isActive: boolean }) => clsx('relative py-1 text-[10.5px] font-medium tracking-[0.12em] uppercase transition-colors min-[420px]:text-[12px] min-[420px]:tracking-[0.2em]',
    isActive ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink' : 'text-ink-3 hover:text-ink');
  return (
    <nav aria-label="Áreas" className="flex min-w-0 items-center gap-2.5 min-[420px]:gap-4 sm:gap-5">
      <NavLink to="/planner" className={tab}>Planner</NavLink>
      <span className="h-3 w-px bg-line" aria-hidden />
      <NavLink to="/agenda" className={tab}>Agenda</NavLink>
      <span className="h-3 w-px bg-line" aria-hidden />
      <NavLink to="/residencias" className={tab}>Residências</NavLink>
    </nav>
  );
}

/** Nome discreto ao lado do ícone, só com a barra recolhida. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 translate-x-[-4px] rounded-full border border-line bg-canvas px-2.5 py-1 text-[12px] whitespace-nowrap text-ink opacity-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

/** Texto que some (sem pular) quando a barra recolhe. */
function Label({ hidden, children, className }: { hidden: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-[250ms] ease-apple', hidden ? 'max-w-0 opacity-0' : 'max-w-[180px] opacity-100', className)}>
      {children}
    </span>
  );
}

const SIDEBAR_KEY = 'rp-sidebar';
function useCollapsed() {
  const [collapsed, set] = useState(() => {
    try { const v = localStorage.getItem(SIDEBAR_KEY); if (v) return v === 'closed'; } catch { /* ignore */ }
    return typeof innerWidth === 'number' && innerWidth < 1024; // telas menores começam recolhidas
  });
  const toggle = () => set((c) => { try { localStorage.setItem(SIDEBAR_KEY, c ? 'open' : 'closed'); } catch { /* ignore */ } return !c; });
  return [collapsed, toggle] as const;
}

/** Barra lateral: logo, recolher, Planner, Agenda e, embaixo, o perfil. */
function Sidebar({ collapsed, onToggle, profileItems, avatar, name }: {
  collapsed: boolean; onToggle: () => void; profileItems: Parameters<typeof Menu>[0]['items']; avatar: ReactNode; name: string;
}) {
  const p = usePomodoro();
  const item = ({ isActive }: { isActive: boolean }) => clsx('group relative flex h-10 items-center gap-3 px-[22px] transition-colors',
    isActive ? 'text-ink' : 'text-ink-3 hover:text-ink');
  const bar = ({ isActive }: { isActive: boolean }) => isActive && <span className="absolute top-1/2 left-0 h-5 w-px -translate-y-1/2 bg-ink" aria-hidden />;
  const text = 'text-[12px] font-medium tracking-[0.2em] uppercase';
  return (
    <aside aria-label="Navegação" data-testid="sidebar" data-collapsed={collapsed ? 'true' : 'false'}
      className="fixed top-0 left-0 z-30 hidden h-[var(--app-h,100vh)] w-[var(--sb-w)] flex-col border-r border-line bg-canvas py-6 transition-[width] duration-[250ms] ease-apple md:flex">
      <Link to="/planner" aria-label="Início" className="group relative flex items-center gap-3 px-4 transition-opacity hover:opacity-70">
        <LogoMark />
        <Label hidden={collapsed} className="flex flex-col">
          <span className="font-display text-[22px] leading-none">Planner</span>
          <span className="mt-1 text-[9.5px] tracking-[0.22em] text-ink-2 uppercase">Pablo e Samêla</span>
        </Label>
      </Link>

      <button onClick={onToggle} aria-label={collapsed ? 'Abrir menu' : 'Recolher menu'} aria-expanded={!collapsed}
        className="group relative mt-8 flex h-8 items-center gap-3 px-[22px] text-ink-3 transition-colors hover:text-ink">
        {collapsed ? <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={1.5} /> : <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
        <Label hidden={collapsed} className="text-[12px]">Recolher</Label>
        {collapsed && <Tip>Abrir</Tip>}
      </button>

      <nav aria-label="Áreas" className="mt-6 flex flex-col gap-1">
        <NavLink to="/planner" className={item}>
          {(s) => (<>{bar(s)}<NotebookPen className="h-5 w-5 shrink-0" strokeWidth={1.25} /><Label hidden={collapsed} className={text}>Planner</Label>{collapsed && <Tip>Planner</Tip>}</>)}
        </NavLink>
        <NavLink to="/agenda" className={item}>
          {(s) => (<>{bar(s)}<CalendarDays className="h-5 w-5 shrink-0" strokeWidth={1.25} /><Label hidden={collapsed} className={text}>Agenda</Label>{collapsed && <Tip>Agenda</Tip>}</>)}
        </NavLink>
        <NavLink to="/residencias" className={item}>
          {(s) => (<>{bar(s)}<Hospital className="h-5 w-5 shrink-0" strokeWidth={1.25} /><Label hidden={collapsed} className={text}>Residências</Label>{collapsed && <Tip>Residências</Tip>}</>)}
        </NavLink>
      </nav>

      <span className="flex-1" />

      {p.phase !== 'idle' && (
        <button onClick={() => p.setExpanded(true)} aria-label="Pomodoro em andamento" className="group relative mb-4 flex h-8 items-center gap-3 px-[26px] text-[13px] text-ink transition hover:opacity-70">
          <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', p.phase === 'focus' ? 'bg-today' : 'dot-mint', !p.running && 'opacity-40')} />
          <Label hidden={collapsed} className="tabular">{clock(p.left)} <span className="text-ink-2">{p.phase === 'break' ? 'pausa' : 'foco'}</span></Label>
          {collapsed && <Tip><span className="tabular">{clock(p.left)}</span></Tip>}
        </button>
      )}

      <div className="mx-4 mb-4 h-px bg-line" />
      <Menu label="Perfil" up className="group relative px-[14px]" items={profileItems} trigger={
        <span className="flex items-center gap-3">
          {avatar}
          <Label hidden={collapsed} className="text-left text-[13px] text-ink">{name}</Label>
          {collapsed && <Tip>Perfil</Tip>}
        </span>
      } />
    </aside>
  );
}

/** Uma tela principal de estudo; o resto (provas, revisões, configurações) fica no menu do perfil. */
export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const home = loc.pathname === '/planner' || loc.pathname === '/agenda';
  const [collapsed, toggle] = useCollapsed();
  const profileItems = [
    { label: user?.isGuest ? 'Criar conta' : 'Meu perfil', onClick: () => nav('/configuracoes') },
    { label: 'Provas', onClick: () => nav('/provas') },
    { label: 'Revisões', onClick: () => nav('/revisoes') },
    { label: 'Configurações', onClick: () => nav('/configuracoes') },
    { label: 'Sair', onClick: async () => { await logout(); nav('/login'); }, destructive: true, divider: true, hidden: IS_LOCAL },
  ];
  const avatar = <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-[13px] font-medium text-ink hover:border-ink">{initials(user?.isGuest ? 'Visitante' : user?.name)}</span>;

  // O limite de largura acompanha a barra: recolher sempre dá esse espaço ao conteúdo
  const width = 'max-w-[calc(1504px-var(--sb-w))] fit:max-w-[calc(1664px-var(--sb-w))]';
  return (
    // Computador e tablet: barra lateral (aberta ou só ícones); celular: o topo de sempre
    <div className={clsx('min-h-full', collapsed ? '[--sb-w:64px]' : '[--sb-w:200px] lg:[--sb-w:224px]')}>
      <Sidebar collapsed={collapsed} onToggle={toggle} profileItems={profileItems} avatar={avatar} name={user?.isGuest ? 'Visitante' : user?.name?.split(' ')[0] ?? 'Perfil'} />
      <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md md:hidden">
        <div className="relative flex h-16 items-center justify-between gap-3 px-4 sm:gap-4 sm:px-8">
          <Link to="/planner" className="flex shrink-0 items-center transition-opacity hover:opacity-70" aria-label="Início"><LogoMark /></Link>
          <Tabs />
          <div className="flex shrink-0 items-center gap-3">
            <FocusChip />
            <Menu label="Perfil" trigger={avatar} items={profileItems} />
          </div>
        </div>
        <div className="px-5 sm:px-8"><div className="h-px bg-line" /></div>
      </header>

      <div className="transition-[padding-left] duration-[250ms] ease-apple md:pl-[var(--sb-w)]">
        <main key={loc.pathname} className={clsx('mx-auto transition-[max-width] duration-[250ms] ease-apple px-5 pt-8 pb-24 sm:px-8 sm:pt-12', width, home && 'fit:pt-5 fit:pb-5')}>
          <Outlet />
        </main>
      </div>
      <FocusOverlay />
      {WidgetSync && <Suspense fallback={null}><WidgetSync /></Suspense>}
    </div>
  );
}
