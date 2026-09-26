/** Dados da análise histórica - somente questões cadastradas no banco. */
import { computeExamStats, type ExamHistStats } from '../../../shared/stats';
import { rpc, type Ctx } from './core';

export interface ExamHistory {
  examId: string;
  stats: ExamHistStats;
  editions: { id: string; year: number; status: string; questionCount: number; classifiedCount: number }[];
  /** [questão, edição, prova, assunto raiz, peso, assunto classificado] */
  links: [string, string, string, string, number, string][];
}

export async function loadExamHistories(ctx: Ctx, examIds: string[], includeDrafts = false): Promise<Map<string, ExamHistory>> {
  const out = new Map<string, ExamHistory>();
  if (!examIds.length) return out;
  const data = await rpc<{ editions: any[]; links: any[] }>(ctx, 'exam_history_data', { p_exam_ids: examIds, p_include_drafts: includeDrafts });
  for (const examId of examIds) {
    const eds = data.editions.filter((e) => e.exam_id === examId);
    const ls = data.links.filter((l) => l[2] === examId);
    const stats = computeExamStats(
      eds.map((e) => ({ id: e.id, year: e.year, questionCount: e.question_count })),
      ls.map((l) => ({ questionId: l[0], editionId: l[1], subjectId: l[3], weight: Number(l[4]) })),
    );
    out.set(examId, {
      examId,
      stats,
      links: ls,
      editions: eds.map((e) => ({ id: e.id, year: e.year, status: e.status, questionCount: e.question_count, classifiedCount: e.classified_count })),
    });
  }
  return out;
}

export interface SubjectInfo { id: string; name: string; area: string; area_id: string; specialty: string | null }

export async function loadSubjectsInfo(ctx: Ctx, ids: string[]): Promise<Map<string, SubjectInfo>> {
  if (!ids.length) return new Map();
  const rows = await rpc<SubjectInfo[]>(ctx, 'subjects_info', { p_ids: ids });
  return new Map(rows.map((r) => [r.id, r]));
}
