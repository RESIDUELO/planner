/**
 * priority_v2 - ranking e prioridade dos assuntos.
 *
 * 1) Ranking histórico (ordem do planner): primeiro a REGULARIDADE - em quantas
 *    provas o assunto caiu, contando a partir da primeira em que apareceu (um
 *    tema que cai todo ano desde 2023, ou o bloco de Saúde Mental desde 2024,
 *    vale o mesmo que um que cai desde 2021; sempre olhando no mínimo as 3
 *    últimas provas) -, depois a QUANTIDADE de questões nesse mesmo período e,
 *    por fim, a recência. Com várias provas, média ponderada pelo peso de cada uma.
 *
 * 2) Score dinâmico (0–100), usado para "O que estudar hoje" e para a
 *    explicação de cada assunto:
 *       40% histórico + 25% proximidade da prova + 20% esquecimento + 15% desempenho
 */
import { MASTERY, PRIORITY } from './config';
import { diffDays, type ISODate } from './dates';
import { compareHistorical, type ExamHistStats, type SubjectHistStats } from './stats';

export type PriorityLevel = 'muito_alta' | 'alta' | 'media' | 'baixa';

export const LEVEL_LABEL: Record<PriorityLevel, string> = {
  muito_alta: 'Muito alta',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export interface ExamInput {
  editionId: string;
  label: string;
  examDate: ISODate | null;
  isPrimary: boolean;
  /** Nº de questões esperado na próxima prova (edição → prova → média histórica). */
  expectedTotalQuestions: number;
  stats: ExamHistStats;
}

export interface ExamWeight {
  editionId: string;
  label: string;
  weight: number;
  proximity: number;
  daysUntil: number | null;
  excludedReason: null | 'no_data' | 'past';
}

export interface PerExamSubject {
  editionId: string;
  percentage: number;
  questions: number;
  editionsPresent: number;
  editionsAnalyzed: number;
  annualAverage: number;
  estimatedQuestions: number;
  rank: number | null;
  level: PriorityLevel | null;
  byYear: { year: number; questions: number }[];
}

export interface RankedSubject {
  subjectId: string;
  rank: number;
  level: PriorityLevel;
  percentage: number;
  presenceRate: number;
  regularity: number;
  activePercentage: number;
  recentPercentage: number;
  questions: number;
  weighted: number;
  annualAverage: number;
  editionsPresent: number;
  editionsAnalyzed: number;
  lastYear: number | null;
  historicalScore: number;
  proximity: number;
  /** Questões esperadas somando as provas selecionadas (ponderado por prova). */
  estimatedQuestions: number;
  perExam: PerExamSubject[];
}

export function proximityFactor(daysUntil: number | null): number {
  if (daysUntil == null) return 0.5;
  return 1 / (1 + Math.max(0, daysUntil) / PRIORITY.proximityHalfLifeDays);
}

export function examWeights(exams: ExamInput[], today: ISODate): ExamWeight[] {
  const raw = exams.map((e) => {
    const daysUntil = e.examDate ? diffDays(e.examDate, today) : null;
    const proximity = proximityFactor(daysUntil);
    let excludedReason: ExamWeight['excludedReason'] = null;
    if (e.stats.editionsAnalyzed === 0) excludedReason = 'no_data';
    else if (daysUntil != null && daysUntil < 0) excludedReason = 'past';
    const w = excludedReason
      ? 0
      : (e.isPrimary ? PRIORITY.primaryBoost : 1) * (PRIORITY.distantExamFloor + proximity);
    return { editionId: e.editionId, label: e.label, weight: w, proximity, daysUntil, excludedReason };
  });
  // Se todas já passaram, mantém as que têm dados para não zerar o planner.
  if (raw.every((r) => r.weight === 0)) {
    raw.forEach((r, i) => {
      if (exams[i].stats.editionsAnalyzed > 0) {
        r.weight = exams[i].isPrimary ? PRIORITY.primaryBoost : 1;
        r.excludedReason = null;
      }
    });
  }
  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
  return raw.map((r) => ({ ...r, weight: r.weight / total }));
}

export function levelForRank(rank: number, total: number): PriorityLevel {
  const p = total ? (rank - 1) / total : 1;
  for (const l of PRIORITY.levels) if (p < l.maxPercentile) return l.level;
  return 'baixa';
}

export function rankSubjects(exams: ExamInput[], today: ISODate): { weights: ExamWeight[]; subjects: RankedSubject[] } {
  const weights = examWeights(exams, today);
  const wById = new Map(weights.map((w) => [w.editionId, w]));

  // Posição de cada assunto dentro de cada prova (para a tabela multiprova)
  const perExamRank = new Map<string, Map<string, number>>();
  for (const e of exams) {
    const m = new Map<string, number>();
    e.stats.subjects.forEach((s, i) => m.set(s.subjectId, i + 1));
    perExamRank.set(e.editionId, m);
  }

  const ids = new Set<string>();
  for (const e of exams) for (const s of e.stats.subjects) ids.add(s.subjectId);

  const combined = [...ids].map((subjectId) => {
    let percentage = 0, presence = 0, regularity = 0, active = 0, recent = 0, estimated = 0, proximity = 0;
    let questions = 0, weighted = 0, present = 0, analyzed = 0, annual = 0;
    let lastYear: number | null = null;
    const perExam: PerExamSubject[] = [];
    for (const e of exams) {
      const w = wById.get(e.editionId)!;
      const s: SubjectHistStats | undefined = e.stats.subjects.find((x) => x.subjectId === subjectId);
      const rank = perExamRank.get(e.editionId)!.get(subjectId) ?? null;
      const nSubjects = e.stats.subjects.length;
      const est = s ? s.percentage * e.expectedTotalQuestions : 0;
      perExam.push({
        editionId: e.editionId,
        percentage: s?.percentage ?? 0,
        questions: s?.questions ?? 0,
        editionsPresent: s?.editionsPresent ?? 0,
        editionsAnalyzed: e.stats.editionsAnalyzed,
        annualAverage: s?.annualAverage ?? 0,
        estimatedQuestions: est,
        rank,
        level: rank ? levelForRank(rank, nSubjects) : null,
        byYear: s?.byYear ?? e.stats.years.map((year) => ({ year, questions: 0 })),
      });
      if (!s) continue;
      percentage += w.weight * s.percentage;
      presence += w.weight * s.presenceRate;
      regularity += w.weight * s.regularity;
      active += w.weight * s.activePercentage;
      recent += w.weight * s.recentPercentage;
      questions += s.questions;
      weighted += s.weighted;
      present += s.editionsPresent;
      analyzed += s.editionsAnalyzed;
      annual += w.weight * s.annualAverage;
      if (w.weight > 0) {
        estimated += est;
        proximity = Math.max(proximity, w.proximity);
      }
      if (s.lastYear != null && (lastYear == null || s.lastYear > lastYear)) lastYear = s.lastYear;
    }
    return {
      subjectId, percentage, presenceRate: presence, regularity, activePercentage: active, recentPercentage: recent, questions, weighted,
      editionsPresent: present, editionsAnalyzed: analyzed, annualAverage: annual, lastYear,
      estimatedQuestions: estimated, proximity, perExam,
    };
  });

  // Só entram assuntos com peso nas provas consideradas
  const relevant = combined.filter((c) => c.percentage > 0);
  relevant.sort(compareHistorical);
  const maxPct = Math.max(...relevant.map((r) => r.activePercentage), 0) || 1;
  const maxRecent = Math.max(...relevant.map((r) => r.recentPercentage), 0) || 1;

  const subjects: RankedSubject[] = relevant.map((c, i) => ({
    ...c,
    rank: i + 1,
    level: levelForRank(i + 1, relevant.length),
    historicalScore:
      PRIORITY.historical.frequency * (c.activePercentage / maxPct) +
      PRIORITY.historical.consistency * c.regularity +
      PRIORITY.historical.recency * (c.recentPercentage / maxRecent),
  }));
  return { weights, subjects };
}

export interface DynamicInputs {
  historicalScore: number;
  proximity: number;
  /** R atual (0–1) ou null se o assunto ainda não foi estudado. */
  retrievability: number | null;
  questionsAnswered: number;
  questionsCorrect: number;
}

export interface DynamicScore {
  score: number;
  components: { historical: number; proximity: number; forgetting: number; performance: number };
}

export function dynamicPriority(i: DynamicInputs): DynamicScore {
  const forgetting = i.retrievability == null ? 1 : 1 - i.retrievability;
  const performance =
    i.questionsAnswered >= MASTERY.minQuestionsForPerformance
      ? 1 - smoothedAccuracy(i.questionsCorrect, i.questionsAnswered)
      : 0.5;
  const w = PRIORITY.weights;
  const components = {
    historical: w.historical * i.historicalScore,
    proximity: w.proximity * i.proximity,
    forgetting: w.forgetting * forgetting,
    performance: w.performance * performance,
  };
  const score = 100 * (components.historical + components.proximity + components.forgetting + components.performance);
  return { score, components };
}

export function smoothedAccuracy(correct: number, total: number): number {
  return (correct + MASTERY.priorMean * MASTERY.priorWeight) / (total + MASTERY.priorWeight);
}
