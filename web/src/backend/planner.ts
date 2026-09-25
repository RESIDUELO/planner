/**
 * Planner: gera o plano a partir do histórico das provas selecionadas e
 * mantém checklist, desempenho e revisões. Os cálculos usam shared/; a
 * gravação acontece no Supabase, protegida por RLS.
 */
import { MASTERY, MEMORY, MEMORY_VERSION, PRIORITY_VERSION, SCHEDULER_VERSION } from '../../../shared/config';
import { addDays, diffDays, maxDate, type ISODate } from '../../../shared/dates';
import { adjustDueDate, initialRatingFromAccuracy, retrievability, review, type MemoryState, type Rating } from '../../../shared/memory';
import { dynamicPriority, LEVEL_LABEL, rankSubjects, type ExamInput, type PriorityLevel } from '../../../shared/priority';
import { buildSchedule, sizeFactors } from '../../../shared/scheduler';
import { estimateMastery } from '../../../shared/mastery';
import { assignReviews } from '../../../shared/reviewQueue';
import { sufficiencyMessage } from '../../../shared/stats';
import { ApiError, badRequest, currentUserId, q, rpc, selectAll, type Ctx } from './core';
import { loadExamHistories, loadSubjectsInfo } from './history';

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

export const editionLabel = (e: { institution: string; exam_name: string }) => `${e.institution} — ${e.exam_name}`;

/** Provas escolhidas: data oficial cadastrada ou, sem ela, a informada pelo próprio aluno. */
export async function loadEditions(ctx: Ctx, editionIds: string[]): Promise<SelectedEdition[]> {
  if (!editionIds.length) return [];
  const uid = await currentUserId(ctx);
  const rows = await q(ctx.sb.from('exam_catalog')
    .select('edition_id, exam_id, year, exam_date, total_questions, exam_total_questions, exam_name, institution, institution_name, status')
    .in('edition_id', editionIds).eq('status', 'published'));
  const mine = await q(ctx.sb.from('user_exam_editions').select('exam_edition_id, exam_date').eq('user_id', uid).in('exam_edition_id', editionIds));
  const dateBy = new Map((mine as any[]).map((m) => [m.exam_edition_id, m.exam_date]));
  return (rows as any[]).map((r) => ({ ...r, exam_date: r.exam_date ?? dateBy.get(r.edition_id) ?? null, is_primary: false }));
}

export async function selectedEditions(ctx: Ctx, userId: string): Promise<SelectedEdition[]> {
  const rows = await q(ctx.sb.from('user_exam_editions').select('exam_edition_id, is_primary').eq('user_id', userId).eq('selected', true));
  const eds = await loadEditions(ctx, rows.map((r: any) => r.exam_edition_id));
  const prim = new Set(rows.filter((r: any) => r.is_primary).map((r: any) => r.exam_edition_id));
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
  /** Máximo de revisões por dia (padrão 2). */
  reviews_per_day: number;
}

export const DEFAULT_PROFILE = (today: ISODate): StudyProfile => ({
  start_date: today, daily_hours: 4, study_days_per_week: 6, questions_per_day: 20,
  study_saturday: true, study_sunday: false, preferred_start_time: null, preferred_end_time: null,
  reviews_per_day: REVIEWS_PER_DAY_DEFAULT,
});

export const REVIEWS_PER_DAY_DEFAULT = 2;

export async function loadProfile(ctx: Ctx, userId: string): Promise<StudyProfile & { configured: boolean }> {
  const p = await q(ctx.sb.from('study_profiles').select('*').eq('user_id', userId).maybeSingle());
  return p
    ? { ...(p as any), daily_hours: Number((p as any).daily_hours), reviews_per_day: (p as any).reviews_per_day ?? REVIEWS_PER_DAY_DEFAULT, configured: true }
    : { ...DEFAULT_PROFILE(ctx.today()), configured: false };
}

/** Dias da semana de estudo: seg–sex + sáb/dom conforme flags, limitados ao nº de dias/semana. */
export function studyWeekdays(p: Pick<StudyProfile, 'study_days_per_week' | 'study_saturday' | 'study_sunday'>): number[] {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => (d === 6 ? p.study_saturday : d === 0 ? p.study_sunday : true));
  return order.slice(0, Math.max(1, p.study_days_per_week)).sort();
}

export interface UserMethod {
  id: string; code: string; name: string; activity_type: string; default_minutes: number;
  enabled: boolean; estimated_minutes: number; configured: boolean;
}

