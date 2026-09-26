/**
 * reviewqueue_v1 - revisões como uma fila, com limite diário escolhido pelo aluno.
 *
 * Cada cartão tem uma data "vencida" (FSRS). A fila distribui os cartões pelos
 * dias de estudo, do mais antigo para o mais novo (e, no empate, do mais
 * prioritário), sem passar de `perDay` revisões por dia. Revisões feitas hoje
 * contam no limite de hoje; revisões adiantadas saem da fila (o cartão ganha
 * uma nova data) e as seguintes sobem sozinhas. Nada cai no dia da prova ou
 * depois: se a fila estourar, a revisão fica no último dia antes da prova.
 */
import { addDays, weekday, type ISODate } from './dates';

export interface QueueItem {
  id: string;
  due: ISODate;
  /** Prioridade (maior primeiro no empate). */
  score: number;
  examDate: ISODate | null;
  /** Movida à mão para um dia: fica nesse dia (entra antes das demais). */
  pinned?: boolean;
}

export interface QueueOptions {
  today: ISODate;
  perDay: number;
  studyWeekdays: number[];
  /** Revisões já feitas hoje (ocupam o limite de hoje). */
  doneToday?: number;
}

export function assignReviews(items: QueueItem[], o: QueueOptions): Map<string, ISODate> {
  const perDay = Math.max(1, Math.floor(o.perDay));
  const weekdays = o.studyWeekdays.length ? o.studyWeekdays : [0, 1, 2, 3, 4, 5, 6];
  const used = new Map<ISODate, number>([[o.today, o.doneToday ?? 0]]);
  const out = new Map<string, ISODate>();
  // Fixadas primeiro, exatamente no dia escolhido (ocupam o limite desse dia)
  for (const it of items.filter((x) => x.pinned)) {
    const d = it.due > o.today ? it.due : o.today;
    used.set(d, (used.get(d) ?? 0) + 1);
    out.set(it.id, d);
  }
  const sorted = items.filter((x) => !x.pinned).sort((a, b) => a.due.localeCompare(b.due) || b.score - a.score || a.id.localeCompare(b.id));
  for (const it of sorted) {
    let d = it.due > o.today ? it.due : o.today;
    for (let guard = 0; guard < 2000; guard++) {
      if (weekdays.includes(weekday(d)) && (used.get(d) ?? 0) < perDay) break;
      d = addDays(d, 1);
    }
    if (it.examDate && d >= it.examDate) {
      const last = addDays(it.examDate, -1);
      d = last > o.today ? last : o.today;
    }
    used.set(d, (used.get(d) ?? 0) + 1);
    out.set(it.id, d);
  }
  return out;
}
