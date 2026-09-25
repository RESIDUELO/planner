/**
 * "Questões potencialmente dominadas" (seção 26).
 *
 * Estimativa matemática — NÃO é promessa de acerto:
 *   questões esperadas do assunto na prova × domínio estimado do assunto
 *
 * Domínio estimado:
 *   - sem estudo e sem questões registradas → 0
 *   - com questões → acerto suavizado (bayesiano) × memória atual (R), se já estudado
 *   - estudado sem questões → valor conservador (config.MASTERY.studiedWithoutQuestions) × R
 */
import { MASTERY } from './config';
import { smoothedAccuracy } from './priority';

export interface MasteryInput {
  studied: boolean;
  questionsAnswered: number;
  questionsCorrect: number;
  /** R atual do cartão de revisão, se existir. */
  retrievability: number | null;
}

export interface MasteryResult {
  mastery: number;
  basis: 'none' | 'questions' | 'studied_only';
  accuracy: number | null;
  smoothedAccuracy: number | null;
  memoryFactor: number;
}

export function estimateMastery(i: MasteryInput): MasteryResult {
  const memoryFactor = i.retrievability ?? 1;
  if (i.questionsAnswered > 0) {
    const sa = smoothedAccuracy(i.questionsCorrect, i.questionsAnswered);
    return {
      mastery: sa * memoryFactor,
      basis: 'questions',
      accuracy: i.questionsCorrect / i.questionsAnswered,
      smoothedAccuracy: sa,
      memoryFactor,
    };
  }
  if (i.studied) {
    return { mastery: MASTERY.studiedWithoutQuestions * memoryFactor, basis: 'studied_only', accuracy: null, smoothedAccuracy: null, memoryFactor };
  }
  return { mastery: 0, basis: 'none', accuracy: null, smoothedAccuracy: null, memoryFactor };
}

export function dominatedQuestions(items: { estimatedQuestions: number; mastery: number }[]): number {
  return items.reduce((s, i) => s + i.estimatedQuestions * i.mastery, 0);
}
