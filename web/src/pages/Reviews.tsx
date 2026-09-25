import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { api } from '../lib/api';
import { dateBR, todayBR } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';
import { ReviewButtons } from '../components/ReviewButtons';

const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), firstWeekday: first.getUTCDay(), days: last.getUTCDate() };
}

export function ReviewsPage() {
  const today = todayBR();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string>(today);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const r = monthRange(ym);
  const q = useQuery({ queryKey: ['calendar', ym], queryFn: () => api.get(`/api/reviews/calendar?from=${r.from}&to=${r.to}`) });
  const byDate = useMemo(() => new Map<string, any>((q.data?.days ?? []).map((d: any) => [d.date, d])), [q.data]);
  const shift = (n: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
  };

  if (q.isLoading) return <Spinner />;
  if (q.data?.plan === null) return (
    <><PageHeader title="Revisões" /><Empty title="Gere seu planner primeiro" action={<Link to="/planner"><Button>Montar planner</Button></Link>}>As revisões são agendadas conforme você conclui os assuntos.</Empty></>
  );
  const day = byDate.get(selected);
  const overdue = byDate.get(today)?.reviews.filter((x: any) => x.status === 'overdue') ?? [];

  return (
    <>
      <PageHeader title="Revisões" subtitle="Repetição espaçada adaptada ao tempo até a prova. Nenhuma revisão é agendada no dia da prova ou depois." />
      {overdue.length > 0 && <div className="mb-4"><Alert tone="late" title={`${overdue.length} revisão(ões) atrasada(s)`}>Elas aparecem em hoje e têm prioridade no seu dia.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={(() => { const t = dateBR(`${ym}-01`, { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); })()}
          action={<div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { setYm(today.slice(0, 7)); setSelected(today); }}>Hoje</Button>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
          </div>}>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500 uppercase">{WEEK.map((w) => <div key={w}>{w}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: r.firstWeekday }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: r.days }).map((_, i) => {
              const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
              const d = byDate.get(date);
              const reviews = d?.reviews.filter((x: any) => x.status !== 'done').length ?? 0;
              const doneN = d?.reviews.filter((x: any) => x.status === 'done').length ?? 0;
              const late = d?.reviews.some((x: any) => x.status === 'overdue');
              const news = d?.newSubjects.length ?? 0;
              const isExam = d?.exams.length > 0;
              return (
                <button key={date} onClick={() => setSelected(date)} data-testid={`day-${date}`}
                  className={`flex min-h-16 flex-col items-start rounded-lg border p-1.5 text-left text-xs transition sm:min-h-20 ${selected === date ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-100 hover:border-slate-300'} ${date === today ? 'bg-brand-50/60' : 'bg-white'} ${date < today ? 'text-slate-400' : ''}`}>
                  <span className={`tabular font-semibold ${date === today ? 'text-brand-700' : ''}`}>{i + 1}</span>
                  {isExam && <span className="mt-0.5 flex items-center gap-0.5 rounded bg-brand-600 px-1 text-[10px] font-semibold text-white"><Flag className="h-2.5 w-2.5" />Prova</span>}
                  {reviews > 0 && <span className={`mt-0.5 rounded px-1 text-[10px] font-medium ${late ? 'bg-late-50 text-late-700' : 'bg-brand-50 text-brand-700'}`}>{reviews} rev.</span>}
                  {doneN > 0 && <span className="mt-0.5 rounded bg-ok-50 px-1 text-[10px] font-medium text-ok-700">{doneN} feita{doneN > 1 ? 's' : ''}</span>}
                  {news > 0 && <span className="mt-0.5 hidden rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-600 sm:inline">{news} novo{news > 1 ? 's' : ''}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-brand-100" /> Revisões</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-late-50 ring-1 ring-late-500/30" /> Atrasadas</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-ok-50 ring-1 ring-ok-500/30" /> Feitas</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-slate-100" /> Novos assuntos</span>
          </div>
        </Card>

        <Card title={dateBR(selected, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}>
          {!day ? <p className="text-sm text-slate-500">Selecione um dia.</p> : (
            <div className="space-y-5">
              {day.exams.length > 0 && <Alert tone="info" title="Dia de prova">{day.exams.join(', ')}</Alert>}
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Revisões</h3>
                {day.reviews.length === 0 ? <p className="text-sm text-slate-400">Nenhuma.</p> : (
                  <ul className="space-y-3">
                    {day.reviews.map((x: any, i: number) => (
                      <li key={`${x.subjectId}${i}`}>
                        <div className="flex items-center justify-between gap-2">
                          <button onClick={() => setOpen(x.subjectId)} className="text-left text-sm font-medium hover:text-brand-700">{x.name}</button>
                          {x.status === 'overdue' && <Badge tone="late">Atrasada {x.overdueDays}d</Badge>}
                          {x.status === 'done' && <Badge tone="ok">Feita</Badge>}
                          {x.status === 'scheduled' && <Badge tone="info">Agendada</Badge>}
                          {x.status === 'projected' && <Badge title="Prevista supondo que você lembre bem nas revisões anteriores">Prevista</Badge>}
                        </div>
                        {(x.status === 'overdue' || (x.status === 'scheduled' && selected <= today)) && selected === today && (
                          <div className="mt-2"><ReviewButtons subjectId={x.subjectId} onDone={setMsg} /></div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Novos assuntos</h3>
                {day.newSubjects.length === 0 ? <p className="text-sm text-slate-400">Nenhum.</p> : (
                  <ul className="space-y-2">
                    {day.newSubjects.map((n: any) => (
                      <li key={n.subjectId}>
                        <button onClick={() => setOpen(n.subjectId)} className="text-left text-sm font-medium hover:text-brand-700">{n.name}</button>
                        <div className="text-xs text-slate-500">{n.methods.join(', ')} · {n.minutes} min {n.completed && <Badge tone="ok" className="ml-1">Concluído</Badge>}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {msg && <Alert tone="ok">{msg}</Alert>}
            </div>
          )}
        </Card>
      </div>
      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
