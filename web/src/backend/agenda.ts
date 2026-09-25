/** "O que estudar hoje?", calendário de revisões, dashboard e desempenho. */
import { MASTERY, SCHEDULER } from '../../../shared/config';
import { addDays, diffDays, eachDay, weekday, type ISODate } from '../../../shared/dates';
import { reviewMinutes } from '../../../shared/scheduler';
import { dominatedQuestions } from '../../../shared/mastery';
import { currentUserId, selectAll, type Ctx } from './core';
import { editionLabel, loadMethods, reviewPlan, loadPlanState, loadProfile, readjustCards, selectedEditions, studyWeekdays, toISODateBR, type PlanSubjectView } from './planner';

/** Limites [início, fim) de um dia no fuso de Brasília. */
const dayBounds = (d: ISODate) => [`${d}T00:00:00-03:00`, `${addDays(d, 1)}T00:00:00-03:00`] as const;

export async function todayView(ctx: Ctx) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  let state = await loadPlanState(ctx, userId);
  if (!state) return null;
  if ((await readjustCards(ctx, userId, state.plan.id)) > 0) state = (await loadPlanState(ctx, userId))!;
  const { plan, subjects } = state;
  const profile = await loadProfile(ctx, userId);
  const capacity = Math.round(profile.daily_hours * 60);
  const isStudyDay = studyWeekdays(profile).includes(weekday(today));
  const byId = new Map(subjects.map((s) => [s.subjectId, s]));

  // Fila de revisões: no máximo N por dia (escolha do aluno), as mais antigas primeiro
  const queue = await reviewPlan(ctx, userId, subjects);
  const reviewsDue = subjects
    .filter((s) => queue.get(s.subjectId) === today)
    .map((s) => ({
      kind: 'review' as const, subjectId: s.subjectId, name: s.name, area: s.area, rank: s.rank, level: s.level,
      levelLabel: s.levelLabel, minutes: reviewMinutes(s.sizeFactor), dueDate: s.card!.nextReview!,
      overdueDays: Math.max(0, diffDays(today, s.card!.nextReview!)), retrievability: s.card!.retrievability, score: s.dynamic.score,
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays || b.score - a.score);
  // Próximas da fila (para "adiantar revisão")
  const nextReviews = subjects
    .filter((s) => { const d = queue.get(s.subjectId); return d && d > today; })
    .sort((a, b) => queue.get(a.subjectId)!.localeCompare(queue.get(b.subjectId)!) || b.dynamic.score - a.dynamic.score)
    .slice(0, 5).map((s) => ({ subjectId: s.subjectId, name: s.name, area: s.area, date: queue.get(s.subjectId) }));

  const methodName = new Map((await loadMethods(ctx, userId)).map((m) => [m.id, m.name]));
  const doneKeys = new Set(subjects.flatMap((s) => s.checklist.filter((c) => c.done).map((c) => `${s.subjectId}|${c.methodId}`)));
  // Só as atividades escolhidas para cada assunto contam (ver subject_activity_choices)
  const chosenKeys = new Set(subjects.flatMap((s) => s.checklist.map((c) => `${s.subjectId}|${c.methodId}`)));
  const pending = (await selectAll((a, b) => ctx.sb.from('study_schedule')
    .select('id, subject_id, study_method_id, scheduled_date, estimated_minutes, activity_type, priority')
    .eq('study_plan_id', plan.id).eq('completed', false).lte('scheduled_date', today)
    .order('scheduled_date').order('priority').range(a, b)) as any[])
    .filter((p) => chosenKeys.has(`${p.subject_id}|${p.study_method_id}`) && !doneKeys.has(`${p.subject_id}|${p.study_method_id}`));

  const groups = new Map<string, any[]>();
  for (const p of pending) {
    if (!groups.has(p.subject_id)) groups.set(p.subject_id, []);
    groups.get(p.subject_id)!.push(p);
  }
  const newSubjects = [...groups.entries()]
    .map(([subjectId, items]) => {
      const s = byId.get(subjectId);
      return {
        kind: 'study' as const, subjectId, name: s?.name ?? '—', area: s?.area ?? '—', rank: s?.rank ?? 999,
        level: s?.level, levelLabel: s?.levelLabel,
        minutes: items.reduce((t, i) => t + i.estimated_minutes, 0),
        overdue: items.some((i) => i.scheduled_date < today),
        oldestDate: items[0].scheduled_date,
        methods: items.map((i) => ({ scheduleId: i.id, methodId: i.study_method_id, name: methodName.get(i.study_method_id) ?? '—', minutes: i.estimated_minutes, date: i.scheduled_date })),
        percentage: s?.percentage ?? 0,
      };
    })
    .sort((a, b) => Number(a.overdue) - Number(b.overdue) || a.rank - b.rank);

  const qMinutes = Math.min(profile.questions_per_day * SCHEDULER.minutesPerQuestion, Math.floor(capacity * SCHEDULER.maxDailyQuestionsShare));
  const qCount = Math.floor(qMinutes / SCHEDULER.minutesPerQuestion);
  const candidates = subjects.filter((s) => s.status !== 'pending').sort((a, b) => b.dynamic.score - a.dynamic.score).slice(0, 3);
  const shares = [[1], [0.6, 0.4], [0.5, 0.3, 0.2]][candidates.length - 1] ?? [];
  const practice = qCount > 0 ? candidates.map((s, i) => ({
    subjectId: s.subjectId, name: s.name, questions: Math.max(1, Math.round(qCount * shares[i])), accuracy: s.performance.accuracy,
    reason: s.performance.accuracy != null && s.performance.accuracy < 0.7 ? 'Desempenho abaixo de 70%' : 'Maior prioridade dinâmica entre os assuntos já estudados',
  })) : [];

  // Controle de carga: revisões atrasadas → revisões → novos (ranking) → novos atrasados
  let used = isStudyDay ? qMinutes : 0;
  const fit = <T extends { minutes: number }>(item: T) => {
    const overflow = used + item.minutes > capacity;
    if (!overflow) used += item.minutes;
    return { ...item, overflow };
  };
  const reviews = reviewsDue.map(fit);
  const onTime = newSubjects.filter((n) => !n.overdue).map(fit);
  const late = newSubjects.filter((n) => n.overdue).map(fit);
  return {
    today, isStudyDay, capacityMinutes: capacity, plannedMinutes: used,
    questions: { perDay: qCount, minutes: qMinutes, suggestions: practice },
    reviews, nextReviews, reviewsPerDay: profile.reviews_per_day, newSubjects: [...onTime, ...late],
    overdueReviews: reviews.filter((r) => r.overdueDays > 0).length,
    overdueActivities: late.length,
  };
}

export async function calendarView(ctx: Ctx, from: ISODate, to: ISODate) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const state = await loadPlanState(ctx, userId);
  if (!state) return null;
  const { plan, subjects } = state;
  const days = new Map<ISODate, { date: ISODate; reviews: any[]; newSubjects: any[]; exams: string[] }>();
  for (const d of eachDay(from, to)) days.set(d, { date: d, reviews: [], newSubjects: [], exams: [] });
  const push = (date: ISODate, key: 'reviews' | 'newSubjects', v: any) => days.get(date)?.[key].push(v);
  const byId = new Map(subjects.map((s) => [s.subjectId, s]));

  // Revisões feitas (a primeira, registrada ao concluir o assunto, não é uma revisão)
  const logs = await selectAll((a, b) => ctx.sb.from('review_logs').select('subject_id, reviewed_at, rating, previous_interval')
    .eq('user_id', userId).gte('reviewed_at', dayBounds(from)[0]).lt('reviewed_at', dayBounds(to)[1]).range(a, b));
  const seen = new Set<string>();
  for (const l of logs as any[]) {
    if (l.previous_interval == null) continue;
    const d = toISODateBR(l.reviewed_at);
    if (seen.has(`${d}|${l.subject_id}`)) continue;
    seen.add(`${d}|${l.subject_id}`);
    push(d, 'reviews', { subjectId: l.subject_id, name: byId.get(l.subject_id)?.name ?? '—', area: byId.get(l.subject_id)?.area, status: 'done', rating: l.rating });
  }

  // Revisões pendentes: a fila (limite diário escolhido pelo aluno)
  const queue = await reviewPlan(ctx, userId, subjects);
  for (const s of subjects) {
    const d = queue.get(s.subjectId);
    if (!d || !s.card?.nextReview) continue;
    push(d, 'reviews', { subjectId: s.subjectId, name: s.name, area: s.area, status: s.card.nextReview < today ? 'overdue' : 'scheduled',
      dueDate: s.card.nextReview, overdueDays: Math.max(0, diffDays(today, s.card.nextReview)) });
  }

  // Estudo: pendente no dia planejado; feito no dia em que foi feito (histórico real)
  const methodName = new Map((await loadMethods(ctx, userId)).map((m) => [m.id, m.name]));
  const sched = await selectAll((a, b) => ctx.sb.from('study_schedule').select('subject_id, study_method_id, scheduled_date, estimated_minutes')
    .eq('study_plan_id', plan.id).eq('completed', false).neq('activity_type', 'review').gte('scheduled_date', from).lte('scheduled_date', to).order('priority').range(a, b));
  const items: { date: ISODate; subjectId: string; methodId: string; done: boolean; at?: string | null }[] = [];
  const pendingKeys = new Set<string>();
  for (const s of subjects) {
    for (const c of s.checklist) {
      if (!c.done) { pendingKeys.add(`${s.subjectId}|${c.methodId}`); continue; }
      const d = c.completedAt ? toISODateBR(c.completedAt) : null;
      if (d && d >= from && d <= to) items.push({ date: d, subjectId: s.subjectId, methodId: c.methodId, done: true, at: c.completedAt });
    }
  }
  for (const r of sched as any[]) {
    if (pendingKeys.has(`${r.subject_id}|${r.study_method_id}`)) items.push({ date: r.scheduled_date, subjectId: r.subject_id, methodId: r.study_method_id, done: false });
  }
  const grouped = new Map<string, any>();
  for (const it of items) {
    const key = `${it.date}|${it.subjectId}`;
    if (!grouped.has(key)) {
      const s = byId.get(it.subjectId);
      grouped.set(key, { date: it.date, subjectId: it.subjectId, name: s?.name ?? '—', area: s?.area, specialty: s?.specialty, rank: s?.rank ?? 999,
        methods: [], methodIds: [], done: true, doneAt: null, studied: s?.status === 'studied', progress: s?.progress ?? 0, totalActivities: s?.checklist.length ?? 0 });
    }
    const g = grouped.get(key);
    g.methods.push(methodName.get(it.methodId) ?? '—');
    g.methodIds.push(it.methodId);
    g.done = g.done && it.done;
    if (it.at && (!g.doneAt || it.at > g.doneAt)) g.doneAt = it.at;
  }
  for (const g of [...grouped.values()].sort((a, b) => Number(b.done) - Number(a.done) || a.rank - b.rank)) push(g.date, 'newSubjects', g);
  for (const e of state.exams as any[]) if (e.exam_date && days.has(e.exam_date)) days.get(e.exam_date)!.exams.push(e.institution);
  return { from, to, today, planEnd: plan.end_date, days: [...days.values()] };
}

