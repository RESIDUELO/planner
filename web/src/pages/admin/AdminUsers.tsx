import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTimeBR } from '../../lib/format';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../../components/ui';

const ROLE: Record<string, string> = { admin: 'Administrador', user: 'Usuário', visitor: 'Visitante' };

export function AdminUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<any[]>('/api/admin/users') });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: ({ id, body }: any) => api.put(`/api/admin/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => setErr(errorMessage(e)),
  });
  if (q.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Usuários" subtitle={`${q.data!.length} contas`} />
      {err && <div className="mb-4"><Alert tone="late">{err}</Alert></div>}
      <Card>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Planners</th><th>Último acesso</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data!.map((u) => (
                <tr key={u.user_id}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-xs">{u.email ?? '—'}</td>
                  <td><Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{ROLE[u.role]}</Badge></td>
                  <td className="tabular">{u.plans}</td>
                  <td className="text-xs">{dateTimeBR(u.last_login_at)}</td>
                  <td><Badge tone={u.active ? 'ok' : 'late'}>{u.active ? 'Ativo' : 'Bloqueado'}</Badge></td>
                  <td className="text-right whitespace-nowrap">
                    {u.user_id !== user?.id && u.role !== 'visitor' && (
                      <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: u.user_id, body: { role: u.role === 'admin' ? 'user' : 'admin' } })}>{u.role === 'admin' ? 'Remover admin' : 'Tornar admin'}</Button>
                    )}
                    {u.user_id !== user?.id && (
                      <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: u.user_id, body: { active: !u.active } })}>{u.active ? 'Bloquear' : 'Reativar'}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
