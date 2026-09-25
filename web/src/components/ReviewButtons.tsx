import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { shortDate } from '../lib/format';
import { useInvalidateStudy } from './SubjectModal';

const OPTIONS = [
  { rating: 'again', label: 'Errei', hint: 'Não lembrei' },
  { rating: 'hard', label: 'Difícil', hint: 'Lembrei com esforço' },
  { rating: 'good', label: 'Bom', hint: 'Lembrei bem' },
  { rating: 'easy', label: 'Fácil', hint: 'Lembrei com facilidade' },
] as const;

/** Avaliação da revisão: quatro opções discretas, lado a lado. */
export function ReviewButtons({ subjectId, onDone }: { subjectId: string; onDone?: (message: string) => void }) {
  const invalidate = useInvalidateStudy();
  const m = useMutation({
    mutationFn: (rating: string) => api.post(`/api/reviews/${subjectId}`, { rating }),
    onSuccess: (r: any) => {
      invalidate();
      onDone?.(r.next.nextReview
        ? `Próxima revisão em ${shortDate(r.next.nextReview, false)} (${r.next.interval} dia${r.next.interval === 1 ? '' : 's'}).`
        : 'Revisão registrada. Não há mais revisões antes da prova.');
    },
    onError: (e) => onDone?.(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-4 gap-1 rounded-[12px] bg-fill p-1" role="group" aria-label="Como foi a revisão?">
      {OPTIONS.map((o) => (
        <button key={o.rating} disabled={m.isPending} title={o.hint} onClick={() => m.mutate(o.rating)}
          className="rounded-[9px] py-2 text-[14px] text-ink transition-all duration-150 hover:bg-canvas hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)] disabled:opacity-40 dark:hover:bg-fill-strong">
          {o.label}
        </button>
      ))}
    </div>
  );
}