export async function loadMethods(ctx: Ctx, userId: string): Promise<UserMethod[]> {
  const methods = await q(ctx.sb.from('study_methods').select('id, code, name, activity_type, default_minutes, sort_order').eq('active', true).order('sort_order'));
  const mine = await q(ctx.sb.from('user_study_methods').select('*').eq('user_id', userId));
  return (methods as any[]).map((m) => {
    const um = (mine as any[]).find((x) => x.study_method_id === m.id);
    return {
      id: m.id, code: m.code, name: m.name, activity_type: m.activity_type, default_minutes: m.default_minutes,
      enabled: um?.enabled ?? false, estimated_minutes: um?.estimated_minutes ?? m.default_minutes, configured: !!um,
    };
  });
}

/** Atividades escolhidas por assunto (sem escolha = métodos marcados em "Como você estuda?"). */
export async function loadActivityChoices(ctx: Ctx, userId: string): Promise<Map<string, string[]>> {
  const rows = await selectAll((a, b) => ctx.sb.from('subject_activity_choices').select('subject_id, study_method_id').eq('user_id', userId).range(a, b));
  const out = new Map<string, string[]>();
  for (const r of rows as any[]) {
    if (!out.has(r.subject_id)) out.set(r.subject_id, []);
    out.get(r.subject_id)!.push(r.study_method_id);
  }
  return out;
}

async function activitiesFor(ctx: Ctx, userId: string, subjectId: string): Promise<string[]> {
  const custom = await q(ctx.sb.from('subject_activity_choices').select('study_method_id').eq('user_id', userId).eq('subject_id', subjectId));
  if ((custom as any[]).length) return (custom as any[]).map((r) => r.study_method_id);
  return (await loadMethods(ctx, userId)).filter((m) => m.enabled).map((m) => m.id);
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

export async function saveSelection(ctx: Ctx, userId: string, editionIds: string[], primaryId: string) {
  await q(ctx.sb.from('user_exam_editions').update({ selected: false, is_primary: false })
    .eq('user_id', userId).not('exam_edition_id', 'in', `(${editionIds.join(',')})`));
  for (const id of editionIds) {
    await rpc(ctx, 'set_edition_selection', { p_edition: id, p_selected: true, p_primary: id === primaryId });
  }
}

export async function generatePlan(ctx: Ctx, params: GenerateParams): Promise<string> {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const editionIds = [...new Set(params.editionIds)];
  if (!editionIds.length) throw badRequest('Selecione pelo menos uma prova.');
  if (!editionIds.includes(params.primaryEditionId)) throw badRequest('A prova principal precisa estar entre as selecionadas.');
  const eds = await loadEditions(ctx, editionIds);
  if (eds.length !== editionIds.length) throw badRequest('Uma das provas selecionadas não está disponível.');

  const profile = await loadProfile(ctx, userId);
  if (!profile.configured) throw badRequest('Configure seu tempo de estudo antes de gerar o planner.');
  const allMethods = await loadMethods(ctx, userId);
  const methods = allMethods.filter((m) => m.enabled);
  if (!methods.length) throw badRequest('Selecione pelo menos um método de estudo.');
  const choices = await loadActivityChoices(ctx, userId);

  const startDate = maxDate(params.startDate, today)!;
  const futureDates = eds.map((e) => e.exam_date).filter((d): d is string => !!d && d > startDate);
  const endDate = params.targetDate ?? maxDate(...futureDates);
  if (!endDate) throw badRequest('Informe a data da prova (futura) de pelo menos uma das provas selecionadas.');
  if (endDate <= startDate) throw badRequest('A data-alvo precisa ser posterior à data de início.');

  const histories = await loadExamHistories(ctx, [...new Set(eds.map((e) => e.exam_id))]);
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
    throw new ApiError(422, 'Ainda não há questões classificadas publicadas para as provas selecionadas. ' +
      'Dados insuficientes para montar um planner baseado no histórico.');
  }

  await saveSelection(ctx, userId, editionIds, params.primaryEditionId);

  const progress = await selectAll((a, b) => ctx.sb.from('subject_method_progress').select('subject_id, study_method_id').eq('user_id', userId).range(a, b));
  const cards = await selectAll<CardRow>((a, b) => ctx.sb.from('spaced_repetition_cards').select('*').eq('user_id', userId).range(a, b));
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
    methods: allMethods.map((m) => ({ id: m.id, code: m.code, activityType: m.activity_type, minutes: m.estimated_minutes })),
    subjects: subjects.map((s, i) => {
      const card = cardBySubject.get(s.subjectId);
      return {
        subjectId: s.subjectId,
        rank: s.rank,
        percentage: s.percentage,
        sizeFactor: factors[i],
        examDate: examDateFor(s),
        completedMethodIds: progress.filter((p: any) => p.subject_id === s.subjectId).map((p: any) => p.study_method_id),
        methodIds: choices.get(s.subjectId) ?? methods.map((m) => m.id),
        card: card ? { state: cardState(card), nextReview: card.next_review_at } : null,
      };
    }),
    examDates: eds.map((e) => e.exam_date).filter((d): d is string => !!d),
  });

  const primary = eds.find((e) => e.edition_id === params.primaryEditionId)!;
  const scheduledSet = new Set(schedule.scheduledSubjectIds);
  const planId = await rpc<string>(ctx, 'save_plan', {
    p: {
      name: `Planner ${editionLabel(primary)}`,
      start_date: startDate,
      end_date: endDate,
      primary_exam_edition_id: primary.edition_id,
      mode: eds.length > 1 ? 'multi' : 'single',
      algorithm_version: `${PRIORITY_VERSION}+${MEMORY_VERSION}`,
      scheduler_version: SCHEDULER_VERSION,
      settings_snapshot: { profile, methods: methods.map((m) => ({ id: m.id, code: m.code, minutes: m.estimated_minutes })), studyWeekdays: studyWeekdays(profile) },
      summary: {
        ...schedule.summary,
        weights,
        exams: examInputs.map((e) => ({
          editionId: e.editionId, label: e.label, examDate: e.examDate, editionsAnalyzed: e.stats.editionsAnalyzed,
          years: e.stats.years, totalQuestions: e.stats.totalQuestions, sufficiency: e.stats.sufficiency,
          message: sufficiencyMessage(e.stats.editionsAnalyzed), expectedTotalQuestions: e.expectedTotalQuestions,
        })),
      },
      exams: examInputs.map((e) => ({
        exam_edition_id: e.editionId, is_primary: e.isPrimary, weight: weightById.get(e.editionId)!.weight,
        exam_date: e.examDate, editions_analyzed: e.stats.editionsAnalyzed,
      })),
      subjects: subjects.map((s, i) => ({
        subject_id: s.subjectId, historical_frequency: s.weighted, historical_percentage: s.percentage,
        annual_average: s.annualAverage, years_present: s.editionsPresent, years_analyzed: s.editionsAnalyzed,
        recent_frequency: s.recentPercentage, priority_score: s.historicalScore, priority_rank: s.rank,
        priority_level: s.level, estimated_questions: s.estimatedQuestions, size_factor: factors[i],
        exam_date: examDateFor(s), scheduled: scheduledSet.has(s.subjectId), per_exam: s.perExam,
      })),
      activities: schedule.activities.map((a) => ({
        subject_id: a.subjectId, method_id: a.methodId, date: a.date, activity_type: a.activityType, minutes: a.minutes, priority: a.priority,
      })),
    },
  });
  await readjustCards(ctx, userId, planId);
  return planId;
}

