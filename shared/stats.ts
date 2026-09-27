/**
 * Análise histórica de uma prova - calculada EXCLUSIVAMENTE a partir das
 * questões cadastradas no banco.
 *
 * Métricas (seção 18) - não confundir:
 *  - questions         → nº absoluto de questões sobre o assunto ("apareceu 8 vezes")
 *  - percentage        → fração da prova ("representa 8% da prova")
 *  - editionsPresent   → em quantas edições apareceu
 *  - presenceRate      → editionsPresent / editionsAnalyzed
 *  - annualAverage     → questões por edição
 *  - recentPercentage  → fração nas edições mais recentes
 *
 * Troca de banca: quando a banca da próxima prova (edição mais recente) é a
 * de só parte das provas anteriores, as provas da banca atual pesam 1 e as
 * da banca anterior pesam PRIORITY.previousBoardWeight nas frações acima, e
 * cada assunto ganha um nível (`tier`) que vem antes de tudo na ordem:
 *   1 caiu na banca atual e em boa parte das provas antigas (núcleo confirmado)
 *   2 caiu na banca atual (assinatura da banca nova)
 *   3 caiu em quase todas as provas antigas, mas não na banca atual
 *   4 o resto
 */
import { DATA_SUFFICIENCY, PRIORITY } from './config';

export interface EditionInput {
  id: string;
  year: number;
  /** Questões cadastradas (ativas) na edição, classificadas ou não. */
  questionCount: number;
  /** Banca da edição (null = não informada). */
  board?: string | null;
}

export interface LinkInput {
  questionId: string;
  editionId: string;
  /** Assunto já resolvido para a unidade do planner (assunto de nível superior). */
  subjectId: string;
  /** relevance_weight bruto; é normalizado para somar 1 por questão. */
  weight: number;
}

export interface SubjectYearCount {
  year: number;
  questions: number;
}

export interface SubjectHistStats {
  subjectId: string;
  questions: number;
  weighted: number;
  percentage: number;
  editionsPresent: number;
  editionsAnalyzed: number;
  presenceRate: number;
  /**
   * Regularidade: presença contada a partir da primeira edição em que o assunto
   * apareceu (mínimo das últimas `regularityMinSpan` edições). Tema que caiu
   * em todas desde que surgiu (ex.: 2023–2026, ou um bloco novo 2024–2026)
   * vale o mesmo que um que caiu em todas desde a primeira edição.
   */
  regularity: number;
  /** Fração da prova nas edições desde a primeira aparição (mesmo período). */
  activePercentage: number;
  annualAverage: number;
  recentPercentage: number;
  lastYear: number | null;
  byYear: SubjectYearCount[];
  /** Nível pela troca de banca (1 a 4; 0 = prova sem troca de banca). */
  tier: number;
  /** Só com troca de banca: presença na banca atual e na anterior. */
  board?: { currentQuestions: number; currentEditions: number; previousEditions: number };
}

export interface BoardChange {
  board: string;
  currentYears: number[];
  previousYears: number[];
}

export type Sufficiency = 'none' | 'insufficient' | 'limited' | 'good';

export interface ExamHistStats {
  editionsAnalyzed: number;
  years: number[];
  totalQuestions: number;
  classifiedQuestions: number;
  averageQuestionsPerEdition: number;
  sufficiency: Sufficiency;
  subjects: SubjectHistStats[];
  boardChange: BoardChange | null;
}

export function sufficiencyOf(editions: number): Sufficiency {
  if (editions === 0) return 'none';
  if (editions < DATA_SUFFICIENCY.minEditionsReliable) return 'insufficient';
  if (editions < DATA_SUFFICIENCY.goodEditions) return 'limited';
  return 'good';
}

export function sufficiencyMessage(editions: number): string {
  const s = sufficiencyOf(editions);
  if (s === 'none') return 'Nenhuma edição com questões classificadas cadastrada.';
  if (s === 'insufficient') return 'Dados insuficientes para uma análise histórica confiável.';
  return `Análise baseada em ${editions} ${editions === 1 ? 'edição cadastrada' : 'edições cadastradas'}.`;
}

