/**
 * scheduler_v1 — distribui o estudo no calendário respeitando a carga (seção 34).
 *
 * Regras:
 *  - só usa dias de estudo configurados e nunca passa das horas diárias;
 *  - reserva primeiro a carga projetada de revisões e o tempo das questões do dia;
 *  - preenche o restante com assuntos NOVOS na ordem do ranking histórico
 *    (os mais frequentes primeiro), método a método;
 *  - reserva a reta final para revisões;
 *  - o que não couber fica marcado como "fora do tempo disponível" — o planner
 *    nunca inventa horas que o usuário não tem.
 */
import { SCHEDULER } from './config';
import { addDays, diffDays, eachDay, weekday, type ISODate } from './dates';
import { projectReviews, review, type MemoryState } from './memory';

export interface SchedulerMethod {
  id: string;
  code: string;
  activityType: string;
  minutes: number;
}

export interface SchedulerSubject {
  subjectId: string;
  rank: number;
  percentage: number;
  sizeFactor: number;
  /** Data da prova usada para limitar revisões deste assunto. */
  examDate: ISODate | null;
  /** Métodos já concluídos (replanejamento). */
  completedMethodIds: string[];
  /** Atividades escolhidas para este assunto (padrão: todos os métodos). */
  methodIds?: string[];
  /** Cartão de revisão existente, se o assunto já foi estudado. */
  card?: { state: MemoryState; nextReview: ISODate | null } | null;
}

export interface SchedulerInput {
  startDate: ISODate;
  /** Último dia do planejamento (normalmente a data da última prova). */
  endDate: ISODate;
  dailyMinutes: number;
  /** Dias da semana permitidos (0 = domingo … 6 = sábado). */
  studyWeekdays: number[];
  questionsPerDay: number;
  methods: SchedulerMethod[];
  subjects: SchedulerSubject[];
  /** Datas das provas: não se estuda conteúdo novo no dia da prova. */
  examDates: ISODate[];
}

export interface PlannedActivity {
  subjectId: string;
  methodId: string;
  activityType: string;
  date: ISODate;
  minutes: number;
  priority: number;
}

export interface ProjectedReview {
  subjectId: string;
  date: ISODate;
  minutes: number;
  projected: boolean;
}

export interface DayLoad {
  date: ISODate;
  capacity: number;
  reviews: number;
  questions: number;
  newStudy: number;
  finalPhase: boolean;
}

export interface SchedulerOutput {
  activities: PlannedActivity[];
  reviews: ProjectedReview[];
  scheduledSubjectIds: string[];
  unscheduledSubjectIds: string[];
  days: DayLoad[];
  summary: {
    studyDays: number;
    finalPhaseDays: number;
    capacityMinutes: number;
    newStudyMinutesPlanned: number;
    newStudyMinutesRequired: number;
    reviewMinutesProjected: number;
    questionsMinutesPerDay: number;
    questionsPerDayRequested: number;
    questionsPerDayFitted: number;
    historicalCoverageScheduled: number;
    historicalCoverageTotal: number;
    warnings: string[];
  };
}

export function roundTo5(x: number): number {
  return Math.max(5, Math.round(x / 5) * 5);
}

/**
 * Tamanho relativo do assunto: sqrt(% / referência), limitado a
 * [sizeFactorMin, sizeFactorMax]. A referência é a mediana dos assuntos que,
 * juntos, cobrem os primeiros 80% das questões — assim a cauda de assuntos
 * raríssimos não infla o tempo dos assuntos centrais.
 */
export function sizeFactors(percentages: number[]): number[] {
  const sorted = [...percentages].filter((p) => p > 0).sort((a, b) => b - a);
  const total = sorted.reduce((t, p) => t + p, 0);
  const core: number[] = [];
  let acc = 0;
  for (const p of sorted) {
    core.push(p);
    acc += p;
    if (acc >= total * SCHEDULER.sizeReferenceCoverage) break;
  }
  const ref = core.length ? core[Math.floor(core.length / 2)] : 1;
  return percentages.map((p) => {
    const f = Math.sqrt((p || ref) / (ref || 1));
    return Math.round(Math.min(SCHEDULER.sizeFactorMax, Math.max(SCHEDULER.sizeFactorMin, f)) * 10) / 10;
  });
}

export function reviewMinutes(sizeFactor: number): number {
  return roundTo5(SCHEDULER.reviewMinutes * sizeFactor);
}