/** Regera o planner com a mesma seleção, a partir de hoje. */
export async function replan(ctx: Ctx): Promise<string> {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const plan = await activePlan(ctx, userId);
  if (!plan) throw badRequest('Nenhum planner ativo.');
  const exams = await q(ctx.sb.from('study_plan_exams').select('exam_edition_id, is_primary, exam_date').eq('study_plan_id', plan.id));
  const primary = (exams as any[]).find((e) => e.is_primary) ?? exams[0];
  const hasFutureDate = (exams as any[]).some((e) => e.exam_date && e.exam_date > today);
  return generatePlan(ctx, {
    editionIds: (exams as any[]).map((e) => e.exam_edition_id),
    primaryEditionId: primary.exam_edition_id,
    startDate: today,
    targetDate: hasFutureDate ? null : plan.end_date,
  });
}

// ---------------------------------------------------------------------------
// Estado do planner
// ---------------------------------------------------------------------------

export interface CardRow {
  id: string; subject_id: string; stability: number; difficulty: number; interval_days: number;
  repetitions: number; lapses: number; last_review_at: string; next_review_at: ISODate | null; last_rating: Rating | null;
}

export const toISODateBR = (ts: string | Date): ISODate =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(typeof ts === 'string' ? new Date(ts) : ts);

export function cardState(c: CardRow): MemoryState {
  return { stability: Number(c.stability), difficulty: Number(c.difficulty), lastReview: toISODateBR(c.last_review_at), repetitions: c.repetitions, lapses: c.lapses };
}

export async function activePlan(ctx: Ctx, userId: string) {
  return q(ctx.sb.from('study_plans').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle()) as Promise<any | null>;
}

export type SubjectStatus = 'pending' | 'in_progress' | 'studied';

export interface PlanSubjectView {
  subjectId: string; name: string; area: string; specialty: string | null; rank: number; level: PriorityLevel; levelLabel: string;
  percentage: number; frequency: number; annualAverage: number; yearsPresent: number; yearsAnalyzed: number;
  recentPercentage: number; estimatedQuestions: number; sizeFactor: number; scheduled: boolean; examDate: ISODate | null;
  perExam: any[]; status: SubjectStatus; customActivities: boolean;
  checklist: { methodId: string; code: string; name: string; done: boolean; completedAt: string | null; scheduledDate: ISODate | null; minutes: number | null }[];
  progress: number;
  performance: { answered: number; correct: number; accuracy: number | null; lastQuestionAt: string | null };
  card: null | { id: string; stability: number; difficulty: number; repetitions: number; lapses: number; lastReview: ISODate; nextReview: ISODate | null; retrievability: number; lastRating: Rating | null };
  mastery: ReturnType<typeof estimateMastery>;
  dynamic: ReturnType<typeof dynamicPriority>;
  lastStudiedAt: string | null;
  nextScheduledDate: ISODate | null;
}

