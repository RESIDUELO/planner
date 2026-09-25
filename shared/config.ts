/**
 * Parâmetros dos algoritmos do Residência Planner.
 *
 * Todos os pesos ficam aqui, versionados. Se algum valor mudar de forma que
 * altere resultados, crie uma nova versão (ex.: priority_v2) e registre-a na
 * tabela algorithm_versions — os planners antigos continuam identificando qual
 * versão os gerou.
 */

export const PRIORITY_VERSION = 'priority_v1';
export const MEMORY_VERSION = 'fsrs_v1';
export const SCHEDULER_VERSION = 'scheduler_v1';

export const PRIORITY = {
  /** Score dinâmico (seção 19): pesos somam 1. */
  weights: {
    historical: 0.4,
    proximity: 0.25,
    forgetting: 0.2,
    performance: 0.15,
  },
  /** Composição do componente histórico. */
  historical: {
    frequency: 0.7,
    consistency: 0.2,
    recency: 0.1,
  },
  /** Quantas edições mais recentes contam como "frequência recente". */
  recentEditions: 2,
  /** Peso extra da prova principal no modo multiprova. */
  primaryBoost: 2,
  /** Meia-vida (dias) do fator de proximidade da prova. */
  proximityHalfLifeDays: 60,
  /** Fração mínima de influência de uma prova distante (0–1). */
  distantExamFloor: 0.5,
  /** Faixas de nível por percentil do ranking histórico. */
  levels: [
    { maxPercentile: 0.1, level: 'muito_alta' },
    { maxPercentile: 0.3, level: 'alta' },
    { maxPercentile: 0.6, level: 'media' },
    { maxPercentile: 1, level: 'baixa' },
  ] as const,
} as const;

export const DATA_SUFFICIENCY = {
  /** Abaixo disso: "Dados insuficientes para uma análise histórica confiável." */
  minEditionsReliable: 2,
  /** A partir disso a análise é considerada consistente. */
  goodEditions: 3,
} as const;

export const MASTERY = {
  /** Suavização bayesiana do acerto: (acertos + média·peso) / (total + peso). */
  priorMean: 0.5,
  priorWeight: 2,
  /** Domínio assumido para assunto estudado sem nenhuma questão registrada. */
  studiedWithoutQuestions: 0.5,
  /** Mínimo de questões para o desempenho influenciar a prioridade. */
  minQuestionsForPerformance: 5,
} as const;

export const MEMORY = {
  /** Estabilidade inicial (dias) por avaliação. */
  initialStability: { again: 0.6, hard: 1.5, good: 3.2, easy: 8 },
  /** Dificuldade inicial (1 = fácil, 10 = difícil). */
  initialDifficulty: { again: 7.5, hard: 6.2, good: 5, easy: 3.5 },
  difficultyStep: 0.9,
  difficultyMeanReversion: 0.08,
  /** Ganho de estabilidade em revisões bem-sucedidas. */
  successGainLog: 1.3,
  successStabilityDecay: 0.15,
  successRetrievabilityFactor: 1.0,
  hardPenalty: 0.55,
  easyBonus: 1.35,
  /** Estabilidade após esquecimento (lapse). */
  lapseScale: 1.6,
  lapseDifficultyExp: 0.25,
  lapseStabilityExp: 0.35,
  lapseRetrievabilityFactor: 1.4,
  minStability: 0.3,
  /** Retenção-alvo: 0,90 longe da prova, até 0,95 na última semana. */
  retentionFar: 0.9,
  retentionNear: 0.95,
  retentionFarDays: 120,
  retentionNearDays: 7,
  /** Nenhum intervalo passa de (dias até a prova) × esta fração. */
  maxIntervalFractionOfRemaining: 0.5,
  maxIntervalDays: 365,
  /** Acerto abaixo disso em um registro de questões antecipa a revisão. */
  lowAccuracyThreshold: 0.6,
} as const;

export const SCHEDULER = {
  minutesPerQuestion: 2.5,
  /** Fração máxima da capacidade diária reservada para questões do dia. */
  maxDailyQuestionsShare: 0.4,
  /** Minutos-base de uma revisão (multiplicados pelo tamanho do assunto). */
  reviewMinutes: 15,
  minBlockMinutes: 15,
  /** Reta final: fração do período reservada só para revisões (limitada). */
  finalPhaseShare: 0.1,
  finalPhaseMaxDays: 14,
  finalPhaseMinSpanDays: 21,
  /** Tamanho do assunto: sqrt(% / mediana), limitado a este intervalo. */
  sizeFactorMin: 0.6,
  sizeFactorMax: 1.8,
} as const;
