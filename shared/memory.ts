/**
 * fsrs_v1 — modelo próprio de repetição espaçada inspirado nos princípios do
 * FSRS (estabilidade, dificuldade, retrievability), adaptado ao tempo até a
 * prova. Não reutiliza código do Anki/FSRS; os parâmetros estão em config.ts.
 *
 * Conceitos:
 *  - Estabilidade S (dias): tempo para a probabilidade de lembrar cair a 90%.
 *  - Dificuldade D (1–10): quanto o assunto resiste a ganhar estabilidade.
 *  - Retrievability R(t) = (1 + t / (9·S))^-1 — curva de esquecimento em lei de potência.
 *
 * Adaptação à prova:
 *  - retenção-alvo sobe de 0,90 (≥120 dias) para 0,95 (≤7 dias);
 *  - nenhum intervalo passa da metade do tempo restante;
 *  - nenhuma revisão é agendada no dia da prova ou depois.
 */
import { MEMORY } from './config';
import { addDays, diffDays, type ISODate } from './dates';

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const GRADE: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

export interface MemoryState {
  stability: number;
  difficulty: number;
  lastReview: ISODate;
  repetitions: number;
  lapses: number;
}

export interface ScheduleResult {
  state: MemoryState;
  retrievabilityAtReview: number | null;
  targetRetention: number;
  idealIntervalDays: number;
  intervalDays: number;
  /** null → não há mais revisão possível antes da prova. */
  nextReview: ISODate | null;
  cappedBy: 'none' | 'remaining_time' | 'exam_eve' | 'max_interval';
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays: number, stability: number): number {
  if (elapsedDays <= 0) return 1;
  return 1 / (1 + elapsedDays / (9 * Math.max(stability, MEMORY.minStability)));
}

/** Intervalo em que R cai até a retenção-alvo r. */
export function intervalForRetention(stability: number, r: number): number {
  return 9 * stability * (1 / r - 1);
}

export function targetRetention(daysToExam: number | null): number {
  if (daysToExam == null) return MEMORY.retentionFar;
  const { retentionFar: far, retentionNear: near, retentionFarDays: fd, retentionNearDays: nd } = MEMORY;
  if (daysToExam >= fd) return far;
  if (daysToExam <= nd) return near;
  return near - ((daysToExam - nd) / (fd - nd)) * (near - far);
}

export function maxIntervalFor(daysToExam: number | null): number {
  if (daysToExam == null) return MEMORY.maxIntervalDays;
  return Math.max(1, Math.floor(daysToExam * MEMORY.maxIntervalFractionOfRemaining));
}

function nextDifficulty(d: number, rating: Rating): number {
  const stepped = d - MEMORY.difficultyStep * (GRADE[rating] - 3);
  const reverted = (1 - MEMORY.difficultyMeanReversion) * stepped + MEMORY.difficultyMeanReversion * 5;
  return clamp(reverted, 1, 10);
}

function successStability(s: number, d: number, r: number, rating: Rating): number {
  const gain =
    Math.exp(MEMORY.successGainLog) *
    (11 - d) *
    Math.pow(s, -MEMORY.successStabilityDecay) *
    (Math.exp(MEMORY.successRetrievabilityFactor * (1 - r)) - 1) *
    (rating === 'hard' ? MEMORY.hardPenalty : 1) *
    (rating === 'easy' ? MEMORY.easyBonus : 1);
  return s * (1 + gain);
}

function lapseStability(s: number, d: number, r: number): number {
  const v =
    MEMORY.lapseScale *
    Math.pow(d, -MEMORY.lapseDifficultyExp) *
    (Math.pow(s + 1, MEMORY.lapseStabilityExp) - 1) *
    Math.exp(MEMORY.lapseRetrievabilityFactor * (1 - r));
  return clamp(v, MEMORY.minStability, s);
}

