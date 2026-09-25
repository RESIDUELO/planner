import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Field, PageHeader } from '../components/ui';

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const settings = useQuery({ queryKey: ['study-settings'], queryFn: () => api.get('/api/me/study-settings') });
  const algo = useQuery({ queryKey: ['algorithm'], queryFn: () => api.get('/api/algorithm') });
  const [name, setName] = useState(user?.name ?? '');
  const [upg, setUpg] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'late'; text: string } | null>(null);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.patch('/api/auth/profile', { name }); await refresh(); setMsg({ tone: 'ok', text: 'Nome atualizado.' }); } catch (err) { setMsg({ tone: 'late', text: errorMessage(err) }); }
  };
  const upgrade = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post('/api/auth/upgrade', upg); await refresh(); setMsg({ tone: 'ok', text: 'Conta criada! Seu progresso foi mantido.' }); } catch (err) { setMsg({ tone: 'late', text: errorMessage(err) }); }
  };
  const s = settings.data;
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return (
    <>
      <PageHeader title="Configurações" />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {user?.isGuest ? (
          <Card title="Criar conta" subtitle="Transforme o modo visitante em uma conta e acesse seu planner de qualquer dispositivo.">
            <form onSubmit={upgrade} className="space-y-3">
              <Field label="Nome"><input className="input" required value={upg.name} onChange={(e) => setUpg({ ...upg, name: e.target.value })} /></Field>
              <Field label="E-mail"><input className="input" type="email" required value={upg.email} onChange={(e) => setUpg({ ...upg, email: e.target.value })} /></Field>
              <Field label="Senha"><input className="input" type="password" minLength={8} required value={upg.password} onChange={(e) => setUpg({ ...upg, password: e.target.value })} /></Field>
              <Button type="submit">Criar conta mantendo meu progresso</Button>
            </form>
          </Card>
        ) : (
          <Card title="Conta">
            <form onSubmit={saveName} className="space-y-3">
              <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="E-mail"><input className="input" disabled value={user?.email ?? ''} /></Field>
              <div className="flex gap-2"><Button type="submit">Salvar</Button><Button type="button" variant="ghost" onClick={async () => { await logout(); nav('/login'); }}>Sair</Button></div>
            </form>
          </Card>
        )}
        <Card title="Estudo" action={<Link to="/planner" className="text-xs font-medium text-brand-600 hover:underline">Reconfigurar no planner</Link>}>
          {!s ? null : !s.profile.configured ? <p className="text-sm text-slate-500">Ainda não configurado.</p> : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-slate-500">Horas por dia</dt><dd className="font-medium">{s.profile.daily_hours} h</dd></div>
              <div><dt className="text-xs text-slate-500">Dias de estudo</dt><dd className="font-medium">{s.weekdays.map((d: number) => WD[d]).join(', ')}</dd></div>
              <div><dt className="text-xs text-slate-500">Questões por dia</dt><dd className="font-medium">{s.profile.questions_per_day}</dd></div>
              <div><dt className="text-xs text-slate-500">Métodos</dt><dd className="font-medium">{s.methods.filter((m: any) => m.enabled).map((m: any) => `${m.name} (${m.estimated_minutes} min)`).join(', ')}</dd></div>
            </dl>
          )}
        </Card>
        <Card title="Como os cálculos funcionam" className="lg:col-span-2">
          <div className="space-y-3 text-sm text-slate-600">
            <p><b>Ranking:</b> os assuntos são ordenados pela fração das questões que representaram nas edições cadastradas das provas selecionadas (com várias provas, média ponderada: a principal e as mais próximas pesam mais). Desempate por presença nas edições e frequência recente.</p>
            <p><b>Prioridade dinâmica:</b> {algo.data && Object.entries(algo.data.priority.weights).map(([k, v]) => `${({ historical: 'histórico', proximity: 'proximidade da prova', forgetting: 'esquecimento', performance: 'desempenho' } as any)[k]} ${Math.round((v as number) * 100)}%`).join(' · ')}.</p>
            <p><b>Revisões:</b> modelo próprio inspirado no FSRS (estabilidade, dificuldade e probabilidade de lembrar). A retenção-alvo sobe de 90% para 95% conforme a prova se aproxima, nenhum intervalo passa da metade do tempo restante e nenhuma revisão é agendada no dia da prova ou depois.</p>
            <p><b>Questões potencialmente dominadas:</b> questões esperadas de cada assunto × domínio estimado. É uma estimativa, não uma promessa de acerto.</p>
            <p><b>Base de dados:</b> somente provas e questões cadastradas pela administração. Nada é buscado automaticamente na internet.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
