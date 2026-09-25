import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateBR, dateTimeBR, int, num1, pct } from '../lib/format';
import { Button, Card, Empty, MiniBars, PageHeader, Progress, Spinner, Stat } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';

const RATING: Record<string, string> = { again: 'Errei', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export function PerformancePage() {
  const q = useQuery({ queryKey: ['performance'], queryFn: () => api.get('/api/performance') });
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'rank' | 'accuracy' | 'answered'>('rank');
  const subjects = useMemo(() => {
    const l = (q.data?.subjects ?? []).filter((s: any) => s.answered > 0 || s.status !== 'pending');
    if (sort === 'accuracy') return [...l].sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2));
    if (sort === 'answered') return [...l].sort((a, b) => b.answered - a.answered);
    return l;
  }, [q.data, sort]);
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d.hasPlan) return <><PageHeader title="Desempenho" /><Empty title="Sem dados ainda" action={<Link to="/planner"><Button>Montar planner</Button></Link>}>Gere seu planner e registre questões para acompanhar seu desempenho.</Empty></>;
  const answered = d.areas.reduce((t: number, a: any) => t + a.answered, 0);
  const correct = d.areas.reduce((t: number, a: any) => t + a.correct, 0);
  const totalReviews = d.ratings.reduce((t: number, r: any) => t + r.n, 0);
  return (
    <>
      <PageHeader title="Desempenho" subtitle="Seus registros de questões, domínio estimado e revisões." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Questões registradas" value={int(answered)} />
        <Stat label="Acerto geral" value={pct(answered ? correct / answered : null, 0)} />
        <Stat label="Assuntos com questões" value={d.subjects.filter((s: any) => s.answered > 0).length} />
        <Stat label="Revisões realizadas" value={totalReviews} hint={d.ratings.map((r: any) => `${RATING[r.rating]}: ${r.n}`).join(' · ')} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Por grande área" subtitle="Peso = soma da frequência histórica dos assuntos da área">
          <table className="table">
            <thead><tr><th>Área</th><th className="text-right">Peso</th><th className="text-right">Estudados</th><th className="text-right">Questões</th><th className="w-32">Acerto</th></tr></thead>
            <tbody>
              {d.areas.map((a: any) => (
                <tr key={a.area}>
                  <td className="font-medium">{a.area}</td>
                  <td className="tabular text-right">{pct(a.percentage, 0)}</td>
                  <td className="tabular text-right">{a.studied}/{a.subjects}</td>
                  <td className="tabular text-right">{a.answered}</td>
                  <td>{a.answered ? <div className="flex items-center gap-2"><Progress value={a.correct / a.answered} tone={a.correct / a.answered >= 0.7 ? 'ok' : 'warn'} /><span className="tabular text-xs">{pct(a.correct / a.answered, 0)}</span></div> : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Questões por dia (últimos 90 dias)">
          {d.history.length === 0 ? <p className="text-sm text-slate-500">Nenhum registro ainda.</p> : (
            <MiniBars height={120} data={d.history.map((h: any) => ({ label: dateBR(h.date, { day: '2-digit', month: '2-digit' }), value: h.questions, title: `${dateBR(h.date)}: ${h.questions} questões, ${h.correct} acertos (${pct(h.correct / h.questions, 0)})` }))} />
          )}
        </Card>
      </div>
      <Card className="mt-4" title="Por assunto" action={
        <select className="input w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenar">
          <option value="rank">Ordem do plano</option><option value="accuracy">Pior acerto primeiro</option><option value="answered">Mais questões</option>
        </select>}>
        {subjects.length === 0 ? <p className="text-sm text-slate-500">Estude um assunto ou registre questões para vê-lo aqui.</p> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>#</th><th>Assunto</th><th className="text-right">Questões</th><th className="text-right">Acerto</th><th className="text-right">Domínio</th><th className="text-right">Dominadas</th><th className="text-right">Lembrança</th><th>Próx. revisão</th></tr></thead>
              <tbody>
                {subjects.map((s: any) => (
                  <tr key={s.subjectId} className="cursor-pointer" onClick={() => setOpen(s.subjectId)}>
                    <td className="tabular text-slate-400">{s.rank}</td>
                    <td><div className="font-medium">{s.name}</div><div className="text-xs text-slate-500">{s.area}</div></td>
                    <td className="tabular text-right">{s.answered ? `${s.correct}/${s.answered}` : '—'}</td>
                    <td className="tabular text-right">{pct(s.accuracy, 0)}</td>
                    <td className="tabular text-right">{pct(s.mastery, 0)}</td>
                    <td className="tabular text-right">{num1(s.estimatedQuestions * s.mastery)} / {num1(s.estimatedQuestions)}</td>
                    <td className="tabular text-right">{pct(s.retrievability, 0)}</td>
                    <td className="text-xs">{dateBR(s.nextReview)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {d.logs.length > 0 && (
        <Card className="mt-4" title="Histórico de registros">
          <ul className="divide-y divide-slate-100 text-sm">
            {d.logs.map((l: any) => (
              <li key={l.id} className="flex justify-between py-2"><span>{l.name}</span><span className="tabular text-slate-500">{l.correct_count}/{l.questions_count} · {dateTimeBR(l.practiced_at)}</span></li>
            ))}
          </ul>
        </Card>
      )}
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
