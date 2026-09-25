import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { num1, pct } from '../../lib/format';
import { Alert, Badge, Card, Empty, MiniBars, PageHeader, Spinner } from '../../components/ui';

export function AdminStats() {
  const [params, setParams] = useSearchParams();
  const exams = useQuery({ queryKey: ['admin-exams'], queryFn: () => api.get<any[]>('/api/admin/exams') });
  const examId = params.get('exam') ?? exams.data?.[0]?.id;
  return (
    <>
      <PageHeader title="Estatísticas" subtitle="Calculadas exclusivamente a partir das questões cadastradas no banco."
        action={<select className="input w-auto" value={examId ?? ''} onChange={(e) => setParams({ exam: e.target.value })} aria-label="Prova">
          {(exams.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.institution} — {e.name}</option>)}
        </select>} />
      {exams.isLoading ? <Spinner /> : !examId ? <Empty title="Nenhuma prova cadastrada" /> : <StatsView examId={examId} />}
    </>
  );
}

export function StatsView({ examId }: { examId: string }) {
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [level, setLevel] = useState<'subject' | 'leaf'>('subject');
  const [limit, setLimit] = useState(30);
  const q = useQuery({
    queryKey: ['admin-stats', examId, includeDrafts, level],
    queryFn: () => api.get(`/api/admin/exams/${examId}/stats?includeDrafts=${includeDrafts}&level=${level}`),
  });
  if (q.isLoading) return <Spinner />;
  const s = q.data;
  const maxYear = Math.max(1, ...s.subjects.flatMap((x: any) => x.byYear.map((y: any) => y.questions)));
  return (
    <Card title={`${s.exam.institution} — ${s.exam.name}: estatísticas`}
      subtitle={s.editionsAnalyzed ? `Período: ${s.years[0]}–${s.years[s.years.length - 1]} · ${s.totalQuestions} questões · ${s.classifiedQuestions} classificadas` : undefined}
      action={<div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand-600" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} /> Incluir rascunhos</label>
        <select className="input w-auto py-1 text-xs" value={level} onChange={(e) => setLevel(e.target.value as any)} aria-label="Nível">
          <option value="subject">Por assunto (unidade do planner)</option><option value="leaf">Por subassunto</option>
        </select>
      </div>}>
      <Alert tone={s.sufficiency === 'good' || s.sufficiency === 'limited' ? 'info' : 'warn'}>{s.message}</Alert>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.editions.map((e: any) => (
          <Badge key={e.id} tone={e.status === 'published' ? 'ok' : 'warn'}>{e.year}: {e.classifiedCount}/{e.questionCount} {e.status === 'draft' ? '(rascunho)' : ''}</Badge>
        ))}
      </div>
      {s.subjects.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="table">
            <thead><tr><th>#</th><th>Assunto</th><th className="text-right">Questões</th><th className="text-right">%</th><th className="text-right">Edições</th><th className="text-right">Média</th><th className="text-right">% recente</th><th>Nível</th><th className="hidden md:table-cell">Por edição</th></tr></thead>
            <tbody>
              {s.subjects.slice(0, limit).map((x: any) => (
                <tr key={x.subjectId}>
                  <td className="tabular text-slate-400">{x.rank}</td>
                  <td><div className="font-medium">{x.name}</div><div className="text-xs text-slate-500">{x.area}</div></td>
                  <td className="tabular text-right">{x.questions}</td>
                  <td className="tabular text-right">{pct(x.percentage)}</td>
                  <td className="tabular text-right">{x.editionsPresent}/{x.editionsAnalyzed}</td>
                  <td className="tabular text-right">{num1(x.annualAverage)}</td>
                  <td className="tabular text-right">{pct(x.recentPercentage)}</td>
                  <td><Badge>{x.level}</Badge></td>
                  <td className="hidden w-44 md:table-cell"><MiniBars height={22} max={maxYear} data={x.byYear.map((y: any) => ({ label: String(y.year).slice(2), value: y.questions, title: `${y.year}: ${y.questions}` }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.subjects.length > limit && <button className="mt-2 text-sm font-medium text-brand-600" onClick={() => setLimit(limit + 50)}>Mostrar mais ({s.subjects.length - limit})</button>}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">"Questões" é a contagem absoluta; "%" é a fração da prova. Questões com vários assuntos são divididas pelo peso de relevância.</p>
    </Card>
  );
}
