/** Peças das Residências usadas também na Agenda e no Planner. */
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { shortDate } from '../lib/format';
import { TYPE_DOT } from '../lib/residency';
import { deadlineText, inDays, type ResidencyEvent, type StepType } from '../../../shared/residency';
import { diffDays } from '../../../shared/dates';

export function TypeDot({ type, className }: { type: StepType; className?: string }) {
  return <span aria-hidden className={clsx('inline-block h-[7px] w-[7px] shrink-0 rounded-full', TYPE_DOT[type], className)} />;
}

/** "FAMEMA - fim da inscrição", com a bolinha do tipo. Leva à residência. */
export function EventRow({ e, today, withDate }: { e: ResidencyEvent; today: string; withDate?: boolean }) {
  const n = diffDays(e.date, today);
  return (
    <li className="border-b border-line/70 last:border-0">
      <Link to={`/residencias?r=${e.residencyId}`} data-testid="residency-event" className="flex items-baseline gap-3 py-2.5 transition-opacity hover:opacity-70">
        <TypeDot type={e.type} className="translate-y-[-1px]" />
        <span className={clsx('min-w-0 flex-1 text-[15px] leading-snug', e.done && 'text-ink-3 line-through decoration-1')}>
          <span className="text-ink">{e.residency}</span><span className="text-ink-2"> - {e.label}</span>
        </span>
        {withDate && (
          <span className="shrink-0 text-right">
            <span className="tabular block text-[13px] text-ink">{shortDate(e.date, false)}</span>
            <span className={clsx('block text-[11px]', n <= 3 ? 'text-today' : 'text-ink-3')}>{inDays(n)}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** Lista "Próximos prazos". */
export function UpcomingList({ events, today, limit, empty }: { events: ResidencyEvent[]; today: string; limit?: number; empty?: string }) {
  const shown = limit ? events.slice(0, limit) : events;
  if (!shown.length) return <p className="py-3 text-[14px] text-ink-3">{empty ?? 'Nenhum prazo marcado.'}</p>;
  return <ul data-testid="upcoming">{shown.map((e) => <EventRow key={`${e.stepId}-${e.residencyId}-${e.edge}`} e={e} today={today} withDate />)}</ul>;
}

/** Linha discreta do Planner: o prazo mais próximo. */
export function DeadlineLine({ e, today }: { e: ResidencyEvent; today: string }) {
  return (
    <Link to={`/residencias?r=${e.residencyId}`} data-testid="deadline-line" className="inline-flex items-center gap-2 text-ink-2 transition hover:text-ink">
      <TypeDot type={e.type} />{deadlineText(e, today)}
    </Link>
  );
}