export function examDominated(subjects: PlanSubjectView[], editionId: string) {
  return dominatedQuestions(subjects.map((s) => ({
    estimatedQuestions: (s.perExam.find((p: any) => p.editionId === editionId)?.estimatedQuestions as number) ?? 0,
    mastery: s.mastery.mastery,
  })));
}

async function questionTotals(ctx: Ctx, userId: string) {
  const perf = await selectAll((a, b) => ctx.sb.from('user_subject_performance').select('questions_answered, questions_correct').eq('user_id', userId).range(a, b));
  const answered = (perf as any[]).reduce((t, p) => t + p.questions_answered, 0);
  const correct = (perf as any[]).reduce((t, p) => t + p.questions_correct, 0);
  return { answered, correct, accuracy: answered ? correct / answered : null };
}

export async function dashboardView(ctx: Ctx) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const state = await loadPlanState(ctx, userId);
  const selection = await selectedEditions(ctx, userId);
  const profile = await loadProfile(ctx, userId);
  const questions = await questionTotals(ctx, userId);
  const upcoming = selection.filter((e) => e.exam_date && e.exam_date >= today).sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const next = selection.find((e) => e.is_primary && e.exam_date && e.exam_date >= today) ?? upcoming[0] ?? null;
  const nextExam = next ? { label: editionLabel(next), date: next.exam_date, daysLeft: diffDays(next.exam_date!, today) } : null;

  if (!state) return { hasPlan: false, profileConfigured: profile.configured, selectedExams: selection.length, nextExam, questions };
  const { subjects, exams, methods } = state;
  const totalBlocks = subjects.length * methods.length;
  const doneBlocks = subjects.reduce((t, s) => t + s.checklist.filter((c) => c.done).length, 0);
  const studied = subjects.filter((s) => s.status === 'studied');
  const [start, end] = dayBounds(today);
  const { count: doneToday } = await ctx.sb.from('review_logs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).not('previous_stability', 'is', null).gte('reviewed_at', start).lt('reviewed_at', end);

  const dominated = (exams as any[]).map((e) => ({
    editionId: e.exam_edition_id,
    label: e.institution,
    examName: e.exam_name,
    examDate: e.exam_date,
    daysLeft: e.exam_date ? diffDays(e.exam_date, today) : null,
    isPrimary: e.is_primary,
    totalQuestions: e.total_questions ?? e.exam_total_questions ?? state.plan.summary.exams?.find((x: any) => x.editionId === e.exam_edition_id)?.expectedTotalQuestions ?? null,
    dominated: examDominated(subjects, e.exam_edition_id),
    editionsAnalyzed: e.editions_analyzed,
  }));

  return {
    hasPlan: true,
    profileConfigured: profile.configured,
    selectedExams: selection.length,
    plan: { id: state.plan.id, name: state.plan.name, startDate: state.plan.start_date, endDate: state.plan.end_date, mode: state.plan.mode, algorithm: state.plan.algorithm_version, warnings: state.plan.summary.warnings ?? [] },
    nextExam,
    progress: totalBlocks ? doneBlocks / totalBlocks : 0,
    subjects: { total: subjects.length, studied: studied.length, inProgress: subjects.filter((s) => s.status === 'in_progress').length, pending: subjects.filter((s) => s.status === 'pending').length, unscheduled: subjects.filter((s) => !s.scheduled).length },
    reviews: {
      today: subjects.filter((s) => s.card?.nextReview === today).length,
      overdue: subjects.filter((s) => s.card?.nextReview && s.card.nextReview < today).length,
      doneToday: doneToday ?? 0,
    },
    questions,
    coverage: { studied: studied.reduce((t, s) => t + s.percentage, 0), scheduled: subjects.filter((s) => s.scheduled).reduce((t, s) => t + s.percentage, 0) },
    dominated,
    nextSubjects: subjects.filter((s) => s.status !== 'studied' && s.scheduled).slice(0, 5)
      .map((s) => ({ subjectId: s.subjectId, name: s.name, rank: s.rank, levelLabel: s.levelLabel, percentage: s.percentage, progress: s.progress })),
    masteryNote: `Domínio estimado = acerto suavizado (${MASTERY.priorWeight} questões fictícias a 50%) × memória atual. Assunto estudado sem questões registradas conta ${Math.round(MASTERY.studiedWithoutQuestions * 100)}%.`,
  };
}

