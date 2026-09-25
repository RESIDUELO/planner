import { NavLink, Outlet } from 'react-router-dom';
import { clsx } from 'clsx';

const ITEMS = [
  ['', 'Dashboard'], ['instituicoes', 'Instituições'], ['bancas', 'Bancas'], ['provas', 'Provas'], ['edicoes', 'Edições'],
  ['assuntos', 'Assuntos'], ['estatisticas', 'Estatísticas'], ['importacao', 'Importação'], ['usuarios', 'Usuários'],
  ['logs', 'Logs'], ['configuracoes', 'Configurações'],
];

export function AdminLayout() {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold tracking-wide text-brand-600 uppercase">Administração</div>
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
        {ITEMS.map(([to, label]) => (
          <NavLink key={to} to={to === '' ? '/admin' : `/admin/${to}`} end={to === ''}
            className={({ isActive }) => clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap', isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
