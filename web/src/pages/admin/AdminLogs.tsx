import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTimeBR } from '../../lib/format';
import { Badge, Button, Card, PageHeader, Spinner } from '../../components/ui';

const ENTITIES = ['institutions', 'examining_boards', 'exams', 'exam_editions', 'questions', 'question_subjects', 'subjects', 'subject_aliases', 'medical_areas', 'user_profiles'];
const ACTION_TONE: Record<string, 'ok' | 'info' | 'late'> = { insert: 'ok', update: 'info', delete: 'late' };
const fmt = (v: unknown) => (v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditValues({ log, compact }: { log: any; compact?: boolean }) {
  if (log.action !== 'update') return null;
  const keys = Object.keys(log.new_values ?? {});
  return (
    <div className={`text-xs text-slate-600 ${compact ? 'mt-0.5' : ''}`}>
      {keys.slice(0, compact ? 3 : 20).map((k) => (
        <div key={k}><span className="text-slate-400">{k}:</span> <span className="text-late-700 line-through">{fmt(log.old_values?.[k])}</span> → <span className="text-ok-700">{fmt(log.new_values[k])}</span></div>
      ))}
    </div>
  );
}

export function AdminLogs() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin-logs', entity, page], queryFn: () => api.get(`/api/admin/logs?page=${page}${entity ? `&entity=${entity}` : ''}`) });
  return (
    <>
      <PageHeader title="Logs de auditoria" subtitle="Registro automático, feito pelo banco, de toda alteração nos dados administrativos."
        action={<select className="input w-auto" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entidade">
          <option value="">Todas as entidades</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}
        </select>} />
      <Card>
        {q.isLoading ? <Spinner /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Valores</th></tr></thead>
                <tbody>
                  {q.data.rows.map((l: any) => (
                    <tr key={l.id}>
                      <td className="text-xs whitespace-nowrap">{dateTimeBR(l.changed_at)}</td>
                      <td className="text-sm">{l.actor_name}</td>
                      <td><Badge tone={ACTION_TONE[l.action]}>{l.action}</Badge></td>
                      <td><div className="text-sm font-medium">{l.entity_label ?? '—'}</div><div className="text-xs text-slate-400">{l.entity}</div></td>
                      <td className="max-w-md">{l.action === 'update' ? <AuditValues log={l} /> : <span className="text-xs text-slate-400">{l.action === 'insert' ? 'criado' : 'removido'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{q.data.total} registros</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                <Button size="sm" variant="secondary" disabled={page * q.data.pageSize >= q.data.total} onClick={() => setPage(page + 1)}>Próxima</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
