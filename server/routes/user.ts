import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tx, many, one } from '../db';
import { requireUser } from '../auth';
import { badRequest, notFound } from '../errors';
import { todayISO, diffDays, type ISODate } from '../../shared/dates';
import { sufficiencyMessage } from '../../shared/stats';
import { loadExamHistories, loadSubjectsInfo } from '../services/history';
import {
  generatePlan, loadMethods, loadPlanState, loadProfile, logPractice, rateReview, replan, setMethodDone, studyWeekdays,
} from '../services/planner';
import { calendarView, dashboardView, performanceView, todayView } from '../services/agenda';
import { RATINGS, type Rating } from '../../shared/memory';
import { MASTERY, MEMORY, PRIORITY } from '../../shared/config';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

/** "Hoje" no fuso de Brasília. Em testes automatizados é possível simular outra data. */
export function today(req: FastifyRequest): ISODate {
  const h = req.headers['x-debug-today'];
  if (process.env.ALLOW_TIME_TRAVEL === 'true' && typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h)) return h;
  return todayISO();
}

export function registrationWindow(e: { registration_start: string | null; registration_end: string | null; exam_date: string | null }, t: ISODate) {
  if (e.exam_date && e.exam_date < t) return 'exam_done';
  if (!e.registration_start && !e.registration_end) return 'unknown';
  if (e.registration_start && t < e.registration_start) return 'upcoming';
  if (e.registration_end && t > e.registration_end) return 'closed';
  return 'open';
}