const num = (x: any) => (x == null ? x : Number(x));

export async function loadPlanState(ctx: Ctx, userId: string) {
  const today = ctx.today();
  const plan = await activePlan(ctx, userId);
  if (!plan) return null;

  const planExams = await q(ctx.sb.from('study_plan_exams').select('*').eq('study_plan_id', plan.id));
  const catalog = await q(ctx.sb.from('exam_catalog').select('edition_id, year, total_questions, exam_name, exam_total_questions, institution, exam_id')
    .in('edition_id', (planExams as any[]).map((e) => e.exam_edition_id)));
  const exams = (planExams as any[])
    .map((pe) => {
      const c: any = (catalog as any[]).find((x) => x.edition_id === pe.exam_edition_id) ?? {};
      return { ...pe, weight: Number(pe.weight), year: c.year, total_questions: c.total_questions, exam_name: c.exam_name ?? '—', exam_total_questions: c.exam_total_questions, institution: c.institution ?? '—', exam_id: c.exam_id };
    })
    .sort((a, b) => (a.exam_date ?? '9999').localeCompare(b.exam_date ?? '9999'));
  const planSubjects = await selectAll((a, b) => ctx.sb.from('study_plan_subjects').select('*').eq('study_plan_id', plan.id).order('priority_rank').range(a, b));
  const methods = await loadMethods(ctx, userId);
  const progress = await selectAll((a, b) => ctx.sb.from('subject_method_progress').select('*').eq('user_id', userId).range(a, b));
  const perf = await selectAll((a, b) => ctx.sb.from('user_subject_performance').select('*').eq('user_id', userId).range(a, b));
  const cards = await selectAll<CardRow>((a, b) => ctx.sb.from('spaced_repetition_cards').select('*').eq('user_id', userId).range(a, b));
  const sched = await selectAll((a, b) => ctx.sb.from('study_schedule').select('subject_id, study_method_id, scheduled_date, estimated_minutes, completed')
    .eq('study_plan_id', plan.id).neq('activity_type', 'review').range(a, b));

  const enabled = methods.filter((m) => m.enabled);
  const choices = await loadActivityChoices(ctx, userId);
  const info = await loadSubjectsInfo(ctx, planSubjects.map((s: any) => s.subject_id));
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
  const examByEdition = new Map(exams.map((e: any) => [e.exam_edition_id, e]));
  const maxHist = Math.max(...planSubjects.map((s: any) => Number(s.priority_score)), 0) || 1;

  const subjects: PlanSubjectView[] = planSubjects.map((s: any) => {
    const inf = info.get(s.subject_id);
    const prog = progBy.get(s.subject_id) ?? new Map();
    const scheduleRows = schedBy.get(s.subject_id) ?? [];
    const chosen = choices.get(s.subject_id);
    const subjectMethods = chosen ? methods.filter((m) => chosen.includes(m.id)) : enabled;
    const checklist = subjectMethods.map((m) => {
      const row = scheduleRows.find((r) => r.study_method_id === m.id);
      return {
        methodId: m.id, code: m.code, name: m.name, done: prog.has(m.id), completedAt: prog.get(m.id) ?? null,
        scheduledDate: row?.scheduled_date ?? null, minutes: row?.estimated_minutes ?? null,
      };
    });
    const doneCount = checklist.filter((c) => c.done).length;
    const status: SubjectStatus = doneCount === 0 ? 'pending' : doneCount === checklist.length ? 'studied' : 'in_progress';
    const p: any = perfBy.get(s.subject_id);
    const c = cardBy.get(s.subject_id);
    const r = c ? retrievability(Math.max(0, diffDays(today, toISODateBR(c.last_review_at))), Number(c.stability)) : null;
    const answered = p?.questions_answered ?? 0;
    const correct = p?.questions_correct ?? 0;
    const mastery = estimateMastery({ studied: status === 'studied' || !!c, questionsAnswered: answered, questionsCorrect: correct, retrievability: r });
    const proximity = Math.max(0, ...(s.per_exam as any[]).filter((x) => x.percentage > 0).map((x) => {
      const ex: any = examByEdition.get(x.editionId);
      if (!ex?.exam_date || Number(ex.weight) === 0) return 0;
      return 1 / (1 + Math.max(0, diffDays(ex.exam_date, today)) / 60);
    }));
    const dynamic = dynamicPriority({ historicalScore: Number(s.priority_score) / maxHist, proximity, retrievability: r, questionsAnswered: answered, questionsCorrect: correct });
    const lastDone = [...prog.values()].sort().pop() ?? null;
    const pendingDates = scheduleRows.filter((x) => !prog.has(x.study_method_id)).map((x) => x.scheduled_date).sort();
    return {
      subjectId: s.subject_id, name: inf?.name ?? '—', area: inf?.area ?? '—', specialty: inf?.specialty ?? null,
      rank: s.priority_rank, level: s.priority_level, levelLabel: LEVEL_LABEL[s.priority_level as PriorityLevel],
      percentage: num(s.historical_percentage), frequency: num(s.historical_frequency), annualAverage: num(s.annual_average),
      yearsPresent: s.years_present, yearsAnalyzed: s.years_analyzed, recentPercentage: num(s.recent_frequency),
      estimatedQuestions: num(s.estimated_questions), sizeFactor: num(s.size_factor), scheduled: s.scheduled, examDate: s.exam_date,
      perExam: s.per_exam, status, checklist, customActivities: !!chosen,
      progress: checklist.length ? doneCount / checklist.length : 0,
      performance: { answered, correct, accuracy: answered ? correct / answered : null, lastQuestionAt: p?.last_question_at ?? null },
      card: c ? {
        id: c.id, stability: Number(c.stability), difficulty: Number(c.difficulty), repetitions: c.repetitions, lapses: c.lapses,
        lastReview: toISODateBR(c.last_review_at), nextReview: c.next_review_at, retrievability: r!, lastRating: c.last_rating,
      } : null,
      mastery, dynamic,
      lastStudiedAt: [lastDone, c?.last_review_at ?? null].filter(Boolean).sort().pop() ?? null,
      nextScheduledDate: pendingDates[0] ?? null,
    };
  });

  return { plan, exams, subjects, methods: enabled };
}

