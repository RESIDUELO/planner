import { Badge } from '../../components/ui';
import { CrudPage } from './shared';

export function AdminInstitutions() {
  return (
    <CrudPage title="Instituições" endpoint="/api/admin/institutions" queryKey="admin-institutions"
      fields={[
        { name: 'name', label: 'Nome', required: true, span: 2 },
        { name: 'abbreviation', label: 'Sigla', required: true },
        { name: 'state', label: 'UF' },
        { name: 'city', label: 'Cidade' },
        { name: 'website', label: 'Site', type: 'url' },
        { name: 'logo_url', label: 'Logo (URL)', type: 'url' },
        { name: 'active', label: 'Ativa', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Sigla', render: (r) => <b>{r.abbreviation}</b> },
        { label: 'Nome', render: (r) => r.name },
        { label: 'Local', render: (r) => [r.city, r.state].filter(Boolean).join('/') || '—' },
        { label: 'Provas', render: (r) => r.exams, className: 'text-right' },
        { label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
      ]} />
  );
}

export function AdminBoards() {
  return (
    <CrudPage title="Bancas" endpoint="/api/admin/boards" queryKey="admin-boards"
      fields={[
        { name: 'name', label: 'Nome', required: true, span: 2 },
        { name: 'abbreviation', label: 'Sigla', required: true },
        { name: 'website', label: 'Site', type: 'url' },
        { name: 'active', label: 'Ativa', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Sigla', render: (r) => <b>{r.abbreviation}</b> },
        { label: 'Nome', render: (r) => r.name },
        { label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
      ]} />
  );
}
