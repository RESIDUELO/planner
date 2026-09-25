/**
 * Área administrativa. Cada rota exige ADMIN (primeira barreira); o banco
 * também recusa escrita de não-administradores via RLS (segunda barreira).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx, many, one, type Db } from '../db';
import { requireAdmin } from '../auth';
import { badRequest, notFound } from '../errors';
import { loadExamHistories, loadSubjectsInfo } from '../services/history';
import { commitImport, parseFile, previewImport, slugify, type Resolution } from '../services/importer';
import { sufficiencyMessage, computeExamStats } from '../../shared/stats';
import { levelForRank, LEVEL_LABEL } from '../../shared/priority';
import { MASTERY, MEMORY, PRIORITY, SCHEDULER } from '../../shared/config';

const uuid = z.string().uuid();
const optText = (max = 2000) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v ?? null));
const optUrl = z.string().trim().max(1000).nullable().optional()
  .transform((v) => (v === '' ? null : v ?? null))
  .refine((v) => v == null || /^https?:\/\//i.test(v), 'URL deve começar com http:// ou https://');
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null));
const optInt = z.number().int().nonnegative().nullable().optional();

async function insertRow(db: Db, table: string, data: Record<string, unknown>) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const sql = `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  return one(db, sql, keys.map((k) => data[k]));
}

async function updateRow(db: Db, table: string, id: string, data: Record<string, unknown>) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return one(db, `select * from public.${table} where id = $1`, [id]);
  const sql = `update public.${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`;
  const row = await one(db, sql, [id, ...keys.map((k) => data[k])]);
  if (!row) throw notFound();
  return row;
}

async function uniqueSlug(db: Db, table: 'subjects' | 'medical_areas', name: string, exceptId?: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await one(db, `select 1 from public.${table} where slug = $1 and id is distinct from $2`, [slug, exceptId ?? null]); i++) slug = `${base}-${i}`;
  return slug;
}

const institutionSchema = z.object({
  name: z.string().trim().min(2).max(200),
  abbreviation: z.string().trim().min(2).max(40),
  state: z.string().trim().length(2).toUpperCase().nullable().optional().or(z.literal('').transform(() => null)),
  city: optText(120),
  website: optUrl,
  logo_url: optUrl,
  active: z.boolean().optional(),
});
const boardSchema = z.object({
  name: z.string().trim().min(2).max(200),
  abbreviation: z.string().trim().min(2).max(40),
  website: optUrl,
  active: z.boolean().optional(),
});
const examSchema = z.object({
  institution_id: uuid,
  board_id: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(200),
  description: optText(),
  total_questions: z.number().int().positive().nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  official_url: optUrl,
  active: z.boolean().optional(),
});
const editionSchema = z.object({
  exam_id: uuid,
  year: z.number().int().min(1990).max(2100),
  exam_date: optDate,
  registration_start: optDate,
  registration_end: optDate,
  registration_fee: z.number().nonnegative().max(100000).nullable().optional(),
  number_of_vacancies: optInt,
  total_questions: z.number().int().positive().nullable().optional(),
  edital_url: optUrl,
  answer_key_url: optUrl,
  result_url: optUrl,
  source_name: optText(300),
  source_url: optUrl,
  source_checked_at: optDate,
  notes: optText(),
});
const areaSchema = z.object({
  parent_id: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(200),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
const subjectSchema = z.object({
  medical_area_id: uuid,
  parent_subject_id: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(300),
  description: optText(),
  active: z.boolean().optional(),
});
const questionSchema = z.object({
  exam_edition_id: uuid,
  question_number: z.number().int().positive(),
  statement: optText(20000),
  summary: optText(2000),
  alternative_a: optText(5000),
  alternative_b: optText(5000),
  alternative_c: optText(5000),
  alternative_d: optText(5000),
  alternative_e: optText(5000),
  correct_answer: z.enum(['A', 'B', 'C', 'D', 'E']).nullable().optional(),
  annulled: z.boolean().optional(),
  explanation: optText(20000),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
  question_type: optText(200),
  guideline: optText(300),
  source: optText(500),
  notes: optText(),
  active: z.boolean().optional(),
});

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/admin')) requireAdmin(req);
  });
  const run = <T>(req: any, fn: (db: Db) => Promise<T>) => tx(req.sessionHash, fn);

  // --------------------------------------------------------------- Dashboard
  app.get('/api/admin/dashboard', async (req) => run(req, async (db) => {
    const c = await one(db, `select
        (select count(*) from public.institutions)::int as institutions,
        (select count(*) from public.examining_boards)::int as boards,
        (select count(*) from public.exams)::int as exams,
        (select count(*) from public.exam_editions)::int as editions,
        (select count(*) from public.exam_editions where status = 'published')::int as published_editions,
        (select count(*) from public.exam_editions where status = 'draft')::int as draft_editions,
        (select count(*) from public.questions where active)::int as questions,
        (select count(*) from public.questions q where active and not exists (select 1 from public.question_subjects qs where qs.question_id = q.id))::int as unclassified_questions,
        (select count(*) from public.subjects where active)::int as subjects,
        (select count(*) from public.subjects where active and parent_subject_id is null)::int as root_subjects,
        (select count(*) from public.user_profiles)::int as users,
        (select count(*) from public.user_profiles where role = 'visitor')::int as visitors`);
    const recent = await many(db, `select * from public.admin_audit_logs order by changed_at desc limit 8`);
    return { counts: c, recent };
  }));

  // ------------------------------------------------------------ Instituições
  app.get('/api/admin/institutions', async (req) => run(req, (db) => many(db, `
    select i.*, (select count(*) from public.exams e where e.institution_id = i.id)::int as exams
      from public.institutions i order by i.abbreviation`)));
  app.post('/api/admin/institutions', async (req) => run(req, (db) => insertRow(db, 'institutions', institutionSchema.parse(req.body))));
  app.put('/api/admin/institutions/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return run(req, (db) => updateRow(db, 'institutions', id, institutionSchema.partial().parse(req.body)));
  });

  // ------------------------------------------------------------------ Bancas
  app.get('/api/admin/boards', async (req) => run(req, (db) => many(db, `select * from public.examining_boards order by abbreviation`)));
  app.post('/api/admin/boards', async (req) => run(req, (db) => insertRow(db, 'examining_boards', boardSchema.parse(req.body))));
  app.put('/api/admin/boards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return run(req, (db) => updateRow(db, 'examining_boards', id, boardSchema.partial().parse(req.body)));
  });

  // ------------------------------------------------------------------ Provas
  app.get('/api/admin/exams', async (req) => run(req, (db) => many(db, `
    select e.*, i.abbreviation as institution, i.name as institution_name, b.abbreviation as board,
           (select count(*) from public.exam_editions ed where ed.exam_id = e.id)::int as editions,
           (select count(*) from public.exam_editions ed where ed.exam_id = e.id and ed.status = 'published')::int as published_editions,
           (select count(*) from public.questions q join public.exam_editions ed on ed.id = q.exam_edition_id where ed.exam_id = e.id and q.active)::int as questions
      from public.exams e join public.institutions i on i.id = e.institution_id
      left join public.examining_boards b on b.id = e.board_id
     order by i.abbreviation, e.name`)));
  app.post('/api/admin/exams', async (req) => run(req, (db) => insertRow(db, 'exams', examSchema.parse(req.body))));
  app.put('/api/admin/exams/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return run(req, (db) => updateRow(db, 'exams', id, examSchema.partial().parse(req.body)));
  });

  // ----------------------------------------------------------------- Edições
  app.get('/api/admin/editions', async (req) => {
    const q = z.object({ examId: uuid.optional() }).parse(req.query);
    return run(req, (db) => many(db, `
      select ed.*, e.name as exam_name, i.abbreviation as institution,
             (select count(*) from public.questions q where q.exam_edition_id = ed.id and q.active)::int as questions,
             (select count(*) from public.questions q where q.exam_edition_id = ed.id and q.active
                and exists (select 1 from public.question_subjects qs where qs.question_id = q.id))::int as classified,
             p.name as registered_by_name
        from public.exam_editions ed join public.exams e on e.id = ed.exam_id
        join public.institutions i on i.id = e.institution_id
        left join public.user_profiles p on p.user_id = ed.registered_by
       where ($1::uuid is null or ed.exam_id = $1)
       order by i.abbreviation, e.name, ed.year desc`, [q.examId ?? null]));
  });
  app.get('/api/admin/editions/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return run(req, async (db) => {
      const ed = await one(db, `
        select ed.*, e.name as exam_name, e.total_questions as exam_total_questions, i.abbreviation as institution,
               b.abbreviation as board, p.name as registered_by_name
          from public.exam_editions ed join public.exams e on e.id = ed.exam_id
          join public.institutions i on i.id = e.institution_id
          left join public.examining_boards b on b.id = e.board_id
          left join public.user_profiles p on p.user_id = ed.registered_by
         where ed.id = $1`, [id]);
      if (!ed) throw notFound('Edição');
      const counts = await one(db, `
        select count(*)::int as questions,
               count(*) filter (where annulled)::int as annulled,
               count(*) filter (where exists (select 1 from public.question_subjects qs where qs.question_id = q.id))::int as classified,
               count(*) filter (where statement is not null)::int as with_statement
          from public.questions q where q.exam_edition_id = $1 and q.active`, [id]);
      const expected = ed.total_questions ?? ed.exam_total_questions;
      const checks = [
        { key: 'date', ok: !!ed.exam_date, label: 'Data da prova cadastrada', required: false },
        { key: 'registration', ok: !!(ed.registration_start || ed.registration_end), label: 'Período de inscrição cadastrado', required: false },
        { key: 'fee', ok: ed.registration_fee != null, label: 'Valor da inscrição cadastrado', required: false },
        { key: 'source', ok: !!(ed.source_name || ed.source_url), label: 'Fonte dos dados informada', required: false },
        { key: 'questions', ok: counts!.questions > 0, label: 'Questões cadastradas (para análise histórica)', required: false },
        { key: 'total', ok: !expected || counts!.questions === 0 || counts!.questions === expected, label: `Nº de questões confere com o total previsto${expected ? ` (${expected})` : ''}`, required: false },
        { key: 'classified', ok: counts!.questions === 0 || counts!.classified === counts!.questions, label: 'Todas as questões classificadas', required: false },
      ];
      return { edition: ed, counts, checks };
    });
  });
  app.post('/api/admin/editions', async (req) => run(req, async (db) => {
    const data = editionSchema.parse(req.body);
    return insertRow(db, 'exam_editions', { ...data, status: 'draft', registered_by: req.user!.id });
  }));
  app.put('/api/admin/editions/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const data = editionSchema.partial().omit({ exam_id: true }).parse(req.body);
    return run(req, (db) => updateRow(db, 'exam_editions', id, data));
  });
  app.post('/api/admin/editions/:id/status', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { status } = z.object({ status: z.enum(['draft', 'published', 'archived']) }).parse(req.body);
    return run(req, (db) => updateRow(db, 'exam_editions', id, {
      status,
      published_at: status === 'published' ? new Date().toISOString() : undefined,
    }));
  });

  // ---------------------------------------------------------- Áreas e assuntos
  app.get('/api/admin/areas', async (req) => run(req, (db) => many(db, `
    select a.*, (select count(*) from public.subjects s where s.medical_area_id = a.id)::int as subjects
      from public.medical_areas a order by a.sort_order, a.name`)));
  app.post('/api/admin/areas', async (req) => run(req, async (db) => {
    const d = areaSchema.parse(req.body);
    if (d.parent_id) {
      const p = await one(db, `select parent_id from public.medical_areas where id = $1`, [d.parent_id]);
      if (!p) throw badRequest('Área-mãe inexistente.');
      if (p.parent_id) throw badRequest('Use no máximo dois níveis: grande área → especialidade.');
    }
    return insertRow(db, 'medical_areas', { ...d, slug: await uniqueSlug(db, 'medical_areas', d.name) });
  }));
  app.put('/api/admin/areas/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const d = areaSchema.partial().parse(req.body);
    return run(req, async (db) => updateRow(db, 'medical_areas', id, { ...d, slug: d.name ? await uniqueSlug(db, 'medical_areas', d.name, id) : undefined }));
  });

  app.get('/api/admin/subjects', async (req) => run(req, (db) => many(db, `
    select s.*, a.name as area_name, pa.name as parent_area_name, ps.name as parent_name,
           (select count(distinct qs.question_id) from public.question_subjects qs where qs.subject_id = s.id)::int as questions,
           (select coalesce(json_agg(al.alias order by al.alias), '[]') from public.subject_aliases al where al.subject_id = s.id) as aliases
      from public.subjects s
      join public.medical_areas a on a.id = s.medical_area_id
      left join public.medical_areas pa on pa.id = a.parent_id
      left join public.subjects ps on ps.id = s.parent_subject_id
     order by coalesce(pa.name, a.name), s.name`)));
  app.post('/api/admin/subjects', async (req) => run(req, async (db) => {
    const d = subjectSchema.parse(req.body);
    return insertRow(db, 'subjects', { ...d, slug: await uniqueSlug(db, 'subjects', d.name) });
  }));
  app.put('/api/admin/subjects/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const d = subjectSchema.partial().parse(req.body);
    return run(req, async (db) => {
      if (d.parent_subject_id) {
        // Evita ciclos na hierarquia
        const cyc = await one(db, `with recursive up as (select id, parent_subject_id from public.subjects where id = $1
                                    union all select s.id, s.parent_subject_id from public.subjects s join up on s.id = up.parent_subject_id)
                                   select 1 from up where id = $2`, [d.parent_subject_id, id]);
        if (cyc) throw badRequest('Hierarquia inválida: o assunto não pode ser pai de si mesmo.');
      }
      return updateRow(db, 'subjects', id, { ...d, slug: d.name ? await uniqueSlug(db, 'subjects', d.name, id) : undefined });
    });
  });
  /** Mescla um assunto em outro (reclassifica questões e cria alias). O original é desativado, não apagado. */
  app.post('/api/admin/subjects/:id/merge', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { targetId } = z.object({ targetId: uuid }).parse(req.body);
    if (id === targetId) throw badRequest('Escolha outro assunto.');
    return run(req, async (db) => {
      const src = await one(db, `select * from public.subjects where id = $1`, [id]);
      if (!src) throw notFound('Assunto');
      await db.query(`update public.subjects set parent_subject_id = $2 where parent_subject_id = $1`, [id, targetId]);
      await db.query(`update public.question_subjects qs set subject_id = $2 where subject_id = $1
                        and not exists (select 1 from public.question_subjects x where x.question_id = qs.question_id and x.subject_id = $2)`, [id, targetId]);
      await db.query(`delete from public.question_subjects where subject_id = $1`, [id]);
      await db.query(`update public.subject_aliases set subject_id = $2 where subject_id = $1`, [id, targetId]);
      await db.query(`insert into public.subject_aliases(subject_id, alias) values ($1, $2) on conflict (alias) do nothing`, [targetId, src.name]);
      await db.query(`update public.subjects set active = false where id = $1`, [id]);
      return { ok: true };
    });
  });
  app.post('/api/admin/subjects/:id/aliases', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { alias } = z.object({ alias: z.string().trim().min(2).max(300) }).parse(req.body);
    return run(req, (db) => insertRow(db, 'subject_aliases', { subject_id: id, alias }));
  });
  app.delete('/api/admin/subjects/:id/aliases/:alias', async (req) => {
    const { id, alias } = z.object({ id: uuid, alias: z.string() }).parse(req.params);
    return run(req, async (db) => {
      await db.query(`delete from public.subject_aliases where subject_id = $1 and alias = $2`, [id, alias]);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- Questões
  app.get('/api/admin/editions/:id/questions', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return run(req, (db) => many(db, `
      select q.*,
             coalesce((select json_agg(json_build_object('subject_id', s.id, 'name', s.name, 'parent', ps.name,
                        'weight', qs.relevance_weight, 'is_primary', qs.is_primary) order by qs.is_primary desc)
                 from public.question_subjects qs join public.subjects s on s.id = qs.subject_id
                 left join public.subjects ps on ps.id = s.parent_subject_id
                where qs.question_id = q.id), '[]') as subjects
        from public.questions q where q.exam_edition_id = $1 order by q.question_number`, [id]));
  });
  app.post('/api/admin/questions', async (req) => run(req, async (db) => {
    const d = questionSchema.parse(req.body);
    if (!d.annulled && !d.correct_answer) throw badRequest('Informe o gabarito ou marque a questão como anulada.');
    if (!d.statement && !d.summary) throw badRequest('Informe o enunciado ou o resumo do que a questão cobra.');
    return insertRow(db, 'questions', d);
  }));
  app.put('/api/admin/questions/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const d = questionSchema.partial().omit({ exam_edition_id: true }).parse(req.body);
    return run(req, (db) => updateRow(db, 'questions', id, d));
  });
  /** Classificação: substitui os assuntos da questão. */
  app.put('/api/admin/questions/:id/subjects', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const links = z.array(z.object({
      subjectId: uuid, weight: z.number().gt(0).max(1).default(1), isPrimary: z.boolean().default(false),
    })).max(5).parse(req.body);
    if (links.length && links.filter((l) => l.isPrimary).length !== 1) throw badRequest('Marque exatamente um assunto principal.');
    if (new Set(links.map((l) => l.subjectId)).size !== links.length) throw badRequest('Assunto repetido.');
    return run(req, async (db) => {
      const q = await one(db, `select id from public.questions where id = $1`, [id]);
      if (!q) throw notFound('Questão');
      const current = await many<{ subject_id: string }>(db, `select subject_id from public.question_subjects where question_id = $1`, [id]);
      const keep = new Set(links.map((l) => l.subjectId));
      for (const c of current) if (!keep.has(c.subject_id)) await db.query(`delete from public.question_subjects where question_id = $1 and subject_id = $2`, [id, c.subject_id]);
      await db.query(`update public.question_subjects set is_primary = false where question_id = $1`, [id]);
      for (const l of links) {
        await db.query(`insert into public.question_subjects(question_id, subject_id, relevance_weight, is_primary) values ($1, $2, $3, $4)
                        on conflict (question_id, subject_id) do update set relevance_weight = excluded.relevance_weight, is_primary = excluded.is_primary`,
          [id, l.subjectId, l.weight, l.isPrimary]);
      }
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- Estatísticas
  app.get('/api/admin/exams/:id/stats', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ includeDrafts: z.enum(['true', 'false']).optional(), level: z.enum(['subject', 'leaf']).optional() }).parse(req.query);
    const includeDrafts = q.includeDrafts !== 'false';
    return run(req, async (db) => {
      const exam = await one(db, `select e.*, i.abbreviation as institution from public.exams e join public.institutions i on i.id = e.institution_id where e.id = $1`, [id]);
      if (!exam) throw notFound('Prova');
      const hist = (await loadExamHistories(db, [id], includeDrafts)).get(id)!;
      let stats = hist.stats;
      if (q.level === 'leaf') {
        // Estatística por subassunto (classificação mais específica)
        const status = includeDrafts ? `ed.status <> 'archived'` : `ed.status = 'published'`;
        const links = await many(db, `select q.id as question_id, q.exam_edition_id as edition_id, qs.subject_id, qs.relevance_weight as weight
            from public.questions q join public.exam_editions ed on ed.id = q.exam_edition_id
            join public.question_subjects qs on qs.question_id = q.id where ed.exam_id = $1 and q.active and ${status}`, [id]);
        stats = computeExamStats(hist.editions.map((e) => ({ id: e.id, year: e.year, questionCount: e.questionCount })),
          links.map((l: any) => ({ questionId: l.question_id, editionId: l.edition_id, subjectId: l.subject_id, weight: l.weight })));
      }
      const info = await loadSubjectsInfo(db, stats.subjects.map((s) => s.subjectId));
      return {
        exam,
        editions: hist.editions,
        includeDrafts,
        message: sufficiencyMessage(stats.editionsAnalyzed),
        ...stats,
        subjects: stats.subjects.map((s, i) => ({
          ...s, rank: i + 1, name: info.get(s.subjectId)?.name, area: info.get(s.subjectId)?.area,
          level: LEVEL_LABEL[levelForRank(i + 1, stats.subjects.length)],
        })),
      };
    });
  });

  // --------------------------------------------------------------- Importação
  const importBody = z.object({
    examId: uuid,
    filename: z.string().min(1).max(300),
    content: z.string().min(1),
    resolutions: z.record(z.string(), z.union([
      z.object({ action: z.literal('map'), id: uuid }),
      z.object({ action: z.literal('create') }),
      z.object({ action: z.literal('ignore') }),
    ])).optional(),
    source: optText(500),
  });
  app.post('/api/admin/import/preview', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = importBody.parse(req.body);
    const file = await parseFile(b.filename, b.content);
    return run(req, (db) => previewImport(db, b.examId, file));
  });
  app.post('/api/admin/import/commit', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = importBody.parse(req.body);
    if (!b.resolutions) throw badRequest('Confirmação ausente.');
    const file = await parseFile(b.filename, b.content);
    return run(req, (db) => commitImport(db, req.user!.id, b.examId, b.filename, file, b.resolutions as Record<string, Resolution>, b.source ?? null));
  });
  app.get('/api/admin/import/batches', async (req) => run(req, (db) => many(db, `
    select b.*, e.name as exam_name, i.abbreviation as institution, p.name as created_by_name
      from public.import_batches b join public.exams e on e.id = b.exam_id join public.institutions i on i.id = e.institution_id
      left join public.user_profiles p on p.user_id = b.created_by order by b.created_at desc limit 50`)));

  // ------------------------------------------------------------------ Usuários
  app.get('/api/admin/users', async (req) => run(req, (db) => many(db, `
    select p.user_id, p.name, p.role, p.active, p.created_at, u.email, u.is_guest, u.last_login_at,
           (select count(*) from public.study_plans sp where sp.user_id = p.user_id)::int as plans
      from public.user_profiles p join auth.admin_user_emails() u on u.user_id = p.user_id
     order by p.created_at desc`)));
  app.put('/api/admin/users/:userId', async (req) => {
    const { userId } = z.object({ userId: uuid }).parse(req.params);
    const d = z.object({ role: z.enum(['admin', 'user']).optional(), active: z.boolean().optional() }).parse(req.body);
    return run(req, async (db) => {
      const target = await one(db, `select role from public.user_profiles where user_id = $1`, [userId]);
      if (!target) throw notFound('Usuário');
      if (target.role === 'visitor' && d.role) throw badRequest('Visitantes precisam criar conta antes de mudar de papel.');
      const keys = Object.entries(d).filter(([, v]) => v !== undefined);
      if (!keys.length) return { ok: true };
      await db.query(`update public.user_profiles set ${keys.map(([k], i) => `${k} = $${i + 2}`).join(', ')} where user_id = $1`,
        [userId, ...keys.map(([, v]) => v)]);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------------- Logs
  app.get('/api/admin/logs', async (req) => {
    const q = z.object({ entity: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    return run(req, async (db) => {
      const rows = await many(db, `select * from public.admin_audit_logs where ($1::text is null or entity = $1)
                                    order by changed_at desc, id desc limit 50 offset $2`, [q.entity ?? null, (q.page - 1) * 50]);
      const total = await one(db, `select count(*)::int as n from public.admin_audit_logs where ($1::text is null or entity = $1)`, [q.entity ?? null]);
      return { rows, total: total!.n, page: q.page, pageSize: 50 };
    });
  });

  // ---------------------------------------------------------- Configurações
  app.get('/api/admin/algorithms', async (req) => run(req, async (db) => ({
    versions: await many(db, `select * from public.algorithm_versions order by created_at`),
    parameters: { priority: PRIORITY, memory: MEMORY, scheduler: SCHEDULER, mastery: MASTERY },
  })));
}