// ---------------------------------------------------------------------------
// Checklist, questões e revisões
// ---------------------------------------------------------------------------

async function planSubjectRow(ctx: Ctx, userId: string, subjectId: string) {
  const plan = await activePlan(ctx, userId);
  if (!plan) return null;
  const row = await q(ctx.sb.from('study_plan_subjects').select('study_plan_id, exam_date').eq('study_plan_id', plan.id).eq('subject_id', subjectId).maybeSingle());
  return row as { study_plan_id: string; exam_date: ISODate | null } | null;
}

export async function setMethodDone(ctx: Ctx, subjectId: string, methodId: string, done: boolean) {
  const userId = await currentUserId(ctx);
  const ps = await planSubjectRow(ctx, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  await rpc(ctx, 'set_method_done', { p_subject: subjectId, p_method: methodId, p_done: done });
  return evaluateSubject(ctx, userId, subjectId, ps);
}

/**
 * Concluído = todas as atividades escolhidas para o assunto estão feitas.
 * Não existe atividade obrigatória (questões inclusive).
 */
async function evaluateSubject(ctx: Ctx, userId: string, subjectId: string, ps: { study_plan_id: string; exam_date: ISODate | null }) {
  const selected = await activitiesFor(ctx, userId, subjectId);
  const doneRows = await q(ctx.sb.from('subject_method_progress').select('study_method_id').eq('user_id', userId).eq('subject_id', subjectId));
  const doneSet = new Set((doneRows as any[]).map((r) => r.study_method_id));
  const studied = selected.length > 0 && selected.every((m) => doneSet.has(m));
  let cardCreated = false;
  if (studied) cardCreated = await ensureCard(ctx, userId, subjectId, ps.study_plan_id, ps.exam_date);
  await reflowSchedule(ctx, userId);
  return { studied, cardCreated };
}

/** Marca (ou desmarca) de uma vez todas as atividades escolhidas do assunto. */
export async function setSubjectDone(ctx: Ctx, subjectId: string, done: boolean) {
  const userId = await currentUserId(ctx);
  const ps = await planSubjectRow(ctx, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  for (const m of await activitiesFor(ctx, userId, subjectId)) {
    await rpc(ctx, 'set_method_done', { p_subject: subjectId, p_method: m, p_done: done });
  }
  return evaluateSubject(ctx, userId, subjectId, ps);
}

/** Escolhe as atividades de um assunto (null ou [] = voltar ao padrão). */
export async function setSubjectActivities(ctx: Ctx, subjectId: string, methodIds: string[] | null) {
  const userId = await currentUserId(ctx);
  const ps = await planSubjectRow(ctx, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  await rpc(ctx, 'set_subject_activities', { p_subject: subjectId, p_methods: methodIds ?? [] });
  return evaluateSubject(ctx, userId, subjectId, ps);
}

async function ensureCard(ctx: Ctx, userId: string, subjectId: string, planId: string, examDate: ISODate | null) {
  const today = ctx.today();
  const existing = await q(ctx.sb.from('spaced_repetition_cards').select('id').eq('user_id', userId).eq('subject_id', subjectId).maybeSingle());
  if (existing) return false;
  const perf: any = await q(ctx.sb.from('user_subject_performance').select('accuracy, questions_answered').eq('user_id', userId).eq('subject_id', subjectId).maybeSingle());
  const rating = initialRatingFromAccuracy(perf && perf.questions_answered >= MASTERY.minQuestionsForPerformance ? Number(perf.accuracy) : null);
  const res = review(null, rating, today, examDate);
  const card: any = await q(ctx.sb.from('spaced_repetition_cards').insert({
    subject_id: subjectId, study_plan_id: planId, stability: res.state.stability, difficulty: res.state.difficulty,
    retrievability: 1, interval_days: res.intervalDays, repetitions: res.state.repetitions, lapses: res.state.lapses,
    last_review_at: new Date().toISOString(), next_review_at: res.nextReview, last_rating: rating, algorithm_version: MEMORY_VERSION,
  }).select('id').single());
  await q(ctx.sb.from('review_logs').insert({
    spaced_repetition_card_id: card.id, subject_id: subjectId, rating, new_stability: res.state.stability,
    new_difficulty: res.state.difficulty, new_interval: res.intervalDays, scheduled_next_review: res.nextReview,
    days_until_exam: examDate ? diffDays(examDate, today) : null, algorithm_version: MEMORY_VERSION,
  }));
  return true;
}

export async function logPractice(ctx: Ctx, subjectId: string, body: { questions: number; correct: number; minutes?: number | null; source?: string | null }) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  if (body.correct > body.questions) throw badRequest('Acertos não podem ser maiores que o total de questões.');
  const ps = await planSubjectRow(ctx, userId, subjectId);
  if (!ps) throw badRequest('Assunto não pertence ao planner ativo.');
  await q(ctx.sb.from('question_practice_logs').insert({
    subject_id: subjectId, questions_count: body.questions, correct_count: body.correct,
    time_spent_minutes: body.minutes ?? null, source: body.source ?? null,
  }));
  // Marca o método "Questões" no checklist, se o usuário o utiliza
  // Se "Questões" é uma das atividades escolhidas para o assunto, ela fica marcada.
  const methods = await loadMethods(ctx, userId);
  const selected = await activitiesFor(ctx, userId, subjectId);
  const qm = methods.find((m) => m.code === 'questions' && selected.includes(m.id));
  let studied = false;
  if (qm) studied = (await setMethodDone(ctx, subjectId, qm.id, true)).studied;
  // Desempenho baixo antecipa a revisão
  let reviewAnticipated = false;
  if (body.correct / body.questions < MEMORY.lowAccuracyThreshold) {
    const tomorrow = addDays(today, 1);
    const updated = await q(ctx.sb.from('spaced_repetition_cards').update({ next_review_at: tomorrow })
      .eq('user_id', userId).eq('subject_id', subjectId).gt('next_review_at', tomorrow).select('id'));
    reviewAnticipated = (updated as any[]).length > 0;
  }
  const performance = await q(ctx.sb.from('user_subject_performance').select('*').eq('user_id', userId).eq('subject_id', subjectId).maybeSingle());
  return { performance: performance ? { ...(performance as any), accuracy: Number((performance as any).accuracy) } : null, studied, reviewAnticipated };
}

/** Momento do registro: agora (ou meio-dia do "hoje" simulado, nos testes). */
const stamp = (today: ISODate) => (toISODateBR(new Date()) === today ? new Date().toISOString() : `${today}T12:00:00-03:00`);

export async function rateReview(ctx: Ctx, subjectId: string, rating: Rating, timeSpentSeconds: number | null) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const card = (await q(ctx.sb.from('spaced_repetition_cards').select('*').eq('user_id', userId).eq('subject_id', subjectId).maybeSingle())) as CardRow | null;
  if (!card) throw badRequest('Este assunto ainda não tem revisões: conclua o checklist primeiro.');
  const ps = await planSubjectRow(ctx, userId, subjectId);
  const examDate = ps?.exam_date ?? null;
  const res = review(cardState(card), rating, today, examDate);
  await q(ctx.sb.from('spaced_repetition_cards').update({
    stability: res.state.stability, difficulty: res.state.difficulty, retrievability: res.retrievabilityAtReview,
    interval_days: res.intervalDays, repetitions: res.state.repetitions, lapses: res.state.lapses,
    last_review_at: stamp(today), next_review_at: res.nextReview, last_rating: rating, algorithm_version: MEMORY_VERSION,
  }).eq('id', card.id));
  const last: any = await q(ctx.sb.from('review_logs').select('id').eq('spaced_repetition_card_id', card.id)
    .is('actual_next_review', null).order('reviewed_at', { ascending: false }).limit(1).maybeSingle());
  if (last) await q(ctx.sb.from('review_logs').update({ actual_next_review: today }).eq('id', last.id));
  await q(ctx.sb.from('review_logs').insert({
    spaced_repetition_card_id: card.id, subject_id: subjectId, rating, reviewed_at: stamp(today),
    previous_stability: card.stability, new_stability: res.state.stability,
    previous_difficulty: card.difficulty, new_difficulty: res.state.difficulty,
    previous_interval: card.interval_days, new_interval: res.intervalDays, scheduled_next_review: res.nextReview,
    retrievability_at_review: res.retrievabilityAtReview, days_until_exam: examDate ? diffDays(examDate, today) : null,
    time_spent_seconds: timeSpentSeconds, algorithm_version: MEMORY_VERSION,
  }));
  return {
    previous: { stability: Number(card.stability), difficulty: Number(card.difficulty), interval: Number(card.interval_days), nextReview: card.next_review_at },
    next: { stability: res.state.stability, difficulty: res.state.difficulty, interval: res.intervalDays, nextReview: res.nextReview,
      targetRetention: res.targetRetention, cappedBy: res.cappedBy, retrievabilityAtReview: res.retrievabilityAtReview },
  };
}

/** Reajusta os prazos dos cartões conforme a prova se aproxima ou muda de data. */
export async function readjustCards(ctx: Ctx, userId: string, planId: string | null) {
  if (!planId) return 0;
  const today = ctx.today();
  const cards = await selectAll<CardRow>((a, b) => ctx.sb.from('spaced_repetition_cards').select('id, subject_id, next_review_at').eq('user_id', userId).range(a, b));
  if (!cards.length) return 0;
  const ps = await selectAll((a, b) => ctx.sb.from('study_plan_subjects').select('subject_id, exam_date').eq('study_plan_id', planId).range(a, b));
  const examBy = new Map(ps.map((p: any) => [p.subject_id, p.exam_date]));
  let changed = 0;
  for (const c of cards) {
    if (!examBy.has(c.subject_id)) continue;
    const adj = adjustDueDate(c.next_review_at, today, examBy.get(c.subject_id) ?? null);
    if (adj === c.next_review_at) continue;
    if (c.next_review_at && c.next_review_at <= today) continue; // vencidas continuam como atrasadas
    await q(ctx.sb.from('spaced_repetition_cards').update({ next_review_at: adj }).eq('id', c.id));
    changed++;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Planner dinâmico: fila de estudo e fila de revisões
// ---------------------------------------------------------------------------

/** Salva o limite de revisões por dia (coluna criada em 07_dynamic_planner.sql). */
export async function setReviewsPerDay(ctx: Ctx, n: number) {
  const userId = await currentUserId(ctx);
  await q(ctx.sb.from('study_profiles').update({ reviews_per_day: n }).eq('user_id', userId));
}

/**
 * O cronograma é uma fila. Depois de cada conclusão:
 *  - tarefa adiantada passa a constar no dia em que foi feita (histórico real);
 *  - o que está planejado para hoje (e o que está atrasado) fica onde está;
 *  - tudo o que vem depois é redistribuído a partir de amanhã, na ordem de
 *    prioridade, ocupando o espaço liberado — sem buracos.
 */
export async function reflowSchedule(ctx: Ctx, userId: string) {
  const today = ctx.today();
  const plan = await activePlan(ctx, userId);
  if (!plan) return;
  const tomorrow = addDays(today, 1);

  const progress = await selectAll((a, b) => ctx.sb.from('subject_method_progress').select('subject_id, study_method_id, completed_at').eq('user_id', userId).range(a, b)) as any[];
  const doneAt = new Map(progress.map((p) => [`${p.subject_id}|${p.study_method_id}`, toISODateBR(p.completed_at)]));
  const rows = await selectAll((a, b) => ctx.sb.from('study_schedule').select('id, subject_id, study_method_id, scheduled_date, completed')
    .eq('study_plan_id', plan.id).neq('activity_type', 'review').range(a, b)) as any[];

  // 1) Adiantadas: registradas no dia real da conclusão
  const moveTo = new Map<ISODate, string[]>();
  for (const r of rows) {
    const d = doneAt.get(`${r.subject_id}|${r.study_method_id}`);
    if (r.completed && d && r.scheduled_date !== d && r.scheduled_date > today) {
      if (!moveTo.has(d)) moveTo.set(d, []);
      moveTo.get(d)!.push(r.id);
    }
  }
  for (const [d, ids] of moveTo) {
    for (let i = 0; i < ids.length; i += 40) await q(ctx.sb.from('study_schedule').update({ scheduled_date: d }).in('id', ids.slice(i, i + 40)));
  }

  if (tomorrow >= plan.end_date) return;

  // 2) Hoje e atrasadas ficam; o futuro é redistribuído
  const kept = new Set(rows.filter((r) => !r.completed && r.scheduled_date <= today).map((r) => `${r.subject_id}|${r.study_method_id}`));
  const profile = await loadProfile(ctx, userId);
  const allMethods = await loadMethods(ctx, userId);
  const enabledIds = allMethods.filter((m) => m.enabled).map((m) => m.id);
  const choices = await loadActivityChoices(ctx, userId);
  const ps = await selectAll((a, b) => ctx.sb.from('study_plan_subjects').select('subject_id, priority_rank, historical_percentage, size_factor, exam_date, scheduled')
    .eq('study_plan_id', plan.id).range(a, b)) as any[];
  const cards = await selectAll<CardRow>((a, b) => ctx.sb.from('spaced_repetition_cards').select('*').eq('user_id', userId).range(a, b));
  const cardBy = new Map(cards.map((c) => [c.subject_id, c]));
  const planExams = await q(ctx.sb.from('study_plan_exams').select('exam_date').eq('study_plan_id', plan.id)) as any[];

  const schedule = buildSchedule({
    startDate: tomorrow,
    endDate: plan.end_date,
    dailyMinutes: Math.round(profile.daily_hours * 60),
    studyWeekdays: studyWeekdays(profile),
    questionsPerDay: profile.questions_per_day,
    methods: allMethods.map((m) => ({ id: m.id, code: m.code, activityType: m.activity_type, minutes: m.estimated_minutes })),
    subjects: ps.map((s) => {
      const card = cardBy.get(s.subject_id);
      const methodIds = choices.get(s.subject_id) ?? enabledIds;
      return {
        subjectId: s.subject_id,
        rank: s.priority_rank,
        percentage: Number(s.historical_percentage),
        sizeFactor: Number(s.size_factor),
        examDate: s.exam_date,
        completedMethodIds: methodIds.filter((m) => doneAt.has(`${s.subject_id}|${m}`) || kept.has(`${s.subject_id}|${m}`)),
        methodIds,
        card: card ? { state: cardState(card), nextReview: card.next_review_at } : null,
      };
    }),
    examDates: planExams.map((e) => e.exam_date).filter(Boolean),
  });

  await q(ctx.sb.from('study_schedule').delete().eq('study_plan_id', plan.id).eq('completed', false)
    .gt('scheduled_date', today).neq('activity_type', 'review'));
  if (schedule.activities.length) {
    await q(ctx.sb.from('study_schedule').insert(schedule.activities.map((a) => ({
      user_id: userId, study_plan_id: plan.id, subject_id: a.subjectId, study_method_id: a.methodId, scheduled_date: a.date,
      activity_type: a.activityType, estimated_minutes: a.minutes, priority: a.priority,
    }))));
  }
  // "Fora do tempo disponível": só o que mudou, em lotes (URLs curtas)
  const unscheduled = new Set(schedule.unscheduledSubjectIds);
  for (const flag of [true, false]) {
    const ids = ps.filter((x) => x.scheduled !== flag && unscheduled.has(x.subject_id) !== flag).map((x) => x.subject_id);
    for (let i = 0; i < ids.length; i += 40) {
      await q(ctx.sb.from('study_plan_subjects').update({ scheduled: flag }).eq('study_plan_id', plan.id).in('subject_id', ids.slice(i, i + 40)));
    }
  }
}

/** Revisões já feitas hoje (a primeira, registrada ao concluir o assunto, não conta). */
export async function reviewsDoneOn(ctx: Ctx, userId: string, day: ISODate) {
  const logs = await q(ctx.sb.from('review_logs').select('subject_id, previous_interval')
    .eq('user_id', userId).gte('reviewed_at', `${day}T00:00:00-03:00`).lt('reviewed_at', `${addDays(day, 1)}T00:00:00-03:00`)) as any[];
  return new Set(logs.filter((l) => l.previous_interval != null).map((l) => l.subject_id)).size;
}

/** Fila de revisões: subjectId → dia em que a revisão aparece no planner. */
export async function reviewPlan(ctx: Ctx, userId: string, subjects: PlanSubjectView[]) {
  const today = ctx.today();
  const profile = await loadProfile(ctx, userId);
  const items = subjects.filter((s) => s.card?.nextReview).map((s) => ({
    id: s.subjectId, due: s.card!.nextReview!, score: s.dynamic.score, examDate: s.examDate,
  }));
  return assignReviews(items, {
    today, perDay: profile.reviews_per_day, studyWeekdays: studyWeekdays(profile), doneToday: await reviewsDoneOn(ctx, userId, today),
  });
}
