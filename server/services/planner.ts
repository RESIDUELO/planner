/**
 * Serviço do planner: gera o plano a partir do histórico das provas
 * selecionadas e mantém checklist, desempenho e revisões.
 */
import { many, one, type Db } from '../db';
import { badRequest, HttpError } from '../errors';
import { loadExamHistories, loadSubjectsInfo } from './history';
import { MASTERY, MEMORY_VERSION, PRIORITY_VERSION, SCHEDULER_VERSION, MEMORY } from '../../shared/config';
import { addDays, diffDays, maxDate, type ISODate } from '../../shared/dates';
import {
  adjustDueDate, initialRatingFromAccuracy, retrievability, review, type MemoryState, type Rating,
} from '../../shared/memory';
import { dynamicPriority, LEVEL_LABEL, rankSubjects, type ExamInput, type PriorityLevel } from '../../shared/priority';
import { buildSchedule, sizeFactors } from '../../shared/scheduler';
import { estimateMastery } from '../../shared/mastery';
import { sufficiencyMessage } from '../../shared/stats';

// ---------------------------------------------------------------------------
// Seleção de provas e configuração
// ---------------------------------------------------------------------------

export interface SelectedEdition {
  edition_id: string;
  exam_id: string;
  year: number;
  exam_date: ISODate | null;
  total_questions: number | null;
  exam_total_questions: number | null;
  exam_name: string;
  institution: string;
  institution_name: string;
  is_primary: boolean;
}

export const editionLabel = (e: { institution: string; year: number; exam_name: string }) =>
  `${e.institution} ${e.year} — ${e.exam_name}`;

export async function loadEditions(db: Db, editionIds: string[]): Promise<SelectedEdition[]> {
  return many<SelectedEdition>(
    db,
    `select ed.id as edition_id, ed.exam_id, ed.year, ed.exam_date, ed.total_questions,
            e.total_questions as exam_total_questions, e.name as exam_name,
            i.abbreviation as institution, i.name as institution_name, false as is_primary
       from public.exam_editions ed
       join public.exams e on e.id = ed.exam_id
       join public.institutions i on i.id = e.institution_id
      where ed.id = any($1) and ed.status = 'published'`,
    [editionIds],
  );
}

export async function selectedEditions(db: Db, userId: string): Promise<SelectedEdition[]> {
  const rows = await many<{ exam_edition_id: string; is_primary: boolean }>(
    db,
    `select exam_edition_id, is_primary from public.user_exam_editions where user_id = $1 and selected`,
    [userId],
  );
  const eds = await loadEditions(db, rows.map((r) => r.exam_edition_id));
  const prim = new Set(rows.filter((r) => r.is_primary).map((r) => r.exam_edition_id));
  return eds.map((e) => ({ ...e, is_primary: prim.has(e.edition_id) }));
}

export interface StudyProfile {
  start_date: ISODate;
  daily_hours: number;
  study_days_per_week: number;
  questions_per_day: number;
  study_saturday: boolean;
  study_sunday: boolean;
  preferred_start_time: string | null;
  preferred_end_time: string | null;
}

export const DEFAULT_PROFILE = (today: ISODate): StudyProfile => ({
  start_date: today,
  daily_hours: 4,
  study_days_per_week: 6,
  questions_per_day: 20,
  study_saturday: true,
  study_sunday: false,
  preferred_start_time: null,
  preferred_end_time: null,
});

export async function loadProfile(db: Db, userId: string, today: ISODate): Promise<StudyProfile & { configured: boolean }> {
  const p = await one<StudyProfile>(db, `select * from public.study_profiles where user_id = $1`, [userId]);
  return p ? { ...p, configured: true } : { ...DEFAULT_PROFILE(today), configured: false };
}

/** Dias da semana de estudo: seg–sex + sáb/dom conforme flags, limitados ao nº de dias/semana. */
export function studyWeekdays(p: Pick<StudyProfile, 'study_days_per_week' | 'study_saturday' | 'study_sunday'>): number[] {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => (d === 6 ? p.study_saturday : d === 0 ? p.study_sunday : true));
  return order.slice(0, Math.max(1, p.study_days_per_week)).sort();
}

