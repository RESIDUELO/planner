import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTimeBR, int, num1, pct, shortDate, todayBR } from '../lib/format';
import { Bars, Button, Disclosure, Empty, Progress, Spinner, Title } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';
import { addDays } from '../../../shared/dates';

const RATING: Record<string, string> = { again: 'Errei', hard: 'Difícil', good: 'Bom', easy: 'Fácil' };

export function PerformancePage() {
  const q = useQuery({ queryKey: ['performance'], queryFn: () => api.get('/api/performance') });
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/planner/practice/${id}`),
    onSuccess: () => { for (const k of ['performance', 'planner', 'subject', 'today', 'week']) qc.invalidateQueries({ queryKey: [k] }); },
  });
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d.hasPlan) return (
    <div className="mx-auto max-w-2xl"><Title>Desempenho</Title><Empty title="Ainda sem dados" action={<Link to="/planner"><Button>Montar planner</Button></Link>}>Registre questões nos assuntos para acompanhar seu desempenho.</Empty></div>
  );

  const answered = d.areas.reduce((t: number, a: any) => t + a.answered, 0);
  const correct = d.areas.reduce((t: number, a: any) => t + a.correct, 0);
  const acc = answered ? correct / answered : null;
  const today = todayBR();
  const window = (from: string, to: string) => {
    const rows = d.history.filter((h: any) => h.date >= from && h.date <= to);
    const qn = rows.reduce((t: number, h: any) => t + h.questions, 0);
    return qn ? rows.reduce((t: number, h: any) => t + h.correct, 0) / qn : null;
  };
  const recent = window(addDays(today, -27), today);
  const before = window(addDays(today, -55), addDays(today, -28));
  const trend = recent != null && before != null ? recent - before : null;

  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const byDay = new Map(d.history.map((h: any) => [h.date, h]));
  const withEnough = d.subjects.filter((s: any) => s.answered >= 5).sort((a: any, b: any) => a.accuracy - b.accuracy);
  const weakest = withEnough.length >= 2 ? withEnough[0] : null;
  const studied = d.subjects.filter((s: any) => s.status === 'studied').length;
  const withQuestions = d.subjects.filter((s: any) => s.answered > 0);
  const reviews = d.ratings.reduce((t: number, r: any) => t + r.n, 0);

  return (
    <div className="mx-auto max-w-2xl">
      <Title>Desempenho</Title>

      <section className="animate-in">
        {acc == null ? (
          <p className="font-display text-[30px] text-ink-2">Registre suas primeiras questões para ver seu desempenho.</p>
        ) : (
          <>
            <p className="tabular font-display text-[96px] leading-none sm:text-[128px]">{pct(acc, 0)}</p>
            <p className="mt-3 text-[17px] text-ink-2">de acertos em {int(answered)} questões</p>
            {trend != null && Math.abs(trend) >= 0.005 && (
              <p className={`mt-6 text-[17px] ${trend > 0 ? 'text-ink' : 'text-today'}`}>
                {trend > 0 ? '+' : '−'}{Math.round(Math.abs(trend) * 100)}% <span className="text-ink-2">nas últimas 4 semanas</span>
              </p>
            )}
          </>
        )}
      </section>

      {d.history.length > 0 && (
        <section className="mt-16 animate-in">
          <p className="mb-4 text-[15px] text-ink-2">Questões por dia · últimos 30 dias</p>
          <Bars height={96} data={days.map((day) => {
            const h: any = byDay.get(day);
            return { label: day, value: h?.questions ?? 0, title: h ? `${shortDate(day)}: ${h.questions} questões, ${pct(h.correct / h.questions, 0)} de acerto` : `${shortDate(day)}: nenhuma` };
          })} />
          <div className="mt-2 flex justify-between text-[12px] text-ink-3"><span>{shortDate(days[0], false)}</span><span>hoje</span></div>
        </section>
      )}

      {weakest && (
        <section className="mt-16 animate-in">
          <p className="text-[11px] font-medium tracking-[0.16em] text-ink-2 uppercase">Onde focar</p>
          <button onClick={() => setOpen(weakest.subjectId)} className="mt-1 text-left transition-opacity hover:opacity-70">
            <span className="tint tint-rose font-display text-[30px]">{weakest.name}</span>
            <span className="ml-3 text-[17px] text-ink-2">{pct(weakest.accuracy, 0)} de acerto</span>
          </button>
        </section>
      )}

      <div className="my-16 h-px bg-line" />

      <section className="animate-in">
        <div className="flex items-baseline justify-between">
          <p className="text-[17px] text-ink-2">Seu progresso</p>
          <p className="tabular font-display text-[34px] leading-none">{pct(d.subjects.length ? studied / d.subjects.length : 0, 0)}</p>
        </div>
        <Progress className="mt-4" value={d.subjects.length ? studied / d.subjects.length : 0} />
        <p className="mt-3 text-[15px] text-ink-2">{studied} de {d.subjects.length} assuntos concluídos · {reviews} revisões feitas</p>
      </section>

      <div className="mt-16 border-t border-line">
        <Disclosure summary="Por grande área" className="border-b border-line">
          <div className="space-y-5">
            {d.areas.map((a: any) => (
              <div key={a.area}>
                <div className="flex justify-between text-[15px]"><span>{a.area}</span><span className="tabular text-ink-2">{a.answered ? pct(a.correct / a.answered, 0) : '—'}</span></div>
                <Progress className="mt-2" value={a.answered ? a.correct / a.answered : 0} tone="ink" />
                <div className="mt-1 text-[13px] text-ink-3">{a.studied}/{a.subjects} temas · {a.answered} questões · {pct(a.percentage, 0)} da prova</div>
              </div>
            ))}
          </div>
        </Disclosure>

        <Disclosure summary={`Assuntos com questões (${withQuestions.length})`} className="border-b border-line">
          {withQuestions.length === 0 ? <p className="text-[15px] text-ink-3">Nenhum ainda.</p> : (
            <ol className="divide-y divide-line">
              {withQuestions.map((s: any) => (
                <li key={s.subjectId}>
                  <button onClick={() => setOpen(s.subjectId)} className="flex w-full items-center gap-4 py-3 text-left transition-opacity hover:opacity-70">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{s.name}</span>
                      <span className="block text-[13px] text-ink-3">{s.correct}/{s.answered} · domínio {pct(s.mastery, 0)} · {num1(s.estimatedQuestions * s.mastery)} de {num1(s.estimatedQuestions)} questões</span>
                    </span>
                    <span className="tabular text-[17px]">{pct(s.accuracy, 0)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Disclosure>

        {(d.logs.length > 0 || reviews > 0) && (
          <Disclosure summary="Histórico" className="border-b border-line">
            {reviews > 0 && <p className="mb-4 text-[14px] text-ink-2">Revisões: {d.ratings.map((r: any) => `${RATING[r.rating]} ${r.n}`).join(' · ')}</p>}
            <ul className="space-y-1.5 text-[14px]">
              {d.logs.map((l: any) => (
                <li key={l.id} className="flex items-center justify-between gap-4">
                  <span className="truncate">{l.name}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-ink-2">{l.correct_count}/{l.questions_count} · {dateTimeBR(l.practiced_at)}</span>
                    <Button variant="destructive" size="sm" disabled={del.isPending} onClick={() => del.mutate(l.id)} aria-label={`Excluir registro — ${l.name}`}>Excluir</Button>
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
