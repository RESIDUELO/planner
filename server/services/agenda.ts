/**
 * "O que estudar hoje?", calendário de revisões, dashboard e desempenho.
 */
import { many, type Db } from '../db';
import { loadPlanState, loadProfile, studyWeekdays, readjustCards, selectedEditions, editionLabel, type PlanSubjectView } from './planner';
import { SCHEDULER, MASTERY } from '../../shared/config';
import { addDays, diffDays, eachDay, weekday, type ISODate } from '../../shared/dates';
import { projectReviews, review, type MemoryState } from '../../shared/memory';
import { reviewMinutes } from '../../shared/scheduler';
import { dominatedQuestions } from '../../shared/mastery';

export async function todayView(db: Db, userId: string, today: ISODate) {
  const plan0 = await loadPlanState(db, userId, today);
  if (!plan0) return null;
  if ((await readjustCards(db, userId, plan0.plan.id, today)) > 0) {
    return todayView(db, userId, today);
  }
  const { plan, subjects } = plan0;
  const profile = await loadProfile(db, userId, today);
  const capacity = Math.round(profile.daily_hours * 60);
  const isStudyDay = studyWeekdays(profile).includes(weekday(today));

  const byId = new Map(subjects.map((s) => [s.subjectId, s]));
  const reviewsDue = subjects
    .filter((s) => s.card?.nextReview && s.card.nextReview <= today)
    .map((s) => ({
      kind: 'review' as const,
      subjectId: s.subjectId,
      name: s.name,
      area: s.area,
      rank: s.rank,
      level: s.level,
      levelLabel: s.levelLabel,
      minutes: reviewMinutes(s.sizeFactor),
      dueDate: s.card!.nextReview!,
      overdueDays: diffDays(today, s.card!.nextReview!),
      retrievability: s.card!.retrievability,
      score: s.dynamic.score,
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays || b.score - a.score);

  const pending = await many<{ id: string; subject_id: string; study_method_id: string; scheduled_date: ISODate; estimated_minutes: number; activity_type: string; method_name: string }>(
    db,
    `select s.id, s.subject_id, s.study_method_id, s.scheduled_date, s.estimated_minutes, s.activity_type, m.name as method_name
       from public.study_schedule s join public.study_methods m on m.id = s.study_method_id
      where s.study_plan_id = $1 and not s.completed and s.scheduled_date <= $2
        and not exists (select 1 from public.subject_method_progress p
                         where p.user_id = s.user_id and p.subject_id = s.subject_id and p.study_method_id = s.study_method_id)
      order by s.scheduled_date, s.priority`,
    [plan.id, today],
  );
  const groups = new Map<string, { subjectId: string; items: typeof pending }>();
  for (const p of pending) {
    if (!groups.has(p.subject_id)) groups.set(p.subject_id, { subjectId: p.subject_id, items: [] });
    groups.get(p.subject_id)!.items.push(p);
  }
  const newSubjects = [...groups.values()]
    .map((g) => {
      const s = byId.get(g.subjectId)!;
      return {
        kind: 'study' as const,
        subjectId: g.subjectId,
        name: s?.name ?? '—',
        area: s?.area ?? '—',
        rank: s?.rank ?? 999,
        level: s?.level,
        levelLabel: s?.levelLabel,
        minutes: g.items.reduce((t, i) => t + i.estimated_minutes, 0),
        overdue: g.items.some((i) => i.scheduled_date < today),
        oldestDate: g.items[0].scheduled_date,
        methods: g.items.map((i) => ({ scheduleId: i.id, methodId: i.study_method_id, name: i.method_name, minutes: i.estimated_minutes, date: i.scheduled_date })),
        percentage: s?.percentage ?? 0,
      };
    })
    .sort((a, b) => Number(a.overdue) - Number(b.overdue) || a.rank - b.rank);

  // Questões do dia (limitadas a uma fração da capacidade)
  const qMinutes = Math.min(profile.questions_per_day * SCHEDULER.minutesPerQuestion, Math.floor(capacity * SCHEDULER.maxDailyQuestionsShare));
  const qCount = Math.floor(qMinutes / SCHEDULER.minutesPerQuestion);
  const practiceCandidates = subjects
    .filter((s) => s.status !== 'pending')
    .sort((a, b) => b.dynamic.score - a.dynamic.score)
    .slice(0, 3);
  const shares = [[1], [0.6, 0.4], [0.5, 0.3, 0.2]][practiceCandidates.length - 1] ?? [];
  const practice = qCount > 0 ? practiceCandidates.map((s, i) => ({
    subjectId: s.subjectId,
    name: s.name,
    questions: Math.max(1, Math.round(qCount * shares[i])),
    accuracy: s.performance.accuracy,
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
    today,
    isStudyDay,
    capacityMinutes: capacity,
    plannedMinutes: used,
    questions: { perDay: qCount, minutes: qMinutes, suggestions: practice },
    reviews,
    newSubjects: [...onTime, ...late],
    overdueReviews: reviews.filter((r) => r.overdueDays > 0).length,
    overdueActivities: late.length,
  };
}

export async function calendarView(db: Db, userId: string, from: ISODate, to: ISODate, today: ISODate) {
  const state = await loadPlanState(db, userId, today);
  if (!state) return null;
  const { plan, subjects } = state;
  const lastDay = addDays(plan.end_date, -1);
  const days = new Map<ISODate, { date: ISODate; reviews: any[]; newSubjects: any[]; exams: string[] }>();
  for (const d of eachDay(from, to)) days.set(d, { date: d, reviews: [], newSubjects: [], exams: [] });
  const push = (date: ISODate, key: 'reviews' | 'newSubjects', v: any) => days.get(date)?.[key].push(v);

  // Revisões feitas (histórico)
  const logs = await many<{ subject_id: string; reviewed_at: string; rating: string }>(db,
    `select subject_id, reviewed_at, rating from public.review_logs
      where user_id = $1 and reviewed_at >= ($2::date - 1) and reviewed_at < ($3::date + 2)`, [userId, from, to]);
  const byId = new Map(subjects.map((s) => [s.subjectId, s]));
  for (const l of logs) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(l.reviewed_at));
    const s = byId.get(l.subject_id);
    push(d, 'reviews', { subjectId: l.subject_id, name: s?.name ?? '—', status: 'done', rating: l.rating });
  }

  // Revisões futuras: reais (cartões) + previstas
  for (const s of subjects) {
    if (s.card) {
      const due = s.card.nextReview;
      if (!due) continue;
      if (due < today) {
        push(today, 'reviews', { subjectId: s.subjectId, name: s.name, status: 'overdue', dueDate: due, overdueDays: diffDays(today, due) });
        continue;
      }
      const state: MemoryState = { stability: s.card.stability, difficulty: s.card.difficulty, lastReview: s.card.lastReview, repetitions: s.card.repetitions, lapses: s.card.lapses };
      const dates = projectReviews(state, due, s.examDate, lastDay);
      dates.forEach((d, i) => push(d, 'reviews', { subjectId: s.subjectId, name: s.name, status: i === 0 ? 'scheduled' : 'projected' }));
    } else {
      const last = s.checklist.map((c) => c.scheduledDate).filter(Boolean).sort().pop() as ISODate | undefined;
      if (!last || !s.scheduled) continue;
      const start = last < today ? today : last;
      const first = review(null, 'good', start, s.examDate);
      projectReviews(first.state, first.nextReview, s.examDate, lastDay)
        .forEach((d) => push(d, 'reviews', { subjectId: s.subjectId, name: s.name, status: 'projected' }));
    }
  }

  // Novos assuntos agendados
  const sched = await many<{ subject_id: string; scheduled_date: ISODate; method_name: string; completed: boolean; estimated_minutes: number }>(db,
    `select s.subject_id, s.scheduled_date, m.name as method_name, s.completed, s.estimated_minutes
       from public.study_schedule s join public.study_methods m on m.id = s.study_method_id
      where s.study_plan_id = $1 and s.scheduled_date between $2 and $3
      order by s.priority`, [plan.id, from, to]);
  const grouped = new Map<string, any>();
  for (const r of sched) {
    const key = `${r.scheduled_date}|${r.subject_id}`;
    if (!grouped.has(key)) {
      const s = byId.get(r.subject_id);
      grouped.set(key, { date: r.scheduled_date, subjectId: r.subject_id, name: s?.name ?? '—', rank: s?.rank, methods: [], minutes: 0, completed: true });
    }
    const g = grouped.get(key);
    g.methods.push(r.method_name);
    g.minutes += r.estimated_minutes;
    g.completed = g.completed && r.completed;
  }
  for (const g of grouped.values()) push(g.date, 'newSubjects', g);

  for (const e of state.exams as any[]) {
    if (e.exam_date && days.has(e.exam_date)) days.get(e.exam_date)!.exams.push(`${e.institution} ${e.year}`);
  }
  return { from, to, today, planEnd: plan.end_date, days: [...days.values()] };
}

export function examDominated(subjects: PlanSubjectView[], editionId: string) {
  return dominatedQuestions(subjects.map((s) => ({
    estimatedQuestions: (s.perExam.find((p: any) => p.editionId === editionId)?.estimatedQuestions as number) ?? 0,
    mastery: s.mastery.mastery,
  })));
}

export async function dashboardView(db: Db, userId: string, today: ISODate) {
  const state = await loadPlanState(db, userId, today);
  const selection = await selectedEditions(db, userId);
  const profile = await loadProfile(db, userId, today);
  const totals = await many<{ answered: number; correct: number }>(db,
    `select coalesce(sum(questions_answered),0)::int as answered, coalesce(sum(questions_correct),0)::int as correct
       from public.user_subject_performance where user_id = $1`, [userId]);
  const answered = totals[0]?.answered ?? 0;
  const correct = totals[0]?.correct ?? 0;

  const upcoming = selection
    .filter((e) => e.exam_date && e.exam_date >= today)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : 1));
  const next = selection.find((e) => e.is_primary && e.exam_date && e.exam_date >= today) ?? upcoming[0] ?? null;

  if (!state) {
    return {
      hasPlan: false,
      profileConfigured: profile.configured,
      selectedExams: selection.length,
      nextExam: next ? { label: editionLabel(next), date: next.exam_date, daysLeft: diffDays(next.exam_date!, today) } : null,
      questions: { answered, correct, accuracy: answered ? correct / answered : null },
    };
  }
  const { subjects, exams, methods } = state;
  const totalBlocks = subjects.length * methods.length;
  const doneBlocks = subjects.reduce((t, s) => t + s.checklist.filter((c) => c.done).length, 0);
  const studied = subjects.filter((s) => s.status === 'studied');
  const reviewsToday = subjects.filter((s) => s.card?.nextReview === today).length;
  const overdue = subjects.filter((s) => s.card?.nextReview && s.card.nextReview < today).length;
  const doneToday = await many<{ n: number }>(db,
    `select count(*)::int as n from public.review_logs where user_id = $1
        and (reviewed_at at time zone 'America/Sao_Paulo')::date = $2 and previous_stability is not null`, [userId, today]);

  const dominated = (exams as any[]).map((e) => {
    const total = e.total_questions ?? e.exam_total_questions ??
      (state.plan.summary.exams?.find((x: any) => x.editionId === e.exam_edition_id)?.expectedTotalQuestions ?? null);
    return {
      editionId: e.exam_edition_id,
      label: `${e.institution} ${e.year}`,
      examName: e.exam_name,
      examDate: e.exam_date,
      daysLeft: e.exam_date ? diffDays(e.exam_date, today) : null,
      isPrimary: e.is_primary,
      totalQuestions: total,
      dominated: examDominated(subjects, e.exam_edition_id),
      editionsAnalyzed: e.editions_analyzed,
    };
  });

  const nextSubjects = subjects.filter((s) => s.status !== 'studied' && s.scheduled).slice(0, 5)
    .map((s) => ({ subjectId: s.subjectId, name: s.name, rank: s.rank, levelLabel: s.levelLabel, percentage: s.percentage, progress: s.progress }));

  return {
    hasPlan: true,
    profileConfigured: profile.configured,
    selectedExams: selection.length,
    plan: { id: state.plan.id, name: state.plan.name, startDate: state.plan.start_date, endDate: state.plan.end_date, mode: state.plan.mode, algorithm: state.plan.algorithm_version, warnings: state.plan.summary.warnings ?? [] },
    nextExam: next ? { label: editionLabel(next), date: next.exam_date, daysLeft: diffDays(next.exam_date!, today) } : null,
    progress: totalBlocks ? doneBlocks / totalBlocks : 0,
    subjects: { total: subjects.length, studied: studied.length, inProgress: subjects.filter((s) => s.status === 'in_progress').length, pending: subjects.filter((s) => s.status === 'pending').length, unscheduled: subjects.filter((s) => !s.scheduled).length },
    reviews: { today: reviewsToday, overdue, doneToday: doneToday[0]?.n ?? 0 },
    questions: { answered, correct, accuracy: answered ? correct / answered : null },
    coverage: { studied: studied.reduce((t, s) => t + s.percentage, 0), scheduled: subjects.filter((s) => s.scheduled).reduce((t, s) => t + s.percentage, 0) },
    dominated,
    nextSubjects,
    masteryNote: `Domínio estimado = acerto suavizado (${MASTERY.priorWeight} questões fictícias a 50%) × memória atual. Assunto estudado sem questões registradas conta ${Math.round(MASTERY.studiedWithoutQuestions * 100)}%.`,
  };
}

