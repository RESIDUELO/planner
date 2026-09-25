import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { dateBR } from '../lib/format';
import { useInvalidateStudy } from './SubjectModal';

const OPTIONS = [
  { rating: 'again', label: 'Errei', hint: 'Não lembrei', cls: 'border-late-500/40 text-late-700 hover:bg-late-50' },
  { rating: 'hard', label: 'Difícil', hint: 'Lembrei com esforço', cls: 'border-warn-500/40 text-warn-700 hover:bg-warn-50' },
  { rating: 'good', label: 'Bom', hint: 'Lembrei bem', cls: 'border-brand-300 text-brand-700 hover:bg-brand-50' },
  { rating: 'easy', label: 'Fácil', hint: 'Lembrei com facilidade', cls: 'border-ok-500/40 text-ok-700 hover:bg-ok-50' },
] as const;

export function ReviewButtons({ subjectId, onDone }: { subjectId: string; onDone?: (message: string) => void }) {
  const invalidate = useInvalidateStudy();
  const m = useMutation({
    mutationFn: (rating: string) => api.post(`/api/reviews/${subjectId}`, { rating }),
    onSuccess: (r: any) => {
      invalidate();
      onDone?.(r.next.nextReview
        ? `Revisão registrada. Próxima em ${dateBR(r.next.nextReview)} (${r.next.interval} dia${r.next.interval === 1 ? '' : 's'}).`
        : 'Revisão registrada. Não há mais revisões possíveis antes da prova.');
    },
    onError: (e) => onDone?.(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Avaliar revisão">
      {OPTIONS.map((o) => (
        <button key={o.rating} disabled={m.isPending} title={o.hint} onClick={() => m.mutate(o.rating)}
          className={`rounded-lg border bg-white px-2 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${o.cls}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