export function computeExamStats(
  editions: EditionInput[],
  links: LinkInput[],
  opts: { recentEditions?: number } = {},
): ExamHistStats {
  const recentN = opts.recentEditions ?? PRIORITY.recentEditions;

  // Normaliza pesos por questão
  const weightSum = new Map<string, number>();
  for (const l of links) weightSum.set(l.questionId, (weightSum.get(l.questionId) ?? 0) + l.weight);

  const classifiedByEdition = new Map<string, Set<string>>();
  for (const l of links) {
    if (!classifiedByEdition.has(l.editionId)) classifiedByEdition.set(l.editionId, new Set());
    classifiedByEdition.get(l.editionId)!.add(l.questionId);
  }

  // Edições analisadas = edições com pelo menos uma questão classificada
  const analyzed = editions
    .filter((e) => (classifiedByEdition.get(e.id)?.size ?? 0) > 0)
    .sort((a, b) => a.year - b.year);
  const analyzedIds = new Set(analyzed.map((e) => e.id));
  const yearOf = new Map(analyzed.map((e) => [e.id, e.year]));
  const totalQuestions = analyzed.reduce((s, e) => s + e.questionCount, 0);
  const recent = analyzed.slice(-recentN);
  const recentIds = new Set(recent.map((e) => e.id));

  // Troca de banca: a banca da próxima prova é a da edição mais recente
  const board = [...editions].sort((a, b) => a.year - b.year).at(-1)?.board ?? null;
  const current = new Set(analyzed.filter((e) => board && e.board === board).map((e) => e.id));
  const change = current.size > 0 && current.size < analyzed.length;
  const ew = (id: string) => (!change || current.has(id) ? 1 : PRIORITY.previousBoardWeight);
  const sumW = (eds: EditionInput[]) => eds.reduce((s, e) => s + ew(e.id) * e.questionCount, 0);
  const weightedTotal = sumW(analyzed);
  const recentTotal = sumW(recent);
  const editionsWeight = analyzed.reduce((s, e) => s + ew(e.id), 0);
  const previousN = analyzed.length - current.size;

  type Acc = { weighted: number; bw: number; recent: number; qs: Set<string>; eds: Set<string>; byYear: Map<number, Set<string>> };
  const acc = new Map<string, Acc>();
  for (const l of links) {
    if (!analyzedIds.has(l.editionId)) continue;
    const w = l.weight / (weightSum.get(l.questionId) || 1);
    let a = acc.get(l.subjectId);
    if (!a) {
      a = { weighted: 0, bw: 0, recent: 0, qs: new Set(), eds: new Set(), byYear: new Map() };
      acc.set(l.subjectId, a);
    }
    a.weighted += w;
    a.bw += w * ew(l.editionId);
    if (recentIds.has(l.editionId)) a.recent += w * ew(l.editionId);
    a.qs.add(l.questionId);
    a.eds.add(l.editionId);
    const y = yearOf.get(l.editionId)!;
    if (!a.byYear.has(y)) a.byYear.set(y, new Set());
    a.byYear.get(y)!.add(l.questionId);
  }

  const n = analyzed.length;
  const minSpan = Math.min(n, PRIORITY.regularityMinSpan);
  const subjects: SubjectHistStats[] = [...acc.entries()].map(([subjectId, a]) => {
    const years = [...a.byYear.keys()].sort();
    const firstIdx = analyzed.findIndex((e) => a.eds.has(e.id));
    // Com troca de banca a regularidade olha todas as provas, cada uma com o seu peso
    const spanEds = change ? analyzed : analyzed.slice(n - Math.max(minSpan, n - firstIdx));
    const spanTotal = sumW(spanEds);
    const spanWeight = spanEds.reduce((s, e) => s + ew(e.id), 0);
    const presentWeight = spanEds.filter((e) => a.eds.has(e.id)).reduce((s, e) => s + ew(e.id), 0);
    const byYear = analyzed.map((e) => ({ year: e.year, questions: a.byYear.get(e.year)?.size ?? 0 }));
    let tier = 0;
    let boardInfo: SubjectHistStats['board'];
    if (change) {
      const cur = analyzed.filter((e) => current.has(e.id));
      const currentQuestions = cur.reduce((s, e) => s + (a.byYear.get(e.year)?.size ?? 0), 0);
      const currentEditions = cur.filter((e) => a.eds.has(e.id)).length;
      const previousEditions = a.eds.size - currentEditions;
      tier = currentEditions && previousEditions >= Math.max(1, Math.ceil(previousN * 0.6)) ? 1
        : currentEditions ? 2
        : previousEditions >= Math.max(1, Math.ceil(previousN * 0.8)) ? 3 : 4;
      boardInfo = { currentQuestions, currentEditions, previousEditions };
    }
    return {
      subjectId,
      questions: a.qs.size,
      weighted: round(a.weighted, 3),
      percentage: weightedTotal ? a.bw / weightedTotal : 0,
      editionsPresent: a.eds.size,
      editionsAnalyzed: n,
      presenceRate: n ? a.eds.size / n : 0,
      regularity: spanWeight ? presentWeight / spanWeight : 0,
      activePercentage: spanTotal ? a.bw / spanTotal : 0,
      annualAverage: editionsWeight ? a.bw / editionsWeight : 0,
      recentPercentage: recentTotal ? a.recent / recentTotal : 0,
      lastYear: years.length ? years[years.length - 1] : null,
      byYear,
      tier,
      ...(boardInfo ? { board: boardInfo } : {}),
    };
  });
  subjects.sort(compareHistorical);

  const classified = new Set(links.filter((l) => analyzedIds.has(l.editionId)).map((l) => l.questionId)).size;
  return {
    editionsAnalyzed: n,
    years: analyzed.map((e) => e.year),
    totalQuestions,
    classifiedQuestions: classified,
    averageQuestionsPerEdition: n ? totalQuestions / n : 0,
    sufficiency: sufficiencyOf(n),
    subjects,
    boardChange: change
      ? { board: board!, currentYears: analyzed.filter((e) => current.has(e.id)).map((e) => e.year), previousYears: analyzed.filter((e) => !current.has(e.id)).map((e) => e.year) }
      : null,
  };
}

type Comparable = { percentage: number; activePercentage: number; regularity: number; recentPercentage: number; subjectId: string; tier?: number };
/**
 * Ordem histórica: regularidade (desde a 1ª aparição) → quantidade no mesmo período → recência.
 * Com troca de banca: nível → quantidade (com as provas da banca atual pesando mais) → regularidade.
 */
export function compareHistorical(a: Comparable, b: Comparable): number {
  // O nível já diz a presença em cada banca; dentro dele vale a quantidade
  const regular = a.tier ? 0 : Math.round((b.regularity - a.regularity) * 1e6);
  return (
    (a.tier ?? 0) - (b.tier ?? 0) ||
    regular ||
    b.activePercentage - a.activePercentage ||
    b.percentage - a.percentage ||
    b.regularity - a.regularity ||
    b.recentPercentage - a.recentPercentage ||
    a.subjectId.localeCompare(b.subjectId)
  );
}

export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