export interface UserMethod {
  id: string;
  code: string;
  name: string;
  activity_type: string;
  default_minutes: number;
  enabled: boolean;
  estimated_minutes: number;
  configured: boolean;
}

export async function loadMethods(db: Db, userId: string): Promise<UserMethod[]> {
  return many<UserMethod>(
    db,
    `select m.id, m.code, m.name, m.activity_type, m.default_minutes,
            coalesce(um.enabled, false) as enabled,
            coalesce(um.estimated_minutes, m.default_minutes) as estimated_minutes,
            um.user_id is not null as configured
       from public.study_methods m
       left join public.user_study_methods um on um.study_method_id = m.id and um.user_id = $1
      where m.active
      order by m.sort_order`,
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Geração do planner
// ---------------------------------------------------------------------------

export interface GenerateParams {
  editionIds: string[];
  primaryEditionId: string;
  startDate: ISODate;
  targetDate?: ISODate | null;
}

export async function saveSelection(db: Db, userId: string, editionIds: string[], primaryId: string) {
  await db.query(`update public.user_exam_editions set is_primary = false where user_id = $1 and is_primary`, [userId]);
  await db.query(
    `update public.user_exam_editions set selected = false where user_id = $1 and not (exam_edition_id = any($2))`,
    [userId, editionIds],
  );
  for (const id of editionIds) {
    await db.query(
      `insert into public.user_exam_editions(user_id, exam_edition_id, is_primary, selected) values ($1, $2, $3, true)
       on conflict (user_id, exam_edition_id) do update set selected = true, is_primary = excluded.is_primary`,
      [userId, id, id === primaryId],
    );
  }
}

export async function generatePlan(db: Db, userId: string, params: GenerateParams, today: ISODate) {
  const editionIds = [...new Set(params.editionIds)];
  if (!editionIds.length) throw badRequest('Selecione pelo menos uma prova.');
  if (!editionIds.includes(params.primaryEditionId)) throw badRequest('A prova principal precisa estar entre as selecionadas.');
  const eds = await loadEditions(db, editionIds);
  if (eds.length !== editionIds.length) throw badRequest('Uma das provas selecionadas não está disponível.');

  const profile = await loadProfile(db, userId, today);
  if (!profile.configured) throw badRequest('Configure seu tempo de estudo antes de gerar o planner.');
  const methods = (await loadMethods(db, userId)).filter((m) => m.enabled);
  if (!methods.length) throw badRequest('Selecione pelo menos um método de estudo.');

  await saveSelection(db, userId, editionIds, params.primaryEditionId);

  const startDate = maxDate(params.startDate, today)!;
  const futureDates = eds.map((e) => e.exam_date).filter((d): d is string => !!d && d > startDate);
  const endDate = params.targetDate ?? maxDate(...futureDates);
  if (!endDate) {
    throw badRequest('As provas selecionadas não têm data cadastrada. Informe uma data-alvo para o planejamento.');
  }
  if (endDate <= startDate) throw badRequest('A data-alvo precisa ser posterior à data de início.');

  const histories = await loadExamHistories(db, [...new Set(eds.map((e) => e.exam_id))]);
  const examInputs: ExamInput[] = eds.map((e) => {
    const h = histories.get(e.exam_id)!;
    return {
      editionId: e.edition_id,
      label: editionLabel(e),
      examDate: e.exam_date,
      isPrimary: e.edition_id === params.primaryEditionId,
      expectedTotalQuestions: e.total_questions ?? e.exam_total_questions ?? Math.round(h.stats.averageQuestionsPerEdition),
      stats: h.stats,
    };
  });
  const { weights, subjects } = rankSubjects(examInputs, startDate);
  if (!subjects.length) {
    throw new HttpError(422, 'Ainda não há questões classificadas publicadas para as provas selecionadas. ' +
      'Dados insuficientes para montar um planner baseado no histórico.');
  }

  // Progresso e cartões existentes (preservados entre planners)
  const progress = await many<{ subject_id: string; study_method_id: string }>(
    db, `select subject_id, study_method_id from public.subject_method_progress where user_id = $1`, [userId]);
  const cards = await many<CardRow>(db, `select * from public.spaced_repetition_cards where user_id = $1`, [userId]);
  const cardBySubject = new Map(cards.map((c) => [c.subject_id, c]));

  const factors = sizeFactors(subjects.map((s) => s.percentage));
  const weightById = new Map(weights.map((w) => [w.editionId, w]));
  const examDateFor = (s: (typeof subjects)[number]): ISODate => {
    const dates = s.perExam
      .filter((p) => p.percentage > 0 && (weightById.get(p.editionId)?.weight ?? 0) > 0)
      .map((p) => eds.find((e) => e.edition_id === p.editionId)?.exam_date)
      .filter((d): d is string => !!d && d > startDate)
      .sort();
    return dates[0] ?? endDate;
  };

  const schedule = buildSchedule({
    startDate,
    endDate,
    dailyMinutes: Math.round(profile.daily_hours * 60),
    studyWeekdays: studyWeekdays(profile),
    questionsPerDay: profile.questions_per_day,
    methods: methods.map((m) => ({ id: m.id, code: m.code, activityType: m.activity_type, minutes: m.estimated_minutes })),
    subjects: subjects.map((s, i) => {
      const card = cardBySubject.get(s.subjectId);
      return {
        subjectId: s.subjectId,
        rank: s.rank,
        percentage: s.percentage,
        sizeFactor: factors[i],
        examDate: examDateFor(s),
        completedMethodIds: progress.filter((p) => p.subject_id === s.subjectId).map((p) => p.study_method_id),
        card: card ? { state: cardState(card), nextReview: card.next_review_at } : null,
      };
    }),
    examDates: eds.map((e) => e.exam_date).filter((d): d is string => !!d),
  });

  // Arquiva o plano anterior (histórico preservado)
  await db.query(`update public.study_plans set status = 'archived' where user_id = $1 and status = 'active'`, [userId]);

  const primary = eds.find((e) => e.edition_id === params.primaryEditionId)!;
  const plan = (await one<{ id: string }>(
    db,
    `insert into public.study_plans(user_id, name, start_date, end_date, primary_exam_edition_id, mode, algorithm_version,
                                    scheduler_version, settings_snapshot, summary)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      userId,
      `Planner ${editionLabel(primary)}`,
      startDate,
      endDate,
      primary.edition_id,
      eds.length > 1 ? 'multi' : 'single',
      `${PRIORITY_VERSION}+${MEMORY_VERSION}`,
      SCHEDULER_VERSION,
      JSON.stringify({ profile, methods: methods.map((m) => ({ id: m.id, code: m.code, minutes: m.estimated_minutes })), studyWeekdays: studyWeekdays(profile) }),
      JSON.stringify({
        ...schedule.summary,
        weights,
        exams: examInputs.map((e) => ({
          editionId: e.editionId,
          label: e.label,
          examDate: e.examDate,
          editionsAnalyzed: e.stats.editionsAnalyzed,
          years: e.stats.years,
          totalQuestions: e.stats.totalQuestions,
          sufficiency: e.stats.sufficiency,
          message: sufficiencyMessage(e.stats.editionsAnalyzed),
          expectedTotalQuestions: e.expectedTotalQuestions,
        })),
      }),
    ],
  ))!;

  for (const e of examInputs) {
    const w = weightById.get(e.editionId)!;
    await db.query(
      `insert into public.study_plan_exams(study_plan_id, exam_edition_id, user_id, is_primary, weight, exam_date, editions_analyzed)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [plan.id, e.editionId, userId, e.isPrimary, w.weight, e.examDate, e.stats.editionsAnalyzed],
    );
  }

  const scheduledSet = new Set(schedule.scheduledSubjectIds);
  const subjCols = subjects.map((s, i) => ({
    subject_id: s.subjectId,
    historical_frequency: s.weighted,
    historical_percentage: s.percentage,
    annual_average: s.annualAverage,
    years_present: s.editionsPresent,
    years_analyzed: s.editionsAnalyzed,
    recent_frequency: s.recentPercentage,
    priority_score: s.historicalScore,
    priority_rank: s.rank,
    priority_level: s.level,
    estimated_questions: s.estimatedQuestions,
    size_factor: factors[i],
    exam_date: examDateFor(s),
    scheduled: scheduledSet.has(s.subjectId),
    per_exam: s.perExam,
  }));
  await db.query(
    `insert into public.study_plan_subjects(study_plan_id, user_id, subject_id, historical_frequency, historical_percentage,
       annual_average, years_present, years_analyzed, recent_frequency, priority_score, priority_rank, priority_level,
       estimated_questions, size_factor, exam_date, scheduled, per_exam)
     select $1, $2, x.subject_id, x.historical_frequency, x.historical_percentage, x.annual_average, x.years_present,
            x.years_analyzed, x.recent_frequency, x.priority_score, x.priority_rank, x.priority_level,
            x.estimated_questions, x.size_factor, x.exam_date, x.scheduled, x.per_exam
       from jsonb_to_recordset($3::jsonb) as x(subject_id uuid, historical_frequency numeric, historical_percentage numeric,
            annual_average numeric, years_present int, years_analyzed int, recent_frequency numeric, priority_score numeric,
            priority_rank int, priority_level text, estimated_questions numeric, size_factor numeric, exam_date date,
            scheduled boolean, per_exam jsonb)`,
    [plan.id, userId, JSON.stringify(subjCols)],
  );

  if (schedule.activities.length) {
    await db.query(
      `insert into public.study_schedule(user_id, study_plan_id, subject_id, study_method_id, scheduled_date, activity_type,
                                         estimated_minutes, priority)
       select $1, $2, x.subject_id, x.method_id, x.date, x.activity_type, x.minutes, x.priority
         from jsonb_to_recordset($3::jsonb) as x(subject_id uuid, method_id uuid, date date, activity_type text, minutes int, priority int)`,
      [userId, plan.id, JSON.stringify(schedule.activities.map((a) => ({
        subject_id: a.subjectId, method_id: a.methodId, date: a.date, activity_type: a.activityType, minutes: a.minutes, priority: a.priority,
      })))],
    );
  }
  // Mantém o prazo das revisões existentes coerente com as datas das provas
  await readjustCards(db, userId, plan.id, today);
  return plan.id;
}

/** Regera o planner com a mesma seleção, a partir de hoje (seção 30: recalcular conforme a prova se aproxima). */
export async function replan(db: Db, userId: string, today: ISODate) {
  const plan = await one<{ id: string; start_date: string; end_date: string }>(
    db, `select id, start_date, end_date from public.study_plans where user_id = $1 and status = 'active'`, [userId]);
  if (!plan) throw badRequest('Nenhum planner ativo.');
  const exams = await many<{ exam_edition_id: string; is_primary: boolean; exam_date: string | null }>(
    db, `select exam_edition_id, is_primary, exam_date from public.study_plan_exams where study_plan_id = $1`, [plan.id]);
  const primary = exams.find((e) => e.is_primary) ?? exams[0];
  const hasFutureDate = exams.some((e) => e.exam_date && e.exam_date > today);
  return generatePlan(db, userId, {
    editionIds: exams.map((e) => e.exam_edition_id),
    primaryEditionId: primary.exam_edition_id,
    startDate: today,
    targetDate: hasFutureDate ? null : plan.end_date,
  }, today);
}

// ---------------------------------------------------------------------------
// Estado do planner
// ---------------------------------------------------------------------------

export interface CardRow {
  id: string;
  subject_id: string;
  stability: number;
  difficulty: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  last_review_at: string;
  next_review_at: ISODate | null;
  last_rating: Rating | null;
}

export function cardState(c: CardRow): MemoryState {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    lastReview: toISODateBR(c.last_review_at),
    repetitions: c.repetitions,
    lapses: c.lapses,
  };
}

export function toISODateBR(ts: string | Date): ISODate {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

export async function activePlan(db: Db, userId: string) {
  return one<{
    id: string; name: string; start_date: ISODate; end_date: ISODate; primary_exam_edition_id: string; mode: string;
    algorithm_version: string; scheduler_version: string; settings_snapshot: any; summary: any; created_at: string;
  }>(db, `select * from public.study_plans where user_id = $1 and status = 'active'`, [userId]);
}

export type SubjectStatus = 'pending' | 'in_progress' | 'studied';

export interface PlanSubjectView {
  subjectId: string;
  name: string;
  area: string;
  specialty: string | null;
  rank: number;
  level: PriorityLevel;
  levelLabel: string;
  percentage: number;
  frequency: number;
  annualAverage: number;
  yearsPresent: number;
  yearsAnalyzed: number;
  recentPercentage: number;
  estimatedQuestions: number;
  sizeFactor: number;
  scheduled: boolean;
  examDate: ISODate | null;
  perExam: any[];
  status: SubjectStatus;
  checklist: { methodId: string; code: string; name: string; done: boolean; completedAt: string | null; scheduledDate: ISODate | null; minutes: number | null }[];
  progress: number;
  performance: { answered: number; correct: number; accuracy: number | null; lastQuestionAt: string | null };
  card: null | { id: string; stability: number; difficulty: number; repetitions: number; lapses: number; lastReview: ISODate; nextReview: ISODate | null; retrievability: number; lastRating: Rating | null };
  mastery: ReturnType<typeof estimateMastery>;
  dynamic: ReturnType<typeof dynamicPriority>;
  lastStudiedAt: string | null;
  nextScheduledDate: ISODate | null;
}

export async function loadPlanState(db: Db, userId: string, today: ISODate) {
  const plan = await activePlan(db, userId);
  if (!plan) return null;

  const exams = await many(db, `select pe.*, ed.year, ed.total_questions, e.name as exam_name, e.total_questions as exam_total_questions,
                     i.abbreviation as institution, e.id as exam_id
                from public.study_plan_exams pe
                join public.exam_editions ed on ed.id = pe.exam_edition_id
                join public.exams e on e.id = ed.exam_id
                join public.institutions i on i.id = e.institution_id
               where pe.study_plan_id = $1
               order by pe.exam_date nulls last`, [plan.id]);
  const planSubjects = await many(db, `select * from public.study_plan_subjects where study_plan_id = $1 order by priority_rank`, [plan.id]);
  const methods = await loadMethods(db, userId);
  const progress = await many(db, `select * from public.subject_method_progress where user_id = $1`, [userId]);
  const perf = await many(db, `select * from public.user_subject_performance where user_id = $1`, [userId]);
  const cards = await many<CardRow>(db, `select * from public.spaced_repetition_cards where user_id = $1`, [userId]);
  const sched = await many(db, `select subject_id, study_method_id, scheduled_date, estimated_minutes, completed
                from public.study_schedule where study_plan_id = $1 and activity_type <> 'review'`, [plan.id]);
  const enabled = methods.filter((m) => m.enabled);
  const info = await loadSubjectsInfo(db, planSubjects.map((s: any) => s.subject_id));
  const perfBy = new Map(perf.map((p: any) => [p.subject_id, p]));
  const cardBy = new Map(cards.map((c) => [c.subject_id, c]));
  const progBy = new Map<string, Map<string, string>>();
  for (const p of progress as any[]) {
    if (!progBy.has(p.subject_id)) progBy.set(p.subject_id, new Map());
    progBy.get(p.subject_id)!.set(p.study_method_id, p.completed_at);
  }
  const schedBy = new Map<string, any[]>();
  for (const s of sched as any[]) {
    if (!schedBy.has(s.subject_id)) schedBy.set(s.subject_id, []);
    schedBy.get(s.subject_id)!.push(s);
  }
  const weightByEdition = new Map(exams.map((e: any) => [e.exam_edition_id, e]));
  const maxHist = Math.max(...planSubjects.map((s: any) => s.priority_score), 0) || 1;

  const subjects: PlanSubjectView[] = planSubjects.map((s: any) => {
    const inf = info.get(s.subject_id);
    const prog = progBy.get(s.subject_id) ?? new Map();
    const scheduleRows = schedBy.get(s.subject_id) ?? [];
    const checklist = enabled.map((m) => {
      const row = scheduleRows.find((r) => r.study_method_id === m.id);
      return {
        methodId: m.id, code: m.code, name: m.name,
        done: prog.has(m.id), completedAt: prog.get(m.id) ?? null,
        scheduledDate: row?.scheduled_date ?? null, minutes: row?.estimated_minutes ?? null,
      };
    });
    const doneCount = checklist.filter((c) => c.done).length;
    const status: SubjectStatus = doneCount === 0 ? 'pending' : doneCount === checklist.length ? 'studied' : 'in_progress';
    const p: any = perfBy.get(s.subject_id);
    const c = cardBy.get(s.subject_id);
    const r = c ? retrievability(Math.max(0, diffDays(today, toISODateBR(c.last_review_at))), c.stability) : null;
    const answered = p?.questions_answered ?? 0;
    const correct = p?.questions_correct ?? 0;
    const mastery = estimateMastery({ studied: status === 'studied' || !!c, questionsAnswered: answered, questionsCorrect: correct, retrievability: r });
    const proximity = Math.max(0, ...(s.per_exam as any[]).filter((x) => x.percentage > 0).map((x) => {
      const ex: any = weightByEdition.get(x.editionId);
      if (!ex?.exam_date || Number(ex.weight) === 0) return 0;
      return 1 / (1 + Math.max(0, diffDays(ex.exam_date, today)) / 60);
    }));
    const dynamic = dynamicPriority({
      historicalScore: s.priority_score / maxHist,
      proximity,
      retrievability: r,
      questionsAnswered: answered,
      questionsCorrect: correct,
    });
    const lastDone = [...prog.values()].sort().pop() ?? null;
    const pendingDates = scheduleRows.filter((x) => !prog.has(x.study_method_id)).map((x) => x.scheduled_date).sort();
    return {
      subjectId: s.subject_id,
      name: inf?.name ?? '—',
      area: inf?.area ?? '—',
      specialty: inf?.specialty ?? null,
      rank: s.priority_rank,
      level: s.priority_level,
      levelLabel: LEVEL_LABEL[s.priority_level as PriorityLevel],
      percentage: s.historical_percentage,
      frequency: s.historical_frequency,
      annualAverage: s.annual_average,
      yearsPresent: s.years_present,
      yearsAnalyzed: s.years_analyzed,
      recentPercentage: s.recent_frequency,
      estimatedQuestions: s.estimated_questions,
      sizeFactor: s.size_factor,
      scheduled: s.scheduled,
      examDate: s.exam_date,
      perExam: s.per_exam,
      status,
      checklist,
      progress: checklist.length ? doneCount / checklist.length : 0,
      performance: { answered, correct, accuracy: answered ? correct / answered : null, lastQuestionAt: p?.last_question_at ?? null },
      card: c ? {
        id: c.id, stability: c.stability, difficulty: c.difficulty, repetitions: c.repetitions, lapses: c.lapses,
        lastReview: toISODateBR(c.last_review_at), nextReview: c.next_review_at, retrievability: r!, lastRating: c.last_rating,
      } : null,
      mastery,
      dynamic,
      lastStudiedAt: [lastDone, c?.last_review_at ?? null].filter(Boolean).sort().pop() ?? null,
      nextScheduledDate: pendingDates[0] ?? null,
    };
  });

  return { plan, exams, subjects, methods: enabled };
}

// ---------------------------------------------------------------------------
// Checklist, questões e revisões
// ---------------------------------------------------------------------------

async function planSubjectRow(db: Db, userId: string, subjectId: string) {
  return one<{ study_plan_id: string; exam_date: ISODate | null }>(
    db,
    `select ps.study_plan_id, ps.exam_date from public.study_plan_subjects ps
       join public.study_plans p on p.id = ps.study_plan_id and p.status = 'active'
      where ps.user_id = $1 and ps.subject_id = $2`,
    [userId, subjectId],
  );
}

export async function setMethodDone(db: Db, userId: string, subjectId: string, methodId: string, done: boolean, today: ISODate) {
  const ps = await planSubjectRow(db, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  const method = await one(db, `select id from public.study_methods where id = $1`, [methodId]);
  if (!method) throw badRequest('Método inválido.');
  if (done) {
    await db.query(
      `insert into public.subject_method_progress(user_id, subject_id, study_method_id) values ($1, $2, $3)
       on conflict do nothing`, [userId, subjectId, methodId]);
  } else {
    await db.query(`delete from public.subject_method_progress where user_id = $1 and subject_id = $2 and study_method_id = $3`,
      [userId, subjectId, methodId]);
  }
  await db.query(
    `update public.study_schedule set completed = $4, completed_at = case when $4 then now() end
      where study_plan_id = $1 and subject_id = $2 and study_method_id = $3`,
    [ps.study_plan_id, subjectId, methodId, done],
  );
  // Assunto estudado → primeira revisão agendada
  const enabled = await many<{ id: string }>(db,
    `select study_method_id as id from public.user_study_methods where user_id = $1 and enabled`, [userId]);
  const doneRows = await many<{ study_method_id: string }>(db,
    `select study_method_id from public.subject_method_progress where user_id = $1 and subject_id = $2`, [userId, subjectId]);
  const doneSet = new Set(doneRows.map((r) => r.study_method_id));
  const studied = enabled.length > 0 && enabled.every((m) => doneSet.has(m.id));
  let cardCreated = false;
  if (studied) cardCreated = await ensureCard(db, userId, subjectId, ps.study_plan_id, ps.exam_date, today);
  return { studied, cardCreated };
}

async function ensureCard(db: Db, userId: string, subjectId: string, planId: string, examDate: ISODate | null, today: ISODate) {
  const existing = await one(db, `select id from public.spaced_repetition_cards where user_id = $1 and subject_id = $2`, [userId, subjectId]);
  if (existing) return false;
  const perf = await one<{ accuracy: number | null; questions_answered: number }>(db,
    `select accuracy, questions_answered from public.user_subject_performance where user_id = $1 and subject_id = $2`, [userId, subjectId]);
  const rating = initialRatingFromAccuracy(perf && perf.questions_answered >= MASTERY.minQuestionsForPerformance ? perf.accuracy : null);
  const res = review(null, rating, today, examDate);
  const card = (await one<{ id: string }>(db,
    `insert into public.spaced_repetition_cards(user_id, subject_id, study_plan_id, stability, difficulty, retrievability,
        interval_days, repetitions, lapses, last_review_at, next_review_at, last_rating, algorithm_version)
     values ($1, $2, $3, $4, $5, 1, $6, $7, $8, now(), $9, $10, $11) returning id`,
    [userId, subjectId, planId, res.state.stability, res.state.difficulty, res.intervalDays, res.state.repetitions,
      res.state.lapses, res.nextReview, rating, MEMORY_VERSION]))!;
  await db.query(
    `insert into public.review_logs(user_id, spaced_repetition_card_id, subject_id, rating, previous_stability, new_stability,
        previous_difficulty, new_difficulty, previous_interval, new_interval, scheduled_next_review, retrievability_at_review,
        days_until_exam, algorithm_version)
     values ($1, $2, $3, $4, null, $5, null, $6, null, $7, $8, null, $9, $10)`,
    [userId, card.id, subjectId, rating, res.state.stability, res.state.difficulty, res.intervalDays, res.nextReview,
      examDate ? diffDays(examDate, today) : null, MEMORY_VERSION]);
  return true;
}

export async function logPractice(
  db: Db, userId: string, subjectId: string,
  body: { questions: number; correct: number; minutes?: number | null; source?: string | null }, today: ISODate,
) {
  if (body.correct > body.questions) throw badRequest('Acertos não podem ser maiores que o total de questões.');
  const ps = await planSubjectRow(db, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  await db.query(
    `insert into public.question_practice_logs(user_id, subject_id, questions_count, correct_count, time_spent_minutes, source)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, subjectId, body.questions, body.correct, body.minutes ?? null, body.source ?? null],
  );
  // Marca o método "Questões" no checklist, se o usuário o utiliza
  const qm = await one<{ id: string }>(db,
    `select m.id from public.study_methods m join public.user_study_methods um on um.study_method_id = m.id
      where um.user_id = $1 and um.enabled and m.code = 'questions'`, [userId]);
  let studied = false;
  if (qm) studied = (await setMethodDone(db, userId, subjectId, qm.id, true, today)).studied;
  // Desempenho baixo antecipa a revisão
  let reviewAnticipated = false;
  if (body.correct / body.questions < MEMORY.lowAccuracyThreshold) {
    const r = await db.query(
      `update public.spaced_repetition_cards set next_review_at = least(next_review_at, $3::date)
        where user_id = $1 and subject_id = $2 and next_review_at > $3::date`,
      [userId, subjectId, addDays(today, 1)]);
    reviewAnticipated = (r.rowCount ?? 0) > 0;
  }
  const perf = await one(db, `select * from public.user_subject_performance where user_id = $1 and subject_id = $2`, [userId, subjectId]);
  return { performance: perf, studied, reviewAnticipated };
}

export async function rateReview(
  db: Db, userId: string, subjectId: string, rating: Rating, timeSpentSeconds: number | null, today: ISODate,
) {
  const card = await one<CardRow>(db, `select * from public.spaced_repetition_cards where user_id = $1 and subject_id = $2`, [userId, subjectId]);
  if (!card) throw badRequest('Este assunto ainda não tem revisões: conclua o checklist primeiro.');
  const ps = await planSubjectRow(db, userId, subjectId);
  const examDate = ps?.exam_date ?? null;
  const prev = cardState(card);
  const res = review(prev, rating, today, examDate);
  await db.query(
    `update public.spaced_repetition_cards set stability = $3, difficulty = $4, retrievability = $5, interval_days = $6,
        repetitions = $7, lapses = $8, last_review_at = now(), next_review_at = $9, last_rating = $10, algorithm_version = $11
      where id = $1 and user_id = $2`,
    [card.id, userId, res.state.stability, res.state.difficulty, res.retrievabilityAtReview, res.intervalDays,
      res.state.repetitions, res.state.lapses, res.nextReview, rating, MEMORY_VERSION]);
  await db.query(
    `update public.review_logs set actual_next_review = $3
      where id = (select id from public.review_logs where user_id = $1 and spaced_repetition_card_id = $2
                   and actual_next_review is null order by reviewed_at desc limit 1)`,
    [userId, card.id, today]);
  await db.query(
    `insert into public.review_logs(user_id, spaced_repetition_card_id, subject_id, rating, previous_stability, new_stability,
        previous_difficulty, new_difficulty, previous_interval, new_interval, scheduled_next_review, retrievability_at_review,
        days_until_exam, time_spent_seconds, algorithm_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [userId, card.id, subjectId, rating, card.stability, res.state.stability, card.difficulty, res.state.difficulty,
      card.interval_days, res.intervalDays, res.nextReview, res.retrievabilityAtReview,
      examDate ? diffDays(examDate, today) : null, timeSpentSeconds, MEMORY_VERSION]);
  return {
    previous: { stability: card.stability, difficulty: card.difficulty, interval: card.interval_days, nextReview: card.next_review_at },
    next: { stability: res.state.stability, difficulty: res.state.difficulty, interval: res.intervalDays, nextReview: res.nextReview,
      targetRetention: res.targetRetention, cappedBy: res.cappedBy, retrievabilityAtReview: res.retrievabilityAtReview },
  };
}

/** Reajusta os prazos dos cartões conforme a prova se aproxima ou muda de data. */
export async function readjustCards(db: Db, userId: string, planId: string | null, today: ISODate) {
  if (!planId) return 0;
  const rows = await many<{ id: string; next_review_at: ISODate | null; exam_date: ISODate | null }>(db,
    `select c.id, c.next_review_at, ps.exam_date from public.spaced_repetition_cards c
       join public.study_plan_subjects ps on ps.subject_id = c.subject_id and ps.study_plan_id = $2
      where c.user_id = $1`, [userId, planId]);
  let changed = 0;
  for (const r of rows) {
    const adj = adjustDueDate(r.next_review_at, today, r.exam_date);
    if (adj !== r.next_review_at) {
      // Revisões já vencidas continuam vencidas (aparecem como atrasadas)
      if (r.next_review_at && r.next_review_at <= today) continue;
      await db.query(`update public.spaced_repetition_cards set next_review_at = $2 where id = $1`, [r.id, adj]);
      changed++;
    }
  }
  return changed;
}
