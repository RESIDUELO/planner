import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { dateBR, shortDate, todayBR } from '../lib/format';
import { Button, Disclosure, Empty, Note, Spinner, Title } from '../components/ui';
import { SubjectModal } from '../components/SubjectModal';
import { ReviewButtons } from '../components/ReviewButtons';
import { addDays } from '../../../shared/dates';

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), firstWeekday: first.getUTCDay(), days: last.getUTCDate() };
}

export function ReviewsPage() {
  const today = todayBR();
  const [open, setOpen] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', today], queryFn: () => api.get(`/api/reviews/calendar?from=${today}&to=${addDays(today, 13)}`) });

  if (upcoming.isLoading) return <Spinner />;
  if (upcoming.data?.plan === null) return (
    <div className="mx-auto max-w-2xl"><Title>Revisões</Title><Empty title="Seu planner ainda não existe" action={<Link to="/planner"><Button>Montar planner</Button></Link>}>As revisões aparecem quando você conclui os assuntos.</Empty></div>
  );
  const days = upcoming.data.days as any[];
  const todays = (days[0]?.reviews ?? []).filter((r: any) => r.status === 'overdue' || r.status === 'scheduled');
  const done = (days[0]?.reviews ?? []).filter((r: any) => r.status === 'done');
  const next = days.slice(1).filter((d) => d.reviews.some((r: any) => r.status !== 'done') || d.exams.length);

  return (
    <div className="mx-auto max-w-2xl">
      <Title eyebrow={dateBR(today, { weekday: 'long', day: 'numeric', month: 'long' })}>Revisões</Title>

      <section className="animate-in">
        <p className="text-[17px] text-ink-2">
          Hoje · {todays.length === 0 ? 'nenhuma revisão pendente' : `${todays.length} ${todays.length === 1 ? 'revisão' : 'revisões'}`}
          {done.length > 0 && <span className="text-positive"> · {done.length} feita{done.length > 1 ? 's' : ''}</span>}
        </p>
        {todays.length > 0 && (
          <div className="mt-4 divide-y divide-line border-y border-line">
            {todays.map((r: any) => (
              <div key={r.subjectId} className="py-5">
                <div className="flex items-center gap-4">
                  <button onClick={() => setOpen(r.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
                    <div className="truncate text-[19px] font-medium">{r.name}</div>
                    {r.status === 'overdue' && <div className="text-[14px] text-negative">atrasada há {r.overdueDays} dia{r.overdueDays > 1 ? 's' : ''}</div>}
                  </button>
                  {active !== r.subjectId && <Button variant="plain" onClick={() => { setActive(r.subjectId); setMsg(null); }}>Revisar agora →</Button>}
                </div>
                {active === r.subjectId && (
                  <div className="mt-4 animate-in">
                    <p className="mb-3 text-[15px] text-ink-2">Como foi lembrar deste assunto?</p>
                    <ReviewButtons subjectId={r.subjectId} onDone={(t) => { setMsg(t); setActive(null); }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {msg && <Note tone="positive" className="mt-4">{msg}</Note>}
      </section>

      <section className="mt-16 animate-in">
        <p className="text-[17px] text-ink-2">Próximos dias</p>
        {next.length === 0 ? <p className="mt-4 text-[15px] text-ink-3">Nenhuma revisão prevista nas próximas duas semanas.</p> : (
          <div className="mt-4 divide-y divide-line border-y border-line">
            {next.map((d) => {
              const rs = d.reviews.filter((r: any) => r.status !== 'done');
              return (
                <div key={d.date} className="flex gap-6 py-4">
                  <div className="w-16 shrink-0 text-[15px] text-ink-2">{shortDate(d.date, false)}</div>
                  <div className="min-w-0 flex-1 text-[15px]">
                    {d.exams.length > 0 && <div className="font-medium text-accent">Prova · {d.exams.join(', ')}</div>}
                    {rs.length > 0 && <div className="truncate">{rs.map((r: any) => r.name).join(', ')}</div>}
                    {rs.some((r: any) => r.status === 'projected') && <div className="text-[13px] text-ink-3">previsão</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Disclosure summary="Calendário" className="mt-12 border-t border-line">
        <MonthCalendar today={today} onOpen={setOpen} />
      </Disclosure>

      {open && <SubjectModal subjectId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MonthCalendar({ today, onOpen }: { today: string; onOpen: (id: string) => void }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const r = monthRange(ym);
  const q = useQuery({ queryKey: ['calendar', ym], queryFn: () => api.get(`/api/reviews/calendar?from=${r.from}&to=${r.to}`) });
  const byDate = useMemo(() => new Map<string, any>((q.data?.days ?? []).map((d: any) => [d.date, d])), [q.data]);
  const shift = (n: number) => {
    const [y, m] = ym.split('-').map(Number);
    setYm(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  const title = dateBR(`${ym}-01`, { month: 'long', year: 'numeric' });
  const day = byDate.get(selected);

  return (
    <div className="pt-2">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[19px] font-medium">{title.charAt(0).toUpperCase() + title.slice(1)}</span>
        <div className="flex gap-1 text-ink-2">
          <button onClick={() => shift(-1)} aria-label="Mês anterior" className="rounded-full p-1.5 hover:bg-fill"><ChevronLeft className="h-5 w-5" /></button>
          <button onClick={() => shift(1)} aria-label="Próximo mês" className="rounded-full p-1.5 hover:bg-fill"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] text-ink-3">{WEEK.map((w, i) => <div key={i} className="pb-2">{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {Array.from({ length: r.firstWeekday }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: r.days }).map((_, i) => {
          const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
          const d = byDate.get(date);
          const pending = d?.reviews.some((x: any) => x.status !== 'done');
          const late = d?.reviews.some((x: any) => x.status === 'overdue');
          const exam = d?.exams.length > 0;
          const isSel = selected === date;
          return (
            <button key={date} onClick={() => setSelected(date)} data-testid={`day-${date}`} className="flex flex-col items-center gap-1 py-1.5">
              <span className={clsx('tabular flex h-9 w-9 items-center justify-center rounded-full text-[17px] transition-colors duration-150',
                isSel ? 'bg-ink text-canvas' : date === today ? 'text-accent' : date < today ? 'text-ink-3' : 'text-ink', !isSel && 'hover:bg-fill')}>
                {i + 1}
              </span>
              <span className={clsx('h-1.5 w-1.5 rounded-full', exam ? 'bg-accent' : late ? 'bg-negative' : pending ? 'bg-ink-3' : d?.newSubjects.length ? 'bg-fill-strong' : 'bg-transparent')} />
            </button>
          );
        })}
      </div>
      {day && (
        <div className="mt-6 animate-fade text-[15px]">
          <p className="text-ink-2">{dateBR(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          {day.exams.length > 0 && <p className="mt-2 font-medium text-accent">Prova · {day.exams.join(', ')}</p>}
          {day.reviews.length === 0 && day.newSubjects.length === 0 && day.exams.length === 0 && <p className="mt-2 text-ink-3">Nada agendado.</p>}
          {day.reviews.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] text-ink-3">Revisões</p>
              {day.reviews.map((x: any, i: number) => (
                <button key={`${x.subjectId}${i}`} onClick={() => onOpen(x.subjectId)} className="block text-left hover:opacity-70">
                  {x.name} <span className={clsx('text-[13px]', x.status === 'overdue' ? 'text-negative' : x.status === 'done' ? 'text-positive' : 'text-ink-3')}>
                    {x.status === 'overdue' ? 'atrasada' : x.status === 'done' ? 'feita' : x.status === 'projected' ? 'prevista' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {day.newSubjects.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] text-ink-3">Novos assuntos</p>
              {day.newSubjects.map((n: any) => (
                <button key={n.subjectId} onClick={() => onOpen(n.subjectId)} className="block text-left hover:opacity-70">
                  {n.name} <span className="text-[13px] text-ink-3">{n.minutes} min{n.completed ? ' · concluído' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-6 flex flex-wrap gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ink-3" />revisão</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-negative" />atrasada</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" />prova</span>
      </p>
    </div>
  );
}
