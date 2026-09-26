/**
 * Residências no cliente: a lista (uma consulta só, ['residencies']) e as
 * ações. A Agenda e o Planner leem desta mesma consulta.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { nextEvent, residencyEvents, type Residency, type ResidencyEvent, type StatusTone, type StepType } from '../../../shared/residency';

export type ResidencyView = Residency & { exam: { institution: string; name: string; official: boolean } | null };
export type ResidencyPatch = Partial<Omit<Residency, 'id' | 'createdAt'>>;

export const TYPE_DOT: Record<StepType, string> = { inscricao: 'dot-sky', prova: 'dot-lilac', resultado: 'dot-mint' };
export const TONE_TINT: Record<StatusTone, string | null> = { open: 'tint-sky', enrolled: 'tint-butter', exam: 'tint-lilac', result: 'tint-mint', muted: null };

export const useResidencies = () =>
  useQuery({ queryKey: ['residencies'], queryFn: () => api.get<ResidencyView[]>('/api/residencies'), retry: false, staleTime: 30_000 });

/** Datas marcadas de todas as residências (menos as de "não vou"). */
export function allEvents(list: ResidencyView[] | undefined): ResidencyEvent[] {
  return (list ?? []).filter((r) => r.decision !== 'no').flatMap(residencyEvents).sort((a, b) => a.date.localeCompare(b.date));
}

/** Prazos em aberto de hoje em diante. */
export const upcoming = (list: ResidencyView[] | undefined, today: string) => allEvents(list).filter((e) => !e.done && e.date >= today);

/** O prazo mais próximo entre todas as residências. */
export function nearest(list: ResidencyView[] | undefined, today: string) {
  return (list ?? []).filter((r) => r.decision !== 'no').map((r) => nextEvent(r, today)).filter((e): e is ResidencyEvent => !!e)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

export function useResidencyActions() {
  const qc = useQueryClient();
  const settle = () => { qc.invalidateQueries({ queryKey: ['residencies'] }); qc.invalidateQueries({ queryKey: ['exams'] }); };
  const set = (fn: (l: ResidencyView[]) => ResidencyView[]) => qc.setQueryData<ResidencyView[]>(['residencies'], (old) => (old ? fn(old) : old));
  const create = useMutation({
    mutationFn: (r: ResidencyPatch & { name: string }) => api.post<ResidencyView>('/api/residencies', r),
    onSuccess: (r) => set((l) => [...l, r]),
    onSettled: settle,
  });
  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ResidencyPatch }) => api.patch<ResidencyView>(`/api/residencies/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['residencies'] });
      const prev = qc.getQueryData<ResidencyView[]>(['residencies']);
      set((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return { prev };
    },
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(['residencies'], c.prev),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/residencies/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['residencies'] });
      set((l) => l.filter((r) => r.id !== id));
    },
    onSettled: settle,
  });
  return { create, patch, remove };
}
