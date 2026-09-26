/**
 * Áreas menores do workspace de estudo, ao lado da Semana:
 *  - Assuntos: biblioteca/fila de conteúdos (arrastar para um dia)
 *  - Foco: Pomodoro compacto (abre a visualização focada por cima)
 *  - Desempenho: poucos números; detalhes sob demanda
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Maximize2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { areaShort, tintFor } from '../lib/areas';
import { int, pct, shortDate, todayBR } from '../lib/format';
import { clock, usePomodoro } from '../lib/pomodoro';
import { dragProps, type DnD } from '../pages/Planner';
import { PerformancePage } from '../pages/Performance';
import { Button, Sheet } from './ui';

function AreaHead({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-baseline gap-3 border-b border-ink/70 pb-2">
      <span className="font-display text-[26px] leading-none">{title}</span>
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

// ---------------------------------------------------------------- Assuntos
export function SubjectLibrary({ data, dnd, onOpen, onAll, fit }: { data: any; dnd: DnD; onOpen: (id: string) => void; onAll: () => void; fit?: boolean }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'todo' | 'all'>('todo');
  const [limit, setLimit] = useState(8);
  const today = todayBR();
  const visible = data.subjects.filter((s: any) => !s.hidden);
  const list = useMemo(() => visible
    .filter((s: any) => (show === 'all' || s.status !== 'studied') && (!q || s.name.toLowerCase().includes(q.toLowerCase())))
    , [data, q, show]);
  const todo = visible.filter((s: any) => s.status !== 'studied').length;
  // Desktop: a lista ocupa o espaço que sobra e rola por dentro (sem barra visível)
  const shown = fit ? list : list.slice(0, limit);

  return (
    <section aria-label="Assuntos" className="animate-in fit:flex fit:min-h-[230px] fit:flex-1 fit:flex-col">
      <AreaHead title="Assuntos" trailing={<button onClick={onAll} className="text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">ver todos</button>} />
      <div className="mt-3 flex shrink-0 items-center gap-3">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input className="field py-1.5 pl-8 text-[14px]" placeholder="Buscar" aria-label="Buscar na lista de assuntos" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button onClick={() => setShow(show === 'todo' ? 'all' : 'todo')} className="shrink-0 text-[12px] text-ink-2 hover:text-ink">
          {show === 'todo' ? `${todo} a estudar` : 'todos'}
        </button>
      </div>
      <ul className="no-scrollbar mt-2 fit:mt-0 fit:min-h-0 fit:flex-1 fit:overflow-y-auto fit:overscroll-contain fit:fade-scroll fit:pt-2 fit:pb-6" data-testid="library">
        {shown.map((s: any) => {
          const dp = s.status === 'studied' ? undefined : dragProps(dnd, { type: 'library', subjectId: s.subjectId, from: '', name: s.name });
          const date = s.nextScheduledDate as string | null;
          return (
            <li key={s.subjectId} {...dp?.li} data-testid="library-item"
              className={clsx('group flex items-center gap-3 border-b border-line/60 py-2.5 last:border-0', dp?.className)}>
              <span className={`h-2 w-2 shrink-0 rounded-full dot-${tintFor(s.area)}`} aria-hidden />
              <button onClick={() => onOpen(s.subjectId)} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70">
                <span className={clsx('block truncate text-[15px] leading-snug', s.status === 'studied' && 'text-ink-3 line-through decoration-1')}>{s.name}</span>
                <span className="block truncate text-[11px] text-ink-3">{areaShort(s.area)} · {pct(s.percentage)}{date ? ` · ${date < today ? 'atrasado' : shortDate(date, false)}` : ' · sem dia'}</span>
              </button>
            </li>
          );
        })}
        {!list.length && <li className="py-3 text-[14px] text-ink-3">Nada por aqui.</li>}
      </ul>
      {!fit && list.length > limit && (
        <button onClick={() => setLimit(limit + 10)} className="mt-2 text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">
          mostrar mais ({list.length - limit})
        </button>
      )}
      <p className="mt-2 hidden shrink-0 text-[11px] text-ink-3 fit:mt-1.5 fit:block">Arraste um assunto para um dia da semana.</p>
    </section>
  );
}

// ---------------------------------------------------------------- Foco
export function FocusWidget() {
  const p = usePomodoro();
  const t = useQuery({ queryKey: ['today'], queryFn: () => api.get('/api/planner/today') });
  const next = (t.data?.newSubjects ?? []).find((s: any) => !s.overflow) ?? t.data?.newSubjects?.[0];
  const subject = p.subject ?? (next ? { id: next.subjectId, name: next.name, area: next.area } : null);
  const active = p.phase !== 'idle';
  const progress = active ? 1 - p.left / p.total : 0;

  return (
    <section aria-label="Foco" className={clsx('shrink-0 animate-in transition-all duration-300 ease-apple', active && 'rounded-[18px] border border-line bg-surface p-5')}>
      <AreaHead title="Foco" trailing={
        <button onClick={() => p.setExpanded(true)} aria-label="Abrir foco" className="rounded-full p-1 text-ink-2 hover:text-ink"><Maximize2 className="h-4 w-4" strokeWidth={1.5} /></button>
      } />
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={clsx('tabular font-display leading-none transition-all duration-300', active ? 'text-[64px]' : 'text-[52px]')} role="timer">{clock(p.left)}</p>
          <p className="mt-2 truncate text-[13px] text-ink-2 fit:mt-1">{p.phase === 'break' ? 'Pausa' : subject?.name ?? 'Tempo de foco'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {p.phase === 'idle' && <Button size="sm" onClick={() => p.start({ subject })}>Iniciar</Button>}
          {active && (p.running ? <Button size="sm" onClick={p.pause}>Pausar</Button> : <Button size="sm" onClick={p.resume}>Continuar</Button>)}
          {active && <button onClick={p.reset} className="text-[12px] text-ink-3 hover:text-ink">reiniciar</button>}
        </div>
      </div>
      {active && <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${progress * 100}%` }} /></div>}
      <p className="mt-3 text-[11px] text-ink-3">{p.focusMin}/{p.breakMin} min · {p.done.n > 0 ? `${p.done.n} hoje · ` : ''}<button onClick={() => p.setExpanded(true)} className="underline underline-offset-4 hover:text-ink">trocar</button></p>
    </section>
  );
}

// ---------------------------------------------------------------- Desempenho
const hours = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

export function PerformanceStrip() {
  const q = useQuery({ queryKey: ['performance'], queryFn: () => api.get('/api/performance') });
  const p = usePomodoro();
  const [open, setOpen] = useState(false);
  const d = q.data;
  if (!d?.hasPlan) return null;
  const answered = d.areas.reduce((t: number, a: any) => t + a.answered, 0);
  const correct = d.areas.reduce((t: number, a: any) => t + a.correct, 0);
  const studied = d.subjects.filter((s: any) => s.status === 'studied');
  const secured = Math.min(1, studied.reduce((t: number, s: any) => t + (s.percentage ?? 0), 0));
  const stats = [
    { label: 'acertos', value: answered ? pct(correct / answered, 0) : '—' },
    { label: 'questões', value: int(answered) },
    { label: 'de foco', value: hours(p.focusMinutesTotal ?? 0) },
    { label: 'assuntos concluídos', value: String(studied.length) },
  ];
  return (
    <section aria-label="Desempenho" className="shrink-0 animate-in">
      <AreaHead title="Desempenho" trailing={<button onClick={() => setOpen(true)} className="text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">detalhes</button>} />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}><dd className="tabular font-display text-[26px] leading-none">{s.value}</dd><dt className="mt-1 text-[11px] text-ink-2">{s.label}</dt></div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] text-ink-2"><span className="text-ink">{pct(secured)}</span> da prova garantidos</p>
      {open && <Sheet open onClose={() => setOpen(false)} wide title="Desempenho"><PerformancePage embedded /></Sheet>}
    </section>
  );
}