/** Atualiza o estado de memória após uma avaliação (sem agendar). */
export function applyRating(prev: MemoryState | null, rating: Rating, reviewDate: ISODate): {
  state: MemoryState;
  retrievabilityAtReview: number | null;
} {
  if (!prev) {
    return {
      state: {
        stability: MEMORY.initialStability[rating],
        difficulty: MEMORY.initialDifficulty[rating],
        lastReview: reviewDate,
        repetitions: 1,
        lapses: rating === 'again' ? 1 : 0,
      },
      retrievabilityAtReview: null,
    };
  }
  const elapsed = Math.max(0, diffDays(reviewDate, prev.lastReview));
  const r = retrievability(elapsed, prev.stability);
  const difficulty = nextDifficulty(prev.difficulty, rating);
  const stability =
    rating === 'again'
      ? lapseStability(prev.stability, difficulty, r)
      : successStability(prev.stability, difficulty, r, rating);
  return {
    state: {
      stability,
      difficulty,
      lastReview: reviewDate,
      repetitions: prev.repetitions + 1,
      lapses: prev.lapses + (rating === 'again' ? 1 : 0),
    },
    retrievabilityAtReview: r,
  };
}

/** Calcula a próxima revisão a partir de um estado, considerando a data da prova. */
export function scheduleNext(state: MemoryState, examDate: ISODate | null): Omit<ScheduleResult, 'state' | 'retrievabilityAtReview'> {
  const from = state.lastReview;
  const daysToExam = examDate ? diffDays(examDate, from) : null;
  const r = targetRetention(daysToExam);
  const ideal = intervalForRetention(state.stability, r);
  let interval = Math.max(1, Math.round(ideal));
  let cappedBy: ScheduleResult['cappedBy'] = 'none';

  const cap = maxIntervalFor(daysToExam);
  if (interval > cap) {
    interval = cap;
    cappedBy = daysToExam == null ? 'max_interval' : 'remaining_time';
  }
  if (interval > MEMORY.maxIntervalDays) {
    interval = MEMORY.maxIntervalDays;
    cappedBy = 'max_interval';
  }
  if (daysToExam != null) {
    const lastPossible = daysToExam - 1; // véspera da prova
    if (lastPossible < 1) {
      return { targetRetention: r, idealIntervalDays: ideal, intervalDays: 0, nextReview: null, cappedBy: 'exam_eve' };
    }
    if (interval > lastPossible) {
      interval = lastPossible;
      cappedBy = 'exam_eve';
    }
  }
  return { targetRetention: r, idealIntervalDays: ideal, intervalDays: interval, nextReview: addDays(from, interval), cappedBy };
}

export function review(prev: MemoryState | null, rating: Rating, reviewDate: ISODate, examDate: ISODate | null): ScheduleResult {
  const { state, retrievabilityAtReview } = applyRating(prev, rating, reviewDate);
  return { state, retrievabilityAtReview, ...scheduleNext(state, examDate) };
}

/**
 * Reajuste conforme a prova se aproxima (ou muda de data): uma revisão já
 * agendada nunca fica além do limite permitido a partir de hoje, nem depois
 * da véspera da prova.
 */
export function adjustDueDate(nextReview: ISODate | null, today: ISODate, examDate: ISODate | null): ISODate | null {
  if (!nextReview) return null;
  if (!examDate) return nextReview;
  const remaining = diffDays(examDate, today);
  if (remaining <= 1) return nextReview < examDate ? nextReview : null;
  let due = nextReview;
  const capDate = addDays(today, maxIntervalFor(remaining));
  if (due > capDate) due = capDate;
  const eve = addDays(examDate, -1);
  if (due > eve) due = eve;
  return due;
}

/** Avaliação inicial sugerida a partir do desempenho em questões. */
export function initialRatingFromAccuracy(accuracy: number | null): Rating {
  if (accuracy == null) return 'good';
  if (accuracy >= 0.9) return 'easy';
  if (accuracy >= 0.7) return 'good';
  if (accuracy >= 0.5) return 'hard';
  return 'again';
}

/**
 * Projeta as próximas revisões supondo avaliação "Good" (usado para prever a
 * carga no calendário e no planejamento — nunca substitui a revisão real).
 */
export function projectReviews(state: MemoryState, firstDue: ISODate | null, examDate: ISODate | null, until: ISODate, maxCount = 12): ISODate[] {
  const out: ISODate[] = [];
  let due = firstDue;
  let st = state;
  while (due && due <= until && out.length < maxCount) {
    if (examDate && due >= examDate) break;
    out.push(due);
    const res = review(st, 'good', due, examDate);
    st = res.state;
    due = res.nextReview;
  }
  return out;
}
