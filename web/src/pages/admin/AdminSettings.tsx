import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateTimeBR } from '../../lib/format';
import { Badge, Card, PageHeader, Spinner } from '../../components/ui';

export function AdminSettings() {
  const q = useQuery({ queryKey: ['admin-algorithms'], queryFn: () => api.get('/api/admin/algorithms') });
  if (q.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Configurações" subtitle="Versões dos algoritmos e parâmetros em uso. Os parâmetros ficam versionados no código (shared/config.ts)." />
      <Card title="Versões dos algoritmos">
        <ul className="divide-y divide-slate-100">
          {q.data.versions.map((v: any) => (
            <li key={v.id} className="py-3">
              <div className="flex items-center gap-2"><b>{v.name}</b><Badge tone="info">{v.version}</Badge>{v.active && <Badge tone="ok">ativa</Badge>}<span className="ml-auto text-xs text-slate-400">{dateTimeBR(v.created_at)}</span></div>
              <p className="mt-1 text-sm text-slate-600">{v.description}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-4" title="Parâmetros">
        <pre className="max-h-[32rem] overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(q.data.parameters, null, 2)}</pre>
      </Card>
    </>
  );
}