export async function performanceView(ctx: Ctx) {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const state = await loadPlanState(ctx, userId);
  const allLogs = await selectAll((a, b) => ctx.sb.from('question_practice_logs')
    .select('id, subject_id, questions_count, correct_count, time_spent_minutes, practiced_at, subjects(name)')
    .eq('user_id', userId).order('practiced_at', { ascending: false }).range(a, b));
  const since = addDays(today, -90);
  const byDay = new Map<string, { date: string; questions: number; correct: number }>();
  for (const l of allLogs as any[]) {
    const d = toISODateBR(l.practiced_at);
    if (d < since) continue;
    const x = byDay.get(d) ?? { date: d, questions: 0, correct: 0 };
    x.questions += l.questions_count;
    x.correct += l.correct_count;
    byDay.set(d, x);
  }
  const history = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const reviewRows = await selectAll((a, b) => ctx.sb.from('review_logs').select('rating').eq('user_id', userId).not('previous_stability', 'is', null).range(a, b));
  const counts = new Map<string, number>();
  for (const r of reviewRows as any[]) counts.set(r.rating, (counts.get(r.rating) ?? 0) + 1);
  const ratings = [...counts.entries()].map(([rating, n]) => ({ rating, n }));
  const logs = (allLogs as any[]).slice(0, 50).map((l) => ({ ...l, name: l.subjects?.name ?? '—' }));
  if (!state) return { hasPlan: false, history, ratings, logs, subjects: [], areas: [] };

  const areas = new Map<string, { area: string; answered: number; correct: number; subjects: number; studied: number; percentage: number }>();
  for (const s of state.subjects) {
    const a = areas.get(s.area) ?? { area: s.area, answered: 0, correct: 0, subjects: 0, studied: 0, percentage: 0 };
    a.answered += s.performance.answered;
    a.correct += s.performance.correct;
    a.subjects += 1;
    a.studied += s.status === 'studied' ? 1 : 0;
    a.percentage += s.percentage;
    areas.set(s.area, a);
  }
  return {
    hasPlan: true, history, ratings, logs,
    areas: [...areas.values()].sort((a, b) => b.percentage - a.percentage),
    subjects: state.subjects.map((s) => ({
      subjectId: s.subjectId, name: s.name, area: s.area, rank: s.rank, status: s.status,
      answered: s.performance.answered, correct: s.performance.correct, accuracy: s.performance.accuracy,
      mastery: s.mastery.mastery, retrievability: s.card?.retrievability ?? null, nextReview: s.card?.nextReview ?? null,
      estimatedQuestions: s.estimatedQuestions,
    })),
  };
}
