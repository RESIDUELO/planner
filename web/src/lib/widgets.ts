/**
 * O que aparece na tela do Planner (Personalizar). Fica guardado no aparelho
 * e vale na hora, em todas as telas abertas.
 */
import { useSyncExternalStore } from 'react';

export type WidgetKey = 'library' | 'reviews' | 'notes' | 'tasks' | 'pomodoro' | 'performance' | 'calendar';
export type Widgets = Record<WidgetKey, boolean>;

export const WIDGETS: { key: WidgetKey; label: string; hint: string }[] = [
  { key: 'library', label: 'Assuntos', hint: 'lista ao lado da semana' },
  { key: 'reviews', label: 'Revisões', hint: 'coluna de cada dia' },
  { key: 'notes', label: 'Observações', hint: 'folha da semana' },
  { key: 'tasks', label: 'Tarefas', hint: 'da Agenda, em cada dia' },
  { key: 'pomodoro', label: 'Pomodoro', hint: 'botão de foco nos assuntos' },
  { key: 'performance', label: 'Desempenho', hint: 'números ao lado' },
  { key: 'calendar', label: 'Calendário', hint: 'mês ao lado' },
];

const KEY = 'rp-widgets';
const ALL: Widgets = { library: true, reviews: true, notes: true, tasks: true, pomodoro: true, performance: true, calendar: true };
const subs = new Set<() => void>();
let cache: Widgets | null = null;

function read(): Widgets {
  if (cache) return cache;
  try { cache = { ...ALL, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { cache = { ...ALL }; }
  return cache!;
}

export function setWidget(key: WidgetKey, on: boolean) {
  cache = { ...read(), [key]: on };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* vale só nesta sessão */ }
  subs.forEach((f) => f());
}

export function useWidgets(): Widgets {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read, read);
}