export function methodMinutes(m: SchedulerMethod, sizeFactor: number): number {
  return roundTo5(m.minutes * sizeFactor);
}

export function buildSchedule(input: SchedulerInput): SchedulerOutput {
  const warnings: string[] = [];
  const examSet = new Set(input.examDates);
  const lastDay = addDays(input.endDate, -1);
  const allDays = input.startDate <= lastDay ? eachDay(input.startDate, lastDay) : [];
  const studyDays = allDays.filter((d) => input.studyWeekdays.includes(weekday(d)) && !examSet.has(d));

  const span = studyDays.length;
  const finalPhaseDays =
    diffDays(input.endDate, input.startDate) >= SCHEDULER.finalPhaseMinSpanDays
      ? Math.min(SCHEDULER.finalPhaseMaxDays, Math.round(span * SCHEDULER.finalPhaseShare))
      : 0;
  const finalPhaseStart = span - finalPhaseDays;

  // Questões do dia
  const questionsMinutesRequested = input.questionsPerDay * SCHEDULER.minutesPerQuestion;
  const questionsMinutesCap = Math.floor(input.dailyMinutes * SCHEDULER.maxDailyQuestionsShare);
  const questionsMinutes = Math.min(questionsMinutesRequested, questionsMinutesCap);
  const questionsPerDayFitted = Math.floor(questionsMinutes / SCHEDULER.minutesPerQuestion);
  if (questionsPerDayFitted < input.questionsPerDay) {
    warnings.push(
      `As ${input.questionsPerDay} questões/dia precisariam de ${Math.round(questionsMinutesRequested)} min; ` +
        `o planner reservou até ${Math.round(SCHEDULER.maxDailyQuestionsShare * 100)}% do dia (${questionsPerDayFitted} questões).`,
    );
  }

  const days: DayLoad[] = studyDays.map((date, i) => ({
    date,
    capacity: input.dailyMinutes,
    reviews: 0,
    questions: 0,
    newStudy: 0,
    finalPhase: i >= finalPhaseStart,
  }));

  /** Próximo dia de estudo em/depois de `date`. */
  const nextStudyDayIdx = (date: ISODate): number => {
    for (let i = 0; i < days.length; i++) if (days[i].date >= date) return i;
    return -1;
  };

  const reviews: ProjectedReview[] = [];
  const reserveReviews = (subject: SchedulerSubject, dates: ISODate[], projectedFrom: number) => {
    const minutes = reviewMinutes(subject.sizeFactor);
    dates.forEach((date, k) => {
      const idx = nextStudyDayIdx(date);
      if (idx < 0) return;
      days[idx].reviews += minutes;
      reviews.push({ subjectId: subject.subjectId, date: days[idx].date, minutes, projected: k >= projectedFrom });
    });
  };

  // 1) Revisões de assuntos já estudados (cartões existentes)
  for (const s of input.subjects) {
    if (!s.card) continue;
    const dates = projectReviews(s.card.state, s.card.nextReview, s.examDate, lastDay);
    reserveReviews(s, dates, 1);
  }

  // 2) Questões do dia
  for (const d of days) d.questions = questionsMinutes;

  // 3) Conteúdo novo, na ordem do ranking
  const activities: PlannedActivity[] = [];
  const scheduled: string[] = [];
  const unscheduled: string[] = [];
  let required = 0;
  let cursor = 0; // índice do dia atual de preenchimento

  const ordered = [...input.subjects].sort((a, b) => a.rank - b.rank);
  for (const s of ordered) {
    const pending = input.methods.filter((m) => (!s.methodIds || s.methodIds.includes(m.id)) && !s.completedMethodIds.includes(m.id));
    if (pending.length === 0) {
      scheduled.push(s.subjectId);
      continue;
    }
    const blocks = pending.map((m) => ({ m, minutes: methodMinutes(m, s.sizeFactor) }));
    required += blocks.reduce((t, b) => t + b.minutes, 0);

    // Simula o encaixe; só confirma se o assunto inteiro couber antes da reta final.
    const tentative: PlannedActivity[] = [];
    let c = cursor;
    const used = new Map<number, number>();
    let ok = true;
    // Padrão: o assunto inteiro (aula, flashcards, questões…) no MESMO dia.
    // Assunto maior que um dia de estudo ocupa um dia livre inteiro (o tempo
    // estimado de cada atividade é encolhido para caber); só se nem assim
    // couber é que as atividades se dividem.
    let together = false;
    for (let k = cursor; k < finalPhaseStart; k++) {
      const d = days[k];
      const dayOpen = d.capacity - d.reviews - d.questions;
      const free = dayOpen - d.newStudy;
      let mins = blocks.map((b) => Math.min(b.minutes, Math.max(SCHEDULER.minBlockMinutes, dayOpen)));
      const total = mins.reduce((t, m) => t + m, 0);
      if (total > dayOpen && d.newStudy === 0 && blocks.length * SCHEDULER.minBlockMinutes <= dayOpen) {
        const f = dayOpen / total;
        mins = mins.map((m) => Math.max(SCHEDULER.minBlockMinutes, Math.floor(m * f)));
        while (mins.reduce((t, m) => t + m, 0) > dayOpen) { const j = mins.indexOf(Math.max(...mins)); mins[j]--; }
      }
      if (mins.reduce((t, m) => t + m, 0) <= free) {
        blocks.forEach((b, j) => tentative.push({ subjectId: s.subjectId, methodId: b.m.id, activityType: b.m.activityType, date: d.date, minutes: mins[j], priority: s.rank }));
        used.set(k, mins.reduce((t, m) => t + m, 0));
        c = k;
        together = true;
        break;
      }
    }
    for (const b of together ? [] : blocks) {
      let placed = false;
      while (c < finalPhaseStart) {
        const d = days[c];
        const free = d.capacity - d.reviews - d.questions - d.newStudy - (used.get(c) ?? 0);
        const dayOpen = d.capacity - d.reviews - d.questions;
        // Um bloco maior que o dia inteiro é reduzido ao tamanho do dia (nunca excede a capacidade).
        const minutes = Math.min(b.minutes, Math.max(SCHEDULER.minBlockMinutes, dayOpen));
        if (minutes <= free && free >= SCHEDULER.minBlockMinutes) {
          used.set(c, (used.get(c) ?? 0) + minutes);
          tentative.push({ subjectId: s.subjectId, methodId: b.m.id, activityType: b.m.activityType, date: d.date, minutes, priority: s.rank });
          placed = true;
          break;
        }
        c++;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      unscheduled.push(s.subjectId);
      continue;
    }
    for (const [idx, m] of used) days[idx].newStudy += m;
    activities.push(...tentative);
    scheduled.push(s.subjectId);
    cursor = c;

    // Revisões previstas a partir da conclusão do assunto
    const doneDate = tentative[tentative.length - 1].date;
    const first = review(null, 'good', doneDate, s.examDate);
    const dates = projectReviews(first.state, first.nextReview, s.examDate, lastDay);
    reserveReviews(s, dates, 0);
  }

  if (unscheduled.length) {
    warnings.push(
      `${unscheduled.length} assunto(s) de menor frequência não couberam no tempo disponível até a prova. ` +
        'Aumente as horas/dias de estudo ou reduza os métodos para incluí-los.',
    );
  }
  const overloaded = days.filter((d) => d.reviews + d.questions + d.newStudy > d.capacity);
  if (overloaded.length) {
    warnings.push(
      `Em ${overloaded.length} dia(s) as revisões previstas ultrapassam as horas disponíveis; ` +
        'nesses dias o planner prioriza revisões atrasadas e assuntos mais frequentes.',
    );
  }

  const pctById = new Map(input.subjects.map((s) => [s.subjectId, s.percentage]));
  const coverage = (ids: string[]) => ids.reduce((t, id) => t + (pctById.get(id) ?? 0), 0);

  return {
    activities,
    reviews: reviews.sort((a, b) => a.date.localeCompare(b.date)),
    scheduledSubjectIds: scheduled,
    unscheduledSubjectIds: unscheduled,
    days,
    summary: {
      studyDays: span,
      finalPhaseDays,
      capacityMinutes: span * input.dailyMinutes,
      newStudyMinutesPlanned: activities.reduce((t, a) => t + a.minutes, 0),
      newStudyMinutesRequired: required,
      reviewMinutesProjected: reviews.reduce((t, r) => t + r.minutes, 0),
      questionsMinutesPerDay: questionsMinutes,
      questionsPerDayRequested: input.questionsPerDay,
      questionsPerDayFitted,
      historicalCoverageScheduled: coverage(scheduled),
      historicalCoverageTotal: coverage(input.subjects.map((s) => s.subjectId)),
      warnings,
    },
  };
}
