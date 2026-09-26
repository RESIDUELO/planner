/**
 * Agenda no cliente: consultas e ações. Todas as consultas ficam sob a chave
 * ['agenda'], então marcar uma tarefa atualiza a Agenda e o Planner de uma vez.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { addDays } from '../../../shared/dates';

export type TaskKind = 'day' | 'reminder' | 'general';
export interface AgendaTask {
  id: string;
  kind: TaskKind;
  title: string;
  date: string | null;
  time: string | null;
  priority: 1 | 2 | 3 | null;
  note: string;
  checklist: { text: string; done: boolean }[];
  showInPlanner: boolean;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}
export interface AgendaRange { from: string; to: string; tasks: AgendaTask[]; general: AgendaTask[]; notes: Record<string, string> }
export type TaskPatch = Partial<Omit<AgendaTask, 'id' | 'doneAt' | 'createdAt'>>;

export const PRIORITY: Record<1 | 2 | 3, { label: string; tint: string }> = {
  3: { label: 'alta', tint: 'tint-rose' },
  2: { label: 'média', tint: 'tint-butter' },
  1: { label: 'baixa', tint: 'tint-sky' },
};

export const useAgenda = (from: string, to: string, key: string) =>
  useQuery({ queryKey: ['agenda', key, from, to], queryFn: () => api.get<AgendaRange>(`/api/agenda?from=${from}&to=${to}`) });

/** Tarefas que a pessoa escolheu ver no Planner, numa semana. */
export const usePlannerTasks = (from: string) => {
  const to = addDays(from, 6);
  return useQuery({ queryKey: ['agenda', 'planner', from], queryFn: () => api.get<AgendaTask[]>(`/api/agenda/planner?from=${from}&to=${to}`) });
};

/** Aplica uma mudança em todas as listas da agenda já carregadas (a tela responde na hora). */
function patchCache(qc: QueryClient, fn: (t: AgendaTask) => AgendaTask | null) {
  const map = (l: AgendaTask[]) => l.map(fn).filter((t): t is AgendaTask => !!t);
  qc.setQueriesData({ queryKey: ['agenda'] }, (old: any) => {
    if (Array.isArray(old)) return map(old);
    if (old?.tasks) return { ...old, tasks: map(old.tasks), general: map(old.general) };
    return old;
  });
}

export function useTaskActions() {
  const qc = useQueryClient();
  const settle = () => qc.invalidateQueries({ queryKey: ['agenda'] });
  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => api.patch<AgendaTask>(`/api/agenda/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['agenda'] });
      patchCache(qc, (t) => (t.id === id ? { ...t, ...patch } : t));
    },
    onSettled: settle,
  });
  const create = useMutation({
    mutationFn: (t: TaskPatch & { title: string }) => api.post<AgendaTask>('/api/agenda/tasks', t),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/agenda/tasks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['agenda'] });
      patchCache(qc, (t) => (t.id === id ? null : t));
    },
    onSettled: settle,
  });
  return { patch, create, remove, toggle: (t: AgendaTask, done: boolean) => patch.mutate({ id: t.id, patch: { done } }) };
}

/** "14h", "14:30", "9h30 Dentista" → horário + texto (atalho ao criar lembretes). */
export function splitTime(text: string): { time: string | null; title: string } {
  const m = text.trim().match(/^(\d{1,2})(?:[:h](\d{2})?|h)\s+(.+)$/i);
  if (!m) return { time: null, title: text.trim() };
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return { time: null, title: text.trim() };
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, title: m[3].trim() };
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const weekdayLong = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
/** "26 de setembro" */
export const longDate = (d: string) => `${Number(d.slice(8, 10))} de ${MONTHS_LONG[Number(d.slice(5, 7)) - 1]}`;
