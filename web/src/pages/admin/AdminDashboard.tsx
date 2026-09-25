import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTimeBR, int } from '../../lib/format';
import { Button, Card, PageHeader, Spinner, Stat } from '../../components/ui';
import { AuditValues } from './AdminLogs';

export function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api.get('/api/admin/dashboard') });
  if (q.isLoading) return <Spinner />;
  const c = q.data.counts;
  return (
    <>
      <PageHeader title="Painel administrativo" subtitle="A base de provas é fechada: o sistema só conhece o que for cadastrado aqui."
        action={<><Link to="/admin/importacao"><Button variant="secondary"><Upload className="h-4 w-4" /> Importar questões</Button></Link><Link to="/admin/nova-prova"><Button><Plus className="h-4 w-4" /> Nova prova</Button></Link></>} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Instituições" value={c.institutions} />
        <Stat label="Bancas" value={c.boards} />
        <Stat label="Provas" value={c.exams} />
        <Stat label="Edições" value={c.editions} hint={`${c.published_editions} publicadas · ${c.draft_editions} rascunhos`} />
        <Stat label="Questões" value={int(c.questions)} hint={c.unclassified_questions ? `${c.unclassified_questions} sem classificação` : 'todas classificadas'} tone={c.unclassified_questions ? 'warn' : undefined} />
        <Stat label="Assuntos" value={int(c.subjects)} hint={`${c.root_subjects} no planner`} />
        <Stat label="Usuários" value={int(c.users)} hint={`${c.visitors} visitantes`} />
      </div>
      <Card className="mt-4" title="Alterações recentes" action={<Link to="/admin/logs" className="text-xs font-medium text-brand-600 hover:underline">Ver logs</Link>}>
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.recent.map((l: any) => (
            <li key={l.id} className="py-2">
              <div className="flex flex-wrap justify-between gap-2"><span><b>{l.actor_name}</b> · {l.action} · {l.entity} · {l.entity_label}</span><span className="text-xs text-slate-500">{dateTimeBR(l.changed_at)}</span></div>
              <AuditValues log={l} compact />
            </li>
          ))}
          {q.data.recent.length === 0 && <li className="py-4 text-slate-400">Nenhuma alteração ainda.</li>}
        </ul>
      </Card>
    </>
  );
}