export async function performanceView(db: Db, userId: string, today: ISODate) {
  const state = await loadPlanState(db, userId, today);
  const history = await many(db,
    `select (practiced_at at time zone 'America/Sao_Paulo')::date as date, sum(questions_count)::int as questions, sum(correct_count)::int as correct
       from public.question_practice_logs where user_id = $1 and practiced_at > now() - interval '90 days'
      group by 1 order by 1`, [userId]);
  const ratings = await many(db,
    `select rating, count(*)::int as n from public.review_logs where user_id = $1 and previous_stability is not null group by rating`, [userId]);
  const logs = await many(db,
    `select l.id, l.subject_id, s.name, l.questions_count, l.correct_count, l.time_spent_minutes, l.practiced_at
       from public.question_practice_logs l join public.subjects s on s.id = l.subject_id
      where l.user_id = $1 order by l.practiced_at desc limit 50`, [userId]);
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
    hasPlan: true,
    history,
    ratings,
    logs,
    areas: [...areas.values()].sort((a, b) => b.percentage - a.percentage),
    subjects: state.subjects.map((s) => ({
      subjectId: s.subjectId, name: s.name, area: s.area, rank: s.rank, status: s.status,
      answered: s.performance.answered, correct: s.performance.correct, accuracy: s.performance.accuracy,
      mastery: s.mastery.mastery, retrievability: s.card?.retrievability ?? null, nextReview: s.card?.nextReview ?? null,
      estimatedQuestions: s.estimatedQuestions,
    })),
  };
}
