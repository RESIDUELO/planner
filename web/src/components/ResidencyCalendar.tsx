/**
 * Calendário grande das Residências: o mês inteiro, só com as datas das
 * residências escolhidas (inscrição, prova, resultado...). No computador cada
 * dia mostra os nomes; no celular, bolinhas, e o dia tocado lista as datas.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTHS_LONG, longDate } from '../lib/agenda';
import { type ResidencyView } from '../lib/residency';
import { residencyEvents, STEP_TYPES, type ResidencyEvent, type StepType } from '../../../shared/residency';
import { addDays, weekday } from '../../../shared/dates';
import { TypeDot } from './Residencies';

const WEEK = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const TINT: Record<StepType, string> = { inscricao: 'tint-sky', prova: 'tint-lilac', resultado: 'tint-mint' };
const MAX_CHIPS = 3;

const monthOf = (d: string) => d.slice(0, 7);
function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** As semanas (segunda a domingo) que cobrem o mês. */
function weeksOf(m: string) {
  const first = `${m}-01`;
  const start = addDays(first, -((weekday(first) + 6) % 7));
  const days: string[] = [];
  for (let d = start; monthOf(d) <= m || days.length % 7; d = addDays(d, 1)) days.push(d);
  return days;
}

export function ResidencyCalendar({ residencies, today, onOpen }: { residencies: ResidencyView[]; today: string; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => monthOf(today));
  const [picked, setPicked] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, ResidencyEvent[]>();
    for (const r of residencies) {
      if (r.decision === 'no') continue;
      for (const e of residencyEvents(r)) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    // Prova primeiro: é o que mais importa no dia
    const rank: Record<StepType, number> = { prova: 0, inscricao: 1, resultado: 2 };
    for (const list of m.values()) list.sort((a, b) => rank[a.type] - rank[b.type] || a.residency.localeCompare(b.residency));
    return m;
  }, [residencies]);
  const days = weeksOf(month);
  const [y, mo] = month.split('-').map(Number);
  const inMonth = [...byDay.entries()].filter(([d]) => monthOf(d) === month).reduce((n, [, l]) => n + l.length, 0);
  const sel = picked && monthOf(picked) === month ? picked : null;
  const go = (n: number) => { setMonth((m) => shiftMonth(m, n)); setPicked(null); };

  return (
    <section aria-label="Calendário das residências" data-testid="residency-calendar">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[34px] leading-none capitalize sm:text-[44px]">{MONTHS_LONG[mo - 1]} <span className="text-ink-3">{y}</span></h2>
          <p className="mt-2 text-[13px] text-ink-3">{inMonth ? `${inMonth} ${inMonth === 1 ? 'data' : 'datas'} das suas residências neste mês` : 'Nenhuma data das suas residências neste mês'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pb-1">
          {month !== monthOf(today) && (
            <button onClick={() => { setMonth(monthOf(today)); setPicked(null); }} className="mr-2 text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">hoje</button>
          )}
          <button onClick={() => go(-1)} aria-label="Mês anterior" className="rounded-full p-2 text-ink-2 hover:bg-fill hover:text-ink"><ChevronLeft className="h-5 w-5" strokeWidth={1.25} /></button>
          <button onClick={() => go(1)} aria-label="Próximo mês" className="rounded-full p-2 text-ink-2 hover:bg-fill hover:text-ink"><ChevronRight className="h-5 w-5" strokeWidth={1.25} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-t border-l border-ink/60">
        {WEEK.map((w) => (
          <div key={w} className="border-r border-b border-ink/60 py-2 text-center text-[10.5px] font-semibold tracking-[0.22em] text-ink uppercase">{w}</div>
        ))}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const out = monthOf(d) !== month;
          const isToday = d === today;
          return (
            <div key={d} data-date={d} onClick={() => list.length && setPicked(d === sel ? null : d)}
              className={clsx('relative min-h-[64px] border-r border-b border-ink/60 p-1 sm:min-h-[118px] sm:p-1.5',
                out ? 'bg-fill/40' : 'bg-canvas', list.length && 'cursor-pointer sm:cursor-default', d === sel && 'ring-2 ring-ink ring-inset')}>
              <span className={clsx('absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 text-[11px] tabular sm:h-6 sm:min-w-6 sm:text-[12px]',
                isToday ? 'bg-today text-canvas' : out ? 'text-ink-3' : 'bg-fill text-ink-2')}>{Number(d.slice(8))}</span>
              {/* Computador: os nomes; celular: bolinhas */}
              <div className="mt-7 hidden flex-col gap-1 sm:flex">
                {list.slice(0, MAX_CHIPS).map((e) => (
                  <button key={`${e.residencyId}-${e.stepId}-${e.edge}`} onClick={() => onOpen(e.residencyId)} title={`${e.residency} - ${e.label}`}
                    data-testid="calendar-event"
                    className={clsx('block w-full truncate rounded-[4px] px-1.5 py-[3px] text-left text-[11.5px] leading-tight transition hover:brightness-95',
                      // O dia da prova se destaca: fundo escuro
                      e.key === 'prova' ? 'bg-ink font-semibold text-canvas' : TINT[e.type], e.done && 'line-through opacity-50', out && 'opacity-50')}>
                    {e.residency} <span className="font-normal opacity-80">· {e.label}</span>
                  </button>
                ))}
                {list.length > MAX_CHIPS && (
                  <button onClick={() => setPicked(d)} className="text-left text-[11px] text-ink-2 hover:text-ink">+ {list.length - MAX_CHIPS} {list.length - MAX_CHIPS === 1 ? 'outra' : 'outras'}</button>
                )}
              </div>
              <div className="absolute bottom-1.5 left-1.5 flex flex-wrap gap-[3px] sm:hidden">
                {list.slice(0, 6).map((e, i) => e.key === 'prova'
                  ? <span key={i} aria-hidden className={clsx('inline-block h-[9px] w-[9px] rounded-full bg-ink', e.done && 'opacity-40')} />
                  : <TypeDot key={i} type={e.type} className={clsx(e.done && 'opacity-40')} />)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-[8px] w-[8px] rounded-full bg-ink" />dia da prova</span>
        {(Object.keys(STEP_TYPES) as StepType[]).map((t) => <span key={t} className="inline-flex items-center gap-1.5"><TypeDot type={t} />{STEP_TYPES[t].toLowerCase()}</span>)}
        <span className="sm:hidden">· toque num dia para ver as datas</span>
      </div>

      {sel && (
        <div className="mt-6" data-testid="calendar-day">
          <div className="mb-2 border-b border-ink/70 pb-1.5 text-[10.5px] font-medium tracking-[0.18em] text-ink-2 uppercase">{longDate(sel)}</div>
          <ul>
            {(byDay.get(sel) ?? []).map((e) => (
              <li key={`${e.residencyId}-${e.stepId}-${e.edge}`}>
                <button onClick={() => onOpen(e.residencyId)} className="flex w-full items-center gap-3 border-b border-line/70 py-2.5 text-left hover:opacity-70">
                  <TypeDot type={e.type} />
                  <span className={clsx('text-[15px]', e.done && 'text-ink-3 line-through')}><span className="text-ink">{e.residency}</span><span className="text-ink-2"> - {e.label}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
