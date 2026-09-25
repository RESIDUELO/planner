/**
 * Carrega do banco os dados necessários à análise histórica.
 * Somente questões cadastradas contam; nada vem de fontes externas.
 */
import { many, type Db } from '../db';
import { computeExamStats, type ExamHistStats } from '../../shared/stats';

/** Mapeia cada assunto para a unidade do planner (assunto raiz, sem pai). */
export const SUBJECT_ROOTS_CTE = `
  subject_roots as (
    with recursive tree as (
      select id, id as root from public.subjects where parent_subject_id is null
      union all
      select s.id, t.root from public.subjects s join tree t on s.parent_subject_id = t.id
    ) select id, root from tree
  )`;

export interface ExamHistory {
  examId: string;
  stats: ExamHistStats;
  editions: { id: string; year: number; status: string; questionCount: number; classifiedCount: number }[];
}

/**
 * @param includeDrafts somente para a área administrativa; o planner do
 *   usuário sempre usa apenas edições publicadas.
 */
export async function loadExamHistories(db: Db, examIds: string[], includeDrafts = false): Promise<Map<string, ExamHistory>> {
  const out = new Map<string, ExamHistory>();
  if (!examIds.length) return out;
  const statusFilter = includeDrafts ? `ed.status <> 'archived'` : `ed.status = 'published'`;

  const editions = await many<{ id: string; exam_id: string; year: number; status: string; question_count: number; classified_count: number }>(
    db,
    `select ed.id, ed.exam_id, ed.year, ed.status,
            count(q.id) filter (where q.active) as question_count,
            count(q.id) filter (where q.active and exists (select 1 from public.question_subjects qs where qs.question_id = q.id)) as classified_count
       from public.exam_editions ed
       left join public.questions q on q.exam_edition_id = ed.id
      where ed.exam_id = any($1) and ${statusFilter}
      group by ed.id
      order by ed.year`,
    [examIds],
  );

  const links = await many<{ question_id: string; edition_id: string; exam_id: string; subject_id: string; weight: number }>(
    db,
    `with ${SUBJECT_ROOTS_CTE}
     select q.id as question_id, q.exam_edition_id as edition_id, ed.exam_id, r.root as subject_id, qs.relevance_weight as weight
       from public.questions q
       join public.exam_editions ed on ed.id = q.exam_edition_id
       join public.question_subjects qs on qs.question_id = q.id
       join subject_roots r on r.id = qs.subject_id
       join public.subjects s on s.id = r.root and s.active
      where ed.exam_id = any($1) and q.active and ${statusFilter}`,
    [examIds],
  );

  for (const examId of examIds) {
    const eds = editions.filter((e) => e.exam_id === examId);
    const ls = links.filter((l) => l.exam_id === examId);
    const stats = computeExamStats(
      eds.map((e) => ({ id: e.id, year: e.year, questionCount: e.question_count })),
      ls.map((l) => ({ questionId: l.question_id, editionId: l.edition_id, subjectId: l.subject_id, weight: l.weight })),
    );
    out.set(examId, {
      examId,
      stats,
      editions: eds.map((e) => ({ id: e.id, year: e.year, status: e.status, questionCount: e.question_count, classifiedCount: e.classified_count })),
    });
  }
  return out;
}

export async function loadSubjectsInfo(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; area: string; area_id: string; specialty: string | null }>();
  const rows = await many<{ id: string; name: string; area: string; area_id: string; specialty: string | null }>(
    db,
    `select s.id, s.name,
            coalesce(pa.name, a.name) as area, coalesce(pa.id, a.id) as area_id,
            case when a.parent_id is not null then a.name end as specialty
       from public.subjects s
       join public.medical_areas a on a.id = s.medical_area_id
       left join public.medical_areas pa on pa.id = a.parent_id
      where s.id = any($1)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
