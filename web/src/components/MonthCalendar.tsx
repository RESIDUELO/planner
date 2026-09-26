/**
 * Calendário do mês (Agenda e Planner): o mesmo visual nos dois lugares.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { longDate, MONTHS_LONG } from '../lib/agenda';
import { addDays, weekday } from '../../../shared/dates';

const WD1 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);

export type Mark = { task: 'open' | 'done' | null; reminder: boolean; note: boolean };

export function Marks({ m, className }: { m: Mark; className?: string }) {
  return (
    <span className={clsx('flex h-[6px] items-center justify-center gap-[3px]', className)} aria-hidden>
      {m.task && <span data-mark="task" className={clsx('h-[6px] w-[6px] rounded-full', m.task === 'open' ? 'bg-ink' : 'bg-ink-3/60')} />}
      {m.reminder && <span data-mark="reminder" className="h-[6px] w-[6px] rounded-full dot-rose" />}
      {m.note && !m.task && !m.reminder && <span data-mark="note" className="h-[2px] w-[8px] rounded-full bg-ink-3" />}
    </span>
  );
}

const NO_MARK: Mark = { task: null, reminder: false, note: false };

export function MonthCalendar({ month, day, today, mark, onPick, onMonth, cell }: {
  month: string; day: string; today: string; mark?: (d: string) => Mark; onPick: (d: string) => void; onMonth: (m: string) => void;
  /** Extras de cada dia (ex.: soltar uma aula arrastada no Planner) */
  cell?: (d: string) => { props?: Record<string, any>; className?: string; circle?: string };
}) {
  const start = mondayOf(month);
  const end = addDays(mondayOf(monthEnd(month)), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const [y, m] = month.split('-').map(Number);
  return (
    <section aria-label="Calendário" className="fit:shrink-0">
      <div className="flex items-center justify-between">
        <button onClick={() => onMonth(monthStart(addDays(month, -1)))} aria-label="Mês anterior" className="rounded-full p-1 text-ink-2 transition hover:text-ink"><ChevronLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="font-display text-[22px] leading-none"><span className="capitalize">{MONTHS_LONG[m - 1]}</span> <span className="text-ink-3">{y}</span></span>
        <button onClick={() => onMonth(monthStart(addDays(month, 32)))} aria-label="Próximo mês" className="rounded-full p-1 text-ink-2 transition hover:text-ink"><ChevronRight className="h-4 w-4" strokeWidth={1.5} /></button>
      </div>
      <div className="mt-4 grid grid-cols-7 text-center">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => <span key={w} className="pb-2 text-[10px] font-medium tracking-[0.14em] text-ink-3">{WD1[w]}</span>)}
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const sel = d === day;
          const mk = mark?.(d) ?? NO_MARK;
          const x = cell?.(d);
          return (
            <button key={d} onClick={() => onPick(d)} aria-label={longDate(d)} aria-current={sel ? 'date' : undefined} data-date={d} {...x?.props}
              className={clsx('group flex flex-col items-center py-[3px]', !inMonth && 'opacity-35', x?.className)}>
              <span className={clsx('tabular flex h-8 w-8 items-center justify-center rounded-full text-[14px] transition',
                sel ? 'bg-ink text-canvas' : d === today ? 'text-today' : 'text-ink group-hover:bg-fill', x?.circle)}>{Number(d.slice(8))}</span>
              <Marks m={mk} className="mt-[3px]" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
