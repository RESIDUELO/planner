/**
 * Agenda: "o que eu preciso fazer?". Organização pessoal, independente do
 * planner de estudos: tarefas e lembretes de cada dia, anotação do dia e a
 * lista de tarefas gerais (sem dia marcado, com prazo opcional).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { api, ApiError, errorMessage } from '../lib/api';
import { todayBR } from '../lib/format';
import { useWide } from '../lib/zoom';
import { longDate, weekdayLong, type AgendaRange, type AgendaTask } from '../lib/agenda';
import { AddLine, AgendaRow, TaskEditor, useQuickAdd } from '../components/Agenda';
import { Eyebrow, Note, Spinner } from '../components/ui';
import { Marks, MonthCalendar, monthEnd, monthStart, type Mark } from '../components/MonthCalendar';
import { addDays, weekday } from '../../../shared/dates';

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
const isISO = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Tarefas gerais: abertas primeiro, pelo prazo e pela prioridade. */
function sortGeneral(l: AgendaTask[]) {
  return [...l].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (b.priority ?? 0) - (a.priority ?? 0));
}

export function AgendaPage() {
  const today = todayBR();
  const [params, setParams] = useSearchParams();
  const day = isISO(params.get('dia')) ? params.get('dia')! : today;
  const setDay = (d: string) => { setParams(d === today ? {} : { dia: d }, { replace: true }); setMonth(monthStart(d)); };
  const [month, setMonth] = useState(monthStart(day));
  const [open, setOpen] = useState<AgendaTask | null>(null);
  const desktop = useWide();
  const quickAdd = useQuickAdd();

  // Uma consulta cobre o mês do calendário e a semana do dia escolhido
  const mon = mondayOf(day);
  const from = [mon, mondayOf(month)].sort()[0];
  const to = [addDays(mon, 6), addDays(mondayOf(monthEnd(month)), 6)].sort()[1];
  const q = useQuery({ queryKey: ['agenda', 'range', from, to], queryFn: () => api.get<AgendaRange>(`/api/agenda?from=${from}&to=${to}`), placeholderData: keepPreviousData });

  useEffect(() => {
    document.documentElement.classList.add('rp-fit');
    return () => document.documentElement.classList.remove('rp-fit');
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, AgendaTask[]>();
    for (const t of q.data?.tasks ?? []) if (t.date) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return m;
  }, [q.data]);
  // Marcas do calendário: bolinha escura = tarefa (clara quando todas feitas), rosa = lembrete, traço = anotação
  const mark = (d: string): Mark => {
    const l = byDay.get(d) ?? [];
    const tasks = l.filter((t) => t.kind !== 'reminder');
    return {
      task: tasks.some((t) => !t.done) ? 'open' : tasks.length ? 'done' : null,
      reminder: l.some((t) => t.kind === 'reminder'),
      note: !!q.data?.notes[d],
    };
  };

  const items = byDay.get(day) ?? [];
  const tasks = [...items.filter((t) => t.kind === 'day'), ...items.filter((t) => t.kind === 'general')];
  const reminders = items.filter((t) => t.kind === 'reminder');
  const general = sortGeneral(q.data?.general ?? []);

  if (q.isLoading) return <Spinner />;
  if (q.error && !q.data) return <AgendaError error={q.error} />;
  return (
    <div className="grid gap-14 fit:h-[calc(var(--app-h,100dvh)-var(--chrome-h))] fit:grid-cols-[minmax(0,1fr)_320px] fit:grid-rows-[minmax(0,1fr)] fit:gap-10">
      <section aria-label="Dia" className="min-w-0 fit:flex fit:min-h-0 fit:flex-col">
        <div className="fit:shrink-0">
          <Eyebrow>Agenda · {weekdayLong(day)}{day === today ? ' · hoje' : ''}</Eyebrow>
          <div className="mt-3 mb-8 flex items-center justify-between gap-3">
            <button onClick={() => setDay(addDays(day, -1))} aria-label="Dia anterior" className="flex items-center gap-1.5 rounded-full py-1.5 pr-2 text-[13px] text-ink-2 transition hover:text-ink">
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} /><span className="hidden sm:inline">dia anterior</span>
            </button>
            <div className="text-center">
              <h1 className="font-display text-[40px] leading-none sm:text-[52px]">{longDate(day)}</h1>
              {day !== today && <button onClick={() => setDay(today)} className="mt-2 text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">voltar para hoje</button>}
            </div>
            <button onClick={() => setDay(addDays(day, 1))} aria-label="Próximo dia" className="flex items-center gap-1.5 rounded-full py-1.5 pl-2 text-[13px] text-ink-2 transition hover:text-ink">
              <span className="hidden sm:inline">dia seguinte</span><ChevronRight className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </div>
          <WeekStrip day={day} today={today} mark={mark} onPick={setDay} />
        </div>

        <div className={clsx(desktop && 'no-scrollbar fade-scroll -mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-10')}>
          <div key={day} className="mt-10 grid gap-x-10 gap-y-10 animate-in md:grid-cols-2">
            <div aria-label="Tarefas do dia" role="group">
              <ColumnHead>Tarefas</ColumnHead>
              <ul>{tasks.map((t) => <AgendaRow key={t.id} task={t} onOpen={setOpen} checklist />)}</ul>
              <AddLine label="Adicionar tarefa" testId="add-day-task" onAdd={(text) => quickAdd('day', text, day)} />
            </div>
            <div aria-label="Lembretes" role="group">
              <ColumnHead>Lembretes</ColumnHead>
              <ul>{reminders.map((t) => <AgendaRow key={t.id} task={t} onOpen={setOpen} />)}</ul>
              <AddLine bell label="Adicionar lembrete" testId="add-reminder" onAdd={(text) => quickAdd('reminder', text, day)} />
            </div>
          </div>
          <DayNote key={`note-${day}`} date={day} initial={q.data?.notes[day] ?? ''} />
        </div>
      </section>

      <aside aria-label="Agenda do mês" className="no-scrollbar flex min-w-0 flex-col gap-14 fit:min-h-0 fit:gap-10 fit:overflow-y-auto">
        <MonthCalendar month={month} day={day} today={today} mark={mark} onPick={setDay} onMonth={setMonth} />
        <section aria-label="Tarefas a fazer" className="order-first fit:order-none fit:flex fit:min-h-[220px] fit:flex-1 fit:flex-col">
          <div className="flex items-baseline gap-3 fit:shrink-0">
            <span className="font-display text-[26px] italic">Tarefas a fazer</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <GeneralList tasks={general} onOpen={setOpen} onAdd={(text) => quickAdd('general', text, null)} />
        </section>
      </aside>

      {open && <TaskEditor key={open.id} task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ColumnHead({ children }: { children: string }) {
  return <div className="border-b border-ink/70 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">{children}</div>;
}

/** Os sete dias da semana, como as abas de um planner de papel. */
/** A Agenda não abriu: explica o motivo (no site, geralmente falta rodar o SQL da Agenda). */
function AgendaError({ error }: { error: unknown }) {
  const missing = error instanceof ApiError && error.status === 503;
  return (
    <div className="mx-auto max-w-xl py-10">
      <Note tone="negative">
        {missing
          ? <>A Agenda ainda não foi ativada no banco do site. No Supabase, abra <b>SQL Editor → New query</b>, cole o arquivo <b>supabase/parts/13_agenda.sql</b> e clique em <b>Run</b>. Depois recarregue esta página.</>
          : <>Não foi possível abrir a Agenda: {errorMessage(error)}</>}
      </Note>
    </div>
  );
}

function WeekStrip({ day, today, mark, onPick }: { day: string; today: string; mark: (d: string) => Mark; onPick: (d: string) => void }) {
  const mon = mondayOf(day);
  return (
    <div className="grid grid-cols-7 border-y border-line" role="tablist" aria-label="Dias da semana">
      {Array.from({ length: 7 }, (_, i) => addDays(mon, i)).map((d) => {
        const m = mark(d);
        const sel = d === day;
        return (
          <button key={d} role="tab" aria-selected={sel} onClick={() => onPick(d)} aria-label={`${weekdayLong(d)}, ${longDate(d)}`}
            className={clsx('relative flex flex-col items-center gap-1 py-2.5 transition', sel ? 'text-ink' : 'text-ink-3 hover:text-ink')}>
            <span className={clsx('text-[10px] font-medium tracking-[0.16em] uppercase', d === today && 'text-today')}>{WD[weekday(d)]}</span>
            <span className={clsx('tabular font-display text-[22px] leading-none', d === today && 'text-today')}>{Number(d.slice(8))}</span>
            <Marks m={m} />
            {sel && <span className="absolute inset-x-3 -bottom-px h-[2px] bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

function GeneralList({ tasks, onOpen, onAdd }: { tasks: AgendaTask[]; onOpen: (t: AgendaTask) => void; onAdd: (text: string) => Promise<unknown> }) {
  const [showDone, setShowDone] = useState(false);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  return (
    <div className="no-scrollbar mt-2 fit:min-h-0 fit:flex-1 fit:overflow-y-auto fit:overscroll-contain fit:fade-scroll fit:pt-1 fit:pb-6">
      <ul>{open.map((t) => <AgendaRow key={t.id} task={t} onOpen={onOpen} />)}</ul>
      {!open.length && <p className="py-3 text-[14px] text-ink-3">Coisas para resolver em algum momento, sem dia marcado.</p>}
      <AddLine label="Nova tarefa" testId="add-general" onAdd={onAdd} />
      {done.length > 0 && (
        <>
          <button onClick={() => setShowDone(!showDone)} className="mt-2 text-[12px] text-ink-3 underline-offset-4 hover:text-ink hover:underline">
            {showDone ? 'esconder concluídas' : `concluídas (${done.length})`}
          </button>
          {showDone && <ul className="mt-1">{done.map((t) => <AgendaRow key={t.id} task={t} onOpen={onOpen} />)}</ul>}
        </>
      )}
    </div>
  );
}

/** Anotação do dia: um bloquinho pautado que salva sozinho. */
function DayNote({ date, initial }: { date: string; initial: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [reason, setReason] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const last = useRef(initial);
  const latest = useRef(initial);
  latest.current = text;
  // Chegou do banco depois (primeira carga) e a pessoa ainda não escreveu nada
  useEffect(() => { if (text === last.current && initial !== last.current) { setText(initial); last.current = initial; } }, [initial]);
  const save = async (content: string, retry = true): Promise<void> => {
    if (content === last.current) return;
    setState('saving');
    try {
      await api.put(`/api/agenda/notes/${date}`, { content });
      last.current = content;
      qc.setQueriesData({ queryKey: ['agenda'] }, (old: any) => (old?.notes ? { ...old, notes: { ...old.notes, [date]: content } } : old));
      setState('saved');
    } catch (e) {
      // Uma falha passageira (conexão) tenta de novo sozinha; se persistir, mostra o motivo
      if (retry) { await new Promise((r) => setTimeout(r, 1500)); return save(latest.current, false); }
      setReason(errorMessage(e));
      setState('error');
    }
  };
  const onChange = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 700);
  };
  // Trocou de dia com algo por salvar: salva antes de sair
  useEffect(() => () => { clearTimeout(timer.current); if (latest.current !== last.current) save(latest.current); }, []);
  const status = state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo' : state === 'error' ? `Não foi possível salvar${reason ? `: ${reason}` : ''}` : '';
  return (
    <section className="mt-14" aria-label="Anotação do dia">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[26px] italic">Anotação</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="notebook notebook-sm mt-4">
        <textarea className="notebook-text" rows={Math.max(5, text.split('\n').length + 1)} value={text} aria-label="Anotação do dia"
          placeholder="Escreva aqui…" onChange={(e) => onChange(e.target.value)} onBlur={() => { clearTimeout(timer.current); save(text); }} />
      </div>
      <p className={clsx('mt-2 min-h-4 text-right text-[12px]', state === 'error' ? 'text-negative' : 'text-ink-3')} role={state === 'error' ? 'alert' : undefined}>{status}</p>
    </section>
  );
}
