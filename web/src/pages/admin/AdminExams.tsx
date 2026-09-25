import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge } from '../../components/ui';
import { CrudPage } from './shared';

export function AdminExams() {
  const inst = useQuery({ queryKey: ['admin-institutions'], queryFn: () => api.get<any[]>('/api/admin/institutions') });
  const boards = useQuery({ queryKey: ['admin-boards'], queryFn: () => api.get<any[]>('/api/admin/boards') });
  return (
    <CrudPage title="Provas" subtitle="Uma prova (ex.: FAMERP — R1 Acesso Direto) tem várias edições (anos)." endpoint="/api/admin/exams" queryKey="admin-exams"
      fields={[
        { name: 'institution_id', label: 'Instituição', type: 'select', required: true, options: (inst.data ?? []).map((i) => ({ value: i.id, label: `${i.abbreviation} — ${i.name}` })) },
        { name: 'board_id', label: 'Banca', type: 'select', options: (boards.data ?? []).map((b) => ({ value: b.id, label: b.abbreviation })) },
        { name: 'name', label: 'Nome', required: true, hint: 'Ex.: R1 Acesso Direto' },
        { name: 'total_questions', label: 'Nº de questões', type: 'number' },
        { name: 'duration_minutes', label: 'Duração (min)', type: 'number' },
        { name: 'official_url', label: 'Site oficial', type: 'url' },
        { name: 'description', label: 'Descrição', type: 'textarea' },
        { name: 'active', label: 'Ativa', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Instituição', render: (r) => <b>{r.institution}</b> },
        { label: 'Prova', render: (r) => r.name },
        { label: 'Banca', render: (r) => r.board ?? '—' },
        { label: 'Edições', render: (r) => <Link className="text-brand-600 hover:underline" to={`/admin/edicoes?exam=${r.id}`}>{r.published_editions}/{r.editions} publicadas</Link> },
        { label: 'Questões', render: (r) => r.questions, className: 'text-right' },
        { label: 'Status', render: (r) => <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
      ]}
      extraActions={(r) => <Link to={`/admin/estatisticas?exam=${r.id}`} className="mr-2 text-xs font-medium text-brand-600 hover:underline">Estatísticas</Link>} />
  );
}