export default async function userRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ Provas
  app.get('/api/exams', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, async (db) => {
      const rows = await many(db, `
        select ed.id as edition_id, ed.year, ed.exam_date, ed.registration_start, ed.registration_end, ed.registration_fee,
               ed.number_of_vacancies, coalesce(ed.total_questions, e.total_questions) as total_questions, ed.edital_url,
               ed.answer_key_url, ed.result_url, ed.source_name, ed.source_url, ed.source_checked_at,
               e.id as exam_id, e.name as exam_name, e.description as exam_description, e.duration_minutes, e.official_url,
               i.id as institution_id, i.name as institution_name, i.abbreviation as institution, i.state, i.city, i.logo_url,
               b.name as board_name, b.abbreviation as board,
               ue.selected, ue.is_primary, r.status as registration_status, r.registration_number, r.notes as registration_notes
          from public.exam_editions ed
          join public.exams e on e.id = ed.exam_id and e.active
          join public.institutions i on i.id = e.institution_id
          left join public.examining_boards b on b.id = e.board_id
          left join public.user_exam_editions ue on ue.exam_edition_id = ed.id and ue.user_id = $1
          left join public.registrations r on r.exam_edition_id = ed.id and r.user_id = $1
         where ed.status = 'published'
         order by ed.exam_date nulls last, i.abbreviation, ed.year desc`, [u.id]);
      const hist = await loadExamHistories(db, [...new Set(rows.map((r: any) => r.exam_id))]);
      return rows.map((r: any) => {
        const h = hist.get(r.exam_id)!;
        return {
          ...r,
          selected: !!r.selected,
          is_primary: !!r.is_primary,
          days_left: r.exam_date ? diffDays(r.exam_date, t) : null,
          registration_window: registrationWindow(r, t),
          history: {
            editionsAnalyzed: h.stats.editionsAnalyzed,
            years: h.stats.years,
            questions: h.stats.totalQuestions,
            classified: h.stats.classifiedQuestions,
            sufficiency: h.stats.sufficiency,
            message: sufficiencyMessage(h.stats.editionsAnalyzed),
          },
        };
      });
    });
  });

  app.put('/api/me/editions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      selected: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
      status: z.enum(['not_interested', 'want_to', 'pending', 'registered', 'closed', 'taken']).nullable().optional(),
      registrationNumber: z.string().max(100).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).parse(req.body);
    return tx(req.sessionHash, async (db) => {
      const ed = await one(db, `select id from public.exam_editions where id = $1 and status = 'published'`, [id]);
      if (!ed) throw notFound('Prova');
      if (body.selected !== undefined || body.isPrimary !== undefined) {
        if (body.isPrimary) {
          await db.query(`update public.user_exam_editions set is_primary = false where user_id = $1 and is_primary`, [u.id]);
        }
        const selected = body.selected ?? (body.isPrimary ? true : undefined);
        await db.query(
          `insert into public.user_exam_editions(user_id, exam_edition_id, selected, is_primary) values ($1, $2, coalesce($3::boolean, true), coalesce($4::boolean, false))
           on conflict (user_id, exam_edition_id) do update set
             selected = coalesce($3::boolean, user_exam_editions.selected),
             is_primary = case when coalesce($3::boolean, user_exam_editions.selected) = false then false
                               else coalesce($4::boolean, user_exam_editions.is_primary) end`,
          [u.id, id, selected ?? null, body.isPrimary ?? null]);
        // Garante uma prova principal entre as selecionadas
        await db.query(`
          update public.user_exam_editions set is_primary = true
           where id = (select ue.id from public.user_exam_editions ue join public.exam_editions ed on ed.id = ue.exam_edition_id
                        where ue.user_id = $1 and ue.selected order by ed.exam_date nulls last limit 1)
             and not exists (select 1 from public.user_exam_editions where user_id = $1 and selected and is_primary)`, [u.id]);
        const exam = await one<{ exam_id: string }>(db, `select exam_id from public.exam_editions where id = $1`, [id]);
        await db.query(
          `insert into public.user_exams(user_id, exam_id, selected) values ($1, $2, coalesce($3, true))
           on conflict (user_id, exam_id) do update set selected = excluded.selected`, [u.id, exam!.exam_id, selected ?? true]);
      }
      if (body.status !== undefined || body.registrationNumber !== undefined || body.notes !== undefined) {
        if (body.status === null) {
          await db.query(`delete from public.registrations where user_id = $1 and exam_edition_id = $2`, [u.id, id]);
        } else {
          await db.query(
            `insert into public.registrations(user_id, exam_edition_id, status, registration_number, notes, registration_date)
             values ($1, $2, coalesce($3::public.registration_status, 'want_to'), $4::text, $5::text,
                     case when $3::public.registration_status = 'registered' then current_date end)
             on conflict (user_id, exam_edition_id) do update set
               status = coalesce($3::public.registration_status, registrations.status),
               registration_number = coalesce($4::text, registrations.registration_number),
               notes = coalesce($5::text, registrations.notes),
               registration_date = case when $3::public.registration_status = 'registered' and registrations.registration_date is null
                                        then current_date else registrations.registration_date end,
               updated_at = now()`,
            [u.id, id, body.status ?? null, body.registrationNumber ?? null, body.notes ?? null]);
        }
      }
      return { ok: true };
    });
  });

  /** Estatística histórica de uma prova (somente edições publicadas). */
  app.get('/api/exams/:examId/history', async (req) => {
    requireUser(req);
    const { examId } = z.object({ examId: z.string().uuid() }).parse(req.params);
    return tx(req.sessionHash, async (db) => {
      const exam = await one(db, `select e.id, e.name, i.abbreviation as institution from public.exams e join public.institutions i on i.id = e.institution_id where e.id = $1`, [examId]);
      if (!exam) throw notFound('Prova');
      const h = (await loadExamHistories(db, [examId])).get(examId)!;
      const info = await loadSubjectsInfo(db, h.stats.subjects.map((s) => s.subjectId));
      return {
        exam, ...h.stats, message: sufficiencyMessage(h.stats.editionsAnalyzed),
        subjects: h.stats.subjects.map((s, i) => ({ ...s, rank: i + 1, name: info.get(s.subjectId)?.name, area: info.get(s.subjectId)?.area })),
      };
    });
  });

  // ------------------------------------------------------ Configuração de estudo
  app.get('/api/study-methods', async (req) => tx(req.sessionHash, (db) => many(db, `select id, code, name, activity_type, default_minutes from public.study_methods where active order by sort_order`)));

  app.get('/api/me/study-settings', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, async (db) => {
      const profile = await loadProfile(db, u.id, t);
      return { profile, methods: await loadMethods(db, u.id), weekdays: studyWeekdays(profile) };
    });
  });

  app.put('/api/me/study-settings', async (req) => {
    const u = requireUser(req);
    const body = z.object({
      profile: z.object({
        start_date: isoDate,
        daily_hours: z.number().min(0.5).max(16),
        study_days_per_week: z.number().int().min(1).max(7),
        questions_per_day: z.number().int().min(0).max(500),
        study_saturday: z.boolean(),
        study_sunday: z.boolean(),
        preferred_start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        preferred_end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      }),
      methods: z.array(z.object({ id: z.string().uuid(), enabled: z.boolean(), minutes: z.number().int().min(5).max(600) })).min(1),
    }).parse(req.body);
    if (!body.methods.some((m) => m.enabled)) throw badRequest('Selecione pelo menos um método de estudo.');
    const p = body.profile;
    return tx(req.sessionHash, async (db) => {
      await db.query(
        `insert into public.study_profiles(user_id, start_date, daily_hours, study_days_per_week, questions_per_day, study_saturday,
            study_sunday, preferred_start_time, preferred_end_time)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (user_id) do update set start_date = excluded.start_date, daily_hours = excluded.daily_hours,
            study_days_per_week = excluded.study_days_per_week, questions_per_day = excluded.questions_per_day,
            study_saturday = excluded.study_saturday, study_sunday = excluded.study_sunday,
            preferred_start_time = excluded.preferred_start_time, preferred_end_time = excluded.preferred_end_time, updated_at = now()`,
        [u.id, p.start_date, p.daily_hours, p.study_days_per_week, p.questions_per_day, p.study_saturday, p.study_sunday,
          p.preferred_start_time ?? null, p.preferred_end_time ?? null]);
      for (const m of body.methods) {
        await db.query(
          `insert into public.user_study_methods(user_id, study_method_id, enabled, estimated_minutes) values ($1, $2, $3, $4)
           on conflict (user_id, study_method_id) do update set enabled = excluded.enabled, estimated_minutes = excluded.estimated_minutes`,
          [u.id, m.id, m.enabled, m.minutes]);
      }
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ Planner
  app.post('/api/planner/generate', async (req) => {
    const u = requireUser(req);
    const body = z.object({
      editionIds: z.array(z.string().uuid()).min(1).max(20),
      primaryEditionId: z.string().uuid(),
      startDate: isoDate,
      targetDate: isoDate.nullable().optional(),
    }).parse(req.body);
    const t = today(req);
    return tx(req.sessionHash, async (db) => ({ planId: await generatePlan(db, u.id, body, t) }));
  });

  app.post('/api/planner/replan', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, async (db) => ({ planId: await replan(db, u.id, t) }));
  });

  app.get('/api/planner', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, async (db) => {
      const s = await loadPlanState(db, u.id, t);
      if (!s) return { plan: null };
      const overdueActivities = await one<{ n: number }>(db,
        `select count(*)::int as n from public.study_schedule s where s.study_plan_id = $1 and not s.completed and s.scheduled_date < $2
            and not exists (select 1 from public.subject_method_progress p where p.user_id = s.user_id and p.subject_id = s.subject_id and p.study_method_id = s.study_method_id)`,
        [s.plan.id, t]);
      return { today: t, plan: s.plan, exams: s.exams, methods: s.methods, subjects: s.subjects, overdueActivities: overdueActivities?.n ?? 0 };
    });
  });

  app.get('/api/planner/today', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, async (db) => (await todayView(db, u.id, t)) ?? { plan: null });
  });

  app.get('/api/planner/subjects/:id', async (req) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = today(req);
    return tx(req.sessionHash, async (db) => {
      const s = await loadPlanState(db, u.id, t);
      const subj = s?.subjects.find((x) => x.subjectId === id);
      if (!s || !subj) throw notFound('Assunto');
      const practice = await many(db, `select id, questions_count, correct_count, time_spent_minutes, practiced_at from public.question_practice_logs
                   where user_id = $1 and subject_id = $2 order by practiced_at desc`, [u.id, id]);
      const reviews = await many(db, `select reviewed_at, rating, previous_interval, new_interval, scheduled_next_review, retrievability_at_review, days_until_exam
                    from public.review_logs where user_id = $1 and subject_id = $2 order by reviewed_at desc`, [u.id, id]);
      const children = await many(db, `select name from public.subjects where parent_subject_id = $1 and active order by name`, [id]);
      const summary = s.plan.summary;
      const primary = s.exams.find((e: any) => e.is_primary) as any;
      const totalEditions = subj.yearsAnalyzed;
      const pct = (subj.percentage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      const explanation = s.exams.length === 1
        ? `${subj.name} está em #${subj.rank} porque representou ${pct}% das questões das ${totalEditions} ${totalEditions === 1 ? 'edição cadastrada' : 'edições cadastradas'} de ${primary?.institution ?? 'sua prova'}.`
        : `${subj.name} está em #${subj.rank} porque representou, em média ponderada, ${pct}% das questões das provas selecionadas (peso maior para a prova principal e para as provas mais próximas).`;
      return {
        subject: subj,
        explanation,
        examWeights: summary.weights,
        exams: summary.exams,
        subtopics: children.map((c: any) => c.name),
        practice,
        reviews,
        weights: PRIORITY.weights,
        mastery: { priorWeight: MASTERY.priorWeight, priorMean: MASTERY.priorMean },
      };
    });
  });

  app.post('/api/planner/subjects/:id/methods/:methodId', async (req) => {
    const u = requireUser(req);
    const { id, methodId } = z.object({ id: z.string().uuid(), methodId: z.string().uuid() }).parse(req.params);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const t = today(req);
    return tx(req.sessionHash, (db) => setMethodDone(db, u.id, id, methodId, done, t));
  });

  app.post('/api/planner/subjects/:id/practice', async (req) => {
    const u = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      questions: z.number().int().min(1).max(1000),
      correct: z.number().int().min(0).max(1000),
      minutes: z.number().int().min(0).max(1440).nullable().optional(),
      source: z.string().max(200).nullable().optional(),
    }).parse(req.body);
    const t = today(req);
    return tx(req.sessionHash, (db) => logPractice(db, u.id, id, body, t));
  });

  app.delete('/api/planner/practice/:logId', async (req) => {
    requireUser(req);
    const { logId } = z.object({ logId: z.string().uuid() }).parse(req.params);
    return tx(req.sessionHash, async (db) => {
      const r = await db.query(`delete from public.question_practice_logs where id = $1`, [logId]);
      if (!r.rowCount) throw notFound('Registro');
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ Revisões
  app.get('/api/reviews/calendar', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    if (diffDays(q.to, q.from) > 62 || q.to < q.from) throw badRequest('Intervalo inválido (máx. 62 dias).');
    return tx(req.sessionHash, async (db) => (await calendarView(db, u.id, q.from, q.to, t)) ?? { plan: null });
  });

  app.post('/api/reviews/:subjectId', async (req) => {
    const u = requireUser(req);
    const { subjectId } = z.object({ subjectId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      rating: z.enum(RATINGS as [Rating, ...Rating[]]),
      timeSpentSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    }).parse(req.body);
    const t = today(req);
    return tx(req.sessionHash, (db) => rateReview(db, u.id, subjectId, body.rating, body.timeSpentSeconds ?? null, t));
  });

  // ------------------------------------------------------ Dashboard e desempenho
  app.get('/api/dashboard', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, (db) => dashboardView(db, u.id, t));
  });

  app.get('/api/performance', async (req) => {
    const u = requireUser(req);
    const t = today(req);
    return tx(req.sessionHash, (db) => performanceView(db, u.id, t));
  });

  app.get('/api/algorithm', async () => ({ priority: PRIORITY, memory: MEMORY, mastery: MASTERY }));
}
