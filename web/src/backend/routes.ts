/**
 * Roteador local: atende os mesmos caminhos "/api/..." que as telas usam,
 * só que dentro do navegador, falando direto com o Supabase.
 */
import { z } from 'zod';
import { MASTERY, MEMORY, PRIORITY } from '../../../shared/config';
import { diffDays, type ISODate } from '../../../shared/dates';
import { RATINGS, type Rating } from '../../../shared/memory';
import { sufficiencyMessage } from '../../../shared/stats';
import { ApiError, badRequest, currentUserId, notFound, q, rpc, selectAll, toApiError, type Ctx } from './core';
import { loadExamHistories, loadSubjectsInfo } from './history';
import { addSubjectToDay, ensurePlan, syncPlanToSelection, deleteOwnSubject, updateOwnSubject, generatePlan, loadMethods, loadPlanState, loadProfile, logPractice, rateReview, replan, setMethodDone, setReviewsPerDay, setSubjectHidden, scheduleSubjectOn, moveTask, moveReview, setSubjectActivities, setSubjectDone, studyWeekdays } from './planner';
import { calendarView, dashboardView, performanceView, todayView } from './agenda';
import { generateFromTemplate, listTemplates } from './templates';
import { agendaView, createTask, deleteTask, plannerTasks, saveNote, updateTask } from './personal';
import { createResidency, deleteResidency, listResidencies, updateResidency } from './residencies';

type Handler = (a: { ctx: Ctx; params: Record<string, string>; query: URLSearchParams; body: any }) => Promise<any>;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

const routes: Route[] = [];
function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

export async function handle(ctx: Ctx, method: string, url: string, body?: unknown) {
  const [path, qs] = url.split('?');
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      return await r.handler({ ctx, params, query: new URLSearchParams(qs ?? ''), body: body ?? {} });
    } catch (e) {
      throw toApiError(e);
    }
  }
  throw new ApiError(404, 'Rota não encontrada.');
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');

export function registrationWindow(e: { registration_start: string | null; registration_end: string | null; exam_date: string | null }, t: ISODate) {
  if (e.exam_date && e.exam_date < t) return 'exam_done';
  if (!e.registration_start && !e.registration_end) return 'unknown';
  if (e.registration_start && t < e.registration_start) return 'upcoming';
  if (e.registration_end && t > e.registration_end) return 'closed';
  return 'open';
}

async function profileOf(ctx: Ctx, userId: string) {
  return q(ctx.sb.from('user_profiles').select('name, role, active').eq('user_id', userId).maybeSingle()) as Promise<any>;
}

// ============================================================================
// Autenticação (Supabase Auth)
// ============================================================================
const credentials = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(200),
});
const registration = credentials.extend({ name: z.string().trim().min(2, 'Informe seu nome.').max(120) });

function authError(e: any): ApiError {
  const msg = String(e?.message ?? '');
  if (/invalid login credentials/i.test(msg)) return new ApiError(401, 'E-mail ou senha incorretos.');
  if (/email not confirmed/i.test(msg)) return new ApiError(401, 'Confirme seu e-mail (veja a mensagem que enviamos) antes de entrar.');
  if (/already registered|already been registered|exists/i.test(msg)) return new ApiError(409, 'Este e-mail já está cadastrado.');
  if (/anonymous sign-ins are disabled/i.test(msg)) return new ApiError(400, 'O modo visitante não está habilitado no Supabase (Authentication → Sign In / Providers → Allow anonymous sign-ins).');
  if (/rate limit/i.test(msg)) return new ApiError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  if (/password/i.test(msg)) return new ApiError(400, msg);
  return new ApiError(e?.status ?? 400, msg || 'Falha na autenticação.');
}

route('GET', '/api/auth/me', async ({ ctx }) => {
  const { data } = await ctx.sb.auth.getSession();
  const u = data.session?.user;
  if (!u) return { user: null };
  const p = await profileOf(ctx, u.id);
  if (!p || !p.active) {
    await ctx.sb.auth.signOut();
    return { user: null, blocked: !!p && !p.active };
  }
  return { user: { id: u.id, email: u.email ?? null, name: p.name, role: p.role, isGuest: !!u.is_anonymous } };
});

route('POST', '/api/auth/register', async ({ ctx, body }) => {
  const b = registration.parse(body);
  const { data, error } = await ctx.sb.auth.signUp({ email: b.email, password: b.password, options: { data: { name: b.name } } });
  if (error) throw authError(error);
  if (data.user && data.user.identities?.length === 0) throw new ApiError(409, 'Este e-mail já está cadastrado.');
  return { ok: true, needsConfirmation: !data.session };
});

route('POST', '/api/auth/login', async ({ ctx, body }) => {
  const b = credentials.parse(body);
  const { error } = await ctx.sb.auth.signInWithPassword({ email: b.email, password: b.password });
  if (error) throw authError(error);
  return { ok: true };
});

route('POST', '/api/auth/guest', async ({ ctx }) => {
  const { error } = await ctx.sb.auth.signInAnonymously();
  if (error) throw authError(error);
  return { ok: true };
});

route('POST', '/api/auth/upgrade', async ({ ctx, body }) => {
  const b = registration.parse(body);
  const { data } = await ctx.sb.auth.getSession();
  if (!data.session?.user.is_anonymous) throw badRequest('Sua conta já está registrada.');
  const { data: upd, error } = await ctx.sb.auth.updateUser({ email: b.email, password: b.password, data: { name: b.name } });
  if (error) throw authError(error);
  await ctx.sb.from('user_profiles').update({ name: b.name }).eq('user_id', data.session.user.id);
  await ctx.sb.auth.refreshSession();
  return { ok: true, needsConfirmation: !!upd.user?.new_email };
});

route('POST', '/api/auth/logout', async ({ ctx }) => {
  await ctx.sb.auth.signOut();
  return { ok: true };
});

route('PATCH', '/api/auth/profile', async ({ ctx, body }) => {
  const id = await currentUserId(ctx);
  const b = z.object({ name: z.string().trim().min(2).max(120) }).parse(body);
  await q(ctx.sb.from('user_profiles').update({ name: b.name }).eq('user_id', id));
  return { ok: true };
});

// ============================================================================
// Aluno
// ============================================================================
route('GET', '/api/exams', async ({ ctx }) => {
  const uid = await currentUserId(ctx);
  const t = ctx.today();
  const rows = await q(ctx.sb.from('exam_catalog').select('*').eq('status', 'published').order('institution').order('year', { ascending: false }));
  const sel = await q(ctx.sb.from('user_exam_editions').select('*').eq('user_id', uid));
  const regs = await q(ctx.sb.from('registrations').select('exam_edition_id, status, registration_number, notes').eq('user_id', uid));
  const hist = await loadExamHistories(ctx, [...new Set((rows as any[]).map((r) => r.exam_id))]);
  const qCount = new Map<string, number>();
  for (const h of hist.values()) for (const e of h.editions) qCount.set(e.id, e.questionCount);
  return (rows as any[])
    // Edições com questões cadastradas são o histórico (base da análise), não provas a fazer.
    .filter((r) => (qCount.get(r.edition_id) ?? 0) === 0)
    .map((r) => {
      const h = hist.get(r.exam_id)!;
      const s: any = (sel as any[]).find((x) => x.exam_edition_id === r.edition_id);
      const g: any = (regs as any[]).find((x) => x.exam_edition_id === r.edition_id);
      // Data oficial (fixa) quando cadastrada; senão, a do aluno. Inscrição e valor: do aluno.
      const mine = {
        exam_date: r.exam_date ?? s?.exam_date ?? null,
        registration_start: s?.registration_start ?? null,
        registration_end: s?.registration_end ?? null,
        registration_fee: s?.registration_fee != null ? Number(s.registration_fee) : null,
      };
      return {
        ...r,
        ...mine,
        date_official: !!r.exam_date,
        selected: !!s?.selected, is_primary: !!(s?.selected && s?.is_primary),
        registration_status: g?.status ?? null, registration_number: g?.registration_number ?? null, registration_notes: g?.notes ?? null,
        days_left: mine.exam_date ? diffDays(mine.exam_date, t) : null,
        registration_window: registrationWindow(mine, t),
        history: {
          editionsAnalyzed: h.stats.editionsAnalyzed, years: h.stats.years, questions: h.stats.totalQuestions,
          classified: h.stats.classifiedQuestions, sufficiency: h.stats.sufficiency, message: sufficiencyMessage(h.stats.editionsAnalyzed),
        },
      };
    })
    .sort((a, b) => (a.exam_date ?? '9999').localeCompare(b.exam_date ?? '9999') || a.institution.localeCompare(b.institution));
});

route('PUT', '/api/me/editions/:id', async ({ ctx, params, body }) => {
  await currentUserId(ctx);
  const id = uuid.parse(params.id);
  const b = z.object({
    selected: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    status: z.enum(['not_interested', 'want_to', 'pending', 'registered', 'closed', 'taken']).nullable().optional(),
    registrationNumber: z.string().max(100).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    examDate: isoDate.nullable().optional(),
    registrationStart: isoDate.nullable().optional(),
    registrationEnd: isoDate.nullable().optional(),
    registrationFee: z.number().nonnegative().max(100000).nullable().optional(),
    /** A tela de montar o planner gera o plano logo depois: não refaz antes. */
    keepPlanner: z.boolean().optional(),
  }).parse(body);
  const detailKeys = ['examDate', 'registrationStart', 'registrationEnd', 'registrationFee'] as const;
  if (detailKeys.some((k) => b[k] !== undefined)) {
    const uid = await currentUserId(ctx);
    const cur: any = await q(ctx.sb.from('user_exam_editions').select('exam_date, registration_start, registration_end, registration_fee')
      .eq('user_id', uid).eq('exam_edition_id', id).maybeSingle());
    const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
    const start = pick(b.registrationStart, cur?.registration_start ?? null);
    const end = pick(b.registrationEnd, cur?.registration_end ?? null);
    if (start && end && start > end) throw badRequest('O início da inscrição precisa ser antes do fim.');
    // Data oficial cadastrada não é alterável pelo aluno
    const official: any = await q(ctx.sb.from('exam_editions').select('exam_date').eq('id', id).maybeSingle());
    if (official?.exam_date && b.examDate !== undefined && b.examDate !== official.exam_date) {
      throw badRequest('Esta prova tem data oficial cadastrada e ela não pode ser alterada.');
    }
    await rpc(ctx, 'set_exam_details', {
      p_edition: id,
      p_exam_date: pick(b.examDate, cur?.exam_date ?? null),
      p_registration_start: start,
      p_registration_end: end,
      p_registration_fee: pick(b.registrationFee, cur?.registration_fee ?? null),
    });
  }
  if (b.selected !== undefined || b.isPrimary !== undefined) {
    await rpc(ctx, 'set_edition_selection', { p_edition: id, p_selected: b.selected ?? (b.isPrimary ? true : null), p_primary: b.isPrimary ?? null });
  }
  if (b.status !== undefined || b.registrationNumber !== undefined || b.notes !== undefined) {
    await rpc(ctx, 'set_registration', { p_edition: id, p_status: b.status ?? null, p_number: b.registrationNumber ?? null, p_notes: b.notes ?? null });
  }
  // Mudou a prova, a principal ou a data: o planner acompanha
  if (!b.keepPlanner && (b.selected !== undefined || b.isPrimary !== undefined || b.examDate !== undefined)) return { ok: true, ...(await syncPlanToSelection(ctx)) };
  return { ok: true };
});

route('GET', '/api/exams/:examId/history', async ({ ctx, params }) => {
  await currentUserId(ctx);
  const examId = uuid.parse(params.examId);
  const exam: any = await q(ctx.sb.from('exam_catalog').select('exam_id, exam_name, institution').eq('exam_id', examId).eq('status', 'published').limit(1).maybeSingle());
  if (!exam) throw notFound('Prova');
  const h = (await loadExamHistories(ctx, [examId])).get(examId)!;
  const info = await loadSubjectsInfo(ctx, h.stats.subjects.map((s) => s.subjectId));
  return {
    exam: { id: exam.exam_id, name: exam.exam_name, institution: exam.institution },
    ...h.stats, message: sufficiencyMessage(h.stats.editionsAnalyzed),
    subjects: h.stats.subjects.map((s, i) => ({ ...s, rank: i + 1, name: info.get(s.subjectId)?.name, area: info.get(s.subjectId)?.area })),
  };
});

route('GET', '/api/study-methods', async ({ ctx }) =>
  q(ctx.sb.from('study_methods').select('id, code, name, activity_type, default_minutes').eq('active', true).order('sort_order')));

route('GET', '/api/me/study-settings', async ({ ctx }) => {
  const uid = await currentUserId(ctx);
  const profile = await loadProfile(ctx, uid);
  return { profile, methods: await loadMethods(ctx, uid), weekdays: studyWeekdays(profile) };
});

route('PUT', '/api/me/study-settings', async ({ ctx, body }) => {
  await currentUserId(ctx);
  const b = z.object({
    profile: z.object({
      start_date: isoDate,
      daily_hours: z.number().min(0.5).max(16),
      study_days_per_week: z.number().int().min(1).max(7),
      questions_per_day: z.number().int().min(0).max(500),
      study_saturday: z.boolean(),
      study_sunday: z.boolean(),
      preferred_start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      preferred_end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      reviews_per_day: z.number().int().min(1).max(30).optional(),
    }),
    methods: z.array(z.object({ id: uuid, enabled: z.boolean(), minutes: z.number().int().min(5).max(600) })).min(1),
  }).parse(body);
  if (!b.methods.some((m) => m.enabled)) throw badRequest('Selecione pelo menos um método de estudo.');
  const { reviews_per_day, ...profile } = b.profile;
  await q(ctx.sb.from('study_profiles').upsert({
    ...profile, preferred_start_time: b.profile.preferred_start_time ?? null, preferred_end_time: b.profile.preferred_end_time ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }));
  await q(ctx.sb.from('user_study_methods').upsert(
    b.methods.map((m) => ({ study_method_id: m.id, enabled: m.enabled, estimated_minutes: m.minutes })),
    { onConflict: 'user_id,study_method_id' }));
  if (reviews_per_day !== undefined) await setReviewsPerDay(ctx, reviews_per_day);
  return { ok: true };
});

route('POST', '/api/planner/generate', async ({ ctx, body }) => {
  const b = z.object({
    editionIds: z.array(uuid).min(1).max(20),
    primaryEditionId: uuid,
    startDate: isoDate,
    targetDate: isoDate.nullable().optional(),
  }).parse(body);
  return { planId: await generatePlan(ctx, b) };
});

route('POST', '/api/planner/replan', async ({ ctx }) => ({ planId: await replan(ctx) }));

route('GET', '/api/planner', async ({ ctx }) => {
  const uid = await currentUserId(ctx);
  const t = ctx.today();
  const s = await loadPlanState(ctx, uid);
  if (!s) return { plan: null };
  const overdueActivities = s.subjects.filter((x) => !x.hidden).reduce((n, subj) => n + subj.checklist.filter((c) => !c.done && c.scheduledDate && c.scheduledDate < t).length, 0);
  return { today: t, plan: s.plan, exams: s.exams, methods: s.methods, subjects: s.subjects, overdueActivities };
});

route('GET', '/api/planner/today', async ({ ctx }) => (await todayView(ctx)) ?? { plan: null });

route('GET', '/api/planner/subjects/:id', async ({ ctx, params }) => {
  const uid = await currentUserId(ctx);
  const id = uuid.parse(params.id);
  const s = await loadPlanState(ctx, uid);
  const subj = s?.subjects.find((x) => x.subjectId === id);
  if (!s || !subj) throw notFound('Assunto');
  const practice = await q(ctx.sb.from('question_practice_logs').select('id, questions_count, correct_count, time_spent_minutes, practiced_at')
    .eq('user_id', uid).eq('subject_id', id).order('practiced_at', { ascending: false }));
  const reviews = await q(ctx.sb.from('review_logs').select('reviewed_at, rating, previous_interval, new_interval, scheduled_next_review, retrievability_at_review, days_until_exam')
    .eq('user_id', uid).eq('subject_id', id).order('reviewed_at', { ascending: false }));
  const children = await rpc<string[]>(ctx, 'subject_children', { p_id: id });
  const allMethods = (await loadMethods(ctx, uid)).map((m) => ({ id: m.id, code: m.code, name: m.name, enabled: m.enabled, minutes: m.estimated_minutes }));
  const primary = s.exams.find((e: any) => e.is_primary) as any;
  const n = subj.yearsAnalyzed;
  const pct = (subj.percentage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const tpl = (subj.perExam?.[0] as any)?.template;
  const explanation = subj.own ? 'Assunto criado por você: não vem da análise das provas e não muda a base de assuntos de ninguém.' : tpl ? templateExplanation(subj, tpl, primary?.institution) : s.exams.length === 1
    ? `${subj.name} está em #${subj.rank} porque representou ${pct}% das questões das ${n} ${n === 1 ? 'edição cadastrada' : 'edições cadastradas'} de ${primary?.institution ?? 'sua prova'}.`
    : `${subj.name} está em #${subj.rank} porque representou, em média ponderada, ${pct}% das questões das provas selecionadas (peso maior para a prova principal e para as provas mais próximas).`;
  const areaId = subj.own ? (await loadSubjectsInfo(ctx, [id])).get(id)?.area_id ?? null : null;
  return {
    subject: subj, areaId, explanation, examWeights: s.plan.summary.weights, exams: s.plan.summary.exams, subtopics: children,
    practice, reviews, allMethods, weights: PRIORITY.weights, mastery: { priorWeight: MASTERY.priorWeight, priorMean: MASTERY.priorMean },
  };
});

route('POST', '/api/planner/subjects/:id/methods/:methodId', async ({ ctx, params, body }) => {
  const { done } = z.object({ done: z.boolean() }).parse(body);
  return setMethodDone(ctx, uuid.parse(params.id), uuid.parse(params.methodId), done);
});

route('POST', '/api/planner/subjects/:id/complete', async ({ ctx, params, body }) => {
  const { done } = z.object({ done: z.boolean() }).parse(body);
  return setSubjectDone(ctx, uuid.parse(params.id), done);
});

route('PUT', '/api/planner/subjects/:id/activities', async ({ ctx, params, body }) => {
  const { methodIds } = z.object({ methodIds: z.array(uuid).max(20).nullable() }).parse(body);
  return setSubjectActivities(ctx, uuid.parse(params.id), methodIds);
});

route('POST', '/api/planner/subjects/:id/practice', async ({ ctx, params, body }) => {
  const b = z.object({
    questions: z.number().int().min(1).max(1000),
    correct: z.number().int().min(0).max(1000),
    minutes: z.number().int().min(0).max(1440).nullable().optional(),
    source: z.string().max(200).nullable().optional(),
  }).parse(body);
  return logPractice(ctx, uuid.parse(params.id), b);
});

route('DELETE', '/api/planner/practice/:logId', async ({ ctx, params }) => {
  const rows = await q(ctx.sb.from('question_practice_logs').delete().eq('id', uuid.parse(params.logId)).select('id'));
  if (!(rows as any[]).length) throw notFound('Registro');
  return { ok: true };
});

route('GET', '/api/reviews/calendar', async ({ ctx, query }) => {
  const from = isoDate.parse(query.get('from'));
  const to = isoDate.parse(query.get('to'));
  if (diffDays(to, from) > 62 || to < from) throw badRequest('Intervalo inválido (máx. 62 dias).');
  return (await calendarView(ctx, from, to)) ?? { plan: null };
});

route('POST', '/api/reviews/:subjectId', async ({ ctx, params, body }) => {
  const b = z.object({
    rating: z.enum(RATINGS as [Rating, ...Rating[]]),
    timeSpentSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  }).parse(body);
  return rateReview(ctx, uuid.parse(params.subjectId), b.rating, b.timeSpentSeconds ?? null);
});

route('GET', '/api/dashboard', async ({ ctx }) => dashboardView(ctx));
route('GET', '/api/performance', async ({ ctx }) => performanceView(ctx));
route('GET', '/api/algorithm', async () => ({ priority: PRIORITY, memory: MEMORY, mastery: MASTERY }));

export { selectAll };

// Observações da semana (texto livre do aluno)
route('GET', '/api/notes/:week', async ({ ctx, params }) => {
  const uid = await currentUserId(ctx);
  const week = isoDate.parse(params.week);
  const r: any = await q(ctx.sb.from('weekly_notes').select('content, updated_at').eq('user_id', uid).eq('week_start', week).maybeSingle());
  return { week, content: r?.content ?? '', updatedAt: r?.updated_at ?? null };
});

route('PUT', '/api/notes/:week', async ({ ctx, params, body }) => {
  const uid = await currentUserId(ctx);
  const week = isoDate.parse(params.week);
  const { content } = z.object({ content: z.string().max(5000) }).parse(body);
  await q(ctx.sb.from('weekly_notes').upsert({ user_id: uid, week_start: week, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id,week_start' }));
  return { ok: true };
});

// Zerar o perfil: volta a ser como uma conta nova (mantém nome e e-mail)
route('POST', '/api/me/reset', async ({ ctx }) => {
  await currentUserId(ctx);
  await rpc(ctx, 'reset_my_data', {});
  return { ok: true };
});

// Cronogramas pessoais (só administradores)
route('GET', '/api/templates', async ({ ctx }) => listTemplates(ctx));
route('POST', '/api/planner/generate-template', async ({ ctx, body }) => {
  const { templateId } = z.object({ templateId: uuid }).parse(body);
  return { planId: await generateFromTemplate(ctx, templateId) };
});

function templateExplanation(subj: any, t: any, inst = 'UNOESTE') {
  const br = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
  const caiu = subj.estimatedQuestions > 0 ? ` Caiu ${Math.round(subj.annualAverage * subj.yearsAnalyzed)} vez(es) na ${inst} de 2022 a 2026.` : '';
  if (t.kind === 'lesson') return `Aula do seu cronograma MEDCOF para ${br(t.date)}.${caiu}${t.core ? ` Núcleo ${t.core}.` : ''}`;
  if (t.kind === 'studied') return `Tema que você já estudou (${t.cards} cards no Anki${t.fragile ? ', baralho frágil' : ''}). Entra nas revisões do site por ordem de importância e também nas questões do sábado ${br(t.saturday)}.${caiu}`;
  if (t.kind === 'reserve') return `Aula de reserva: para trocar um tema que você já domina ou se sobrar tempo.${caiu}`;
  return t.detail ?? '';
}

// Arrastar no planner: aula só para o lado das aulas, revisão só para o das revisões
route('POST', '/api/planner/subjects/:id/move', async ({ ctx, params, body }) => {
  const b = z.object({ from: isoDate, to: isoDate, methodIds: z.array(uuid).max(20).optional() }).parse(body);
  return moveTask(ctx, uuid.parse(params.id), b);
});
route('POST', '/api/reviews/:subjectId/move', async ({ ctx, params, body }) => {
  const { to } = z.object({ to: isoDate }).parse(body);
  return moveReview(ctx, uuid.parse(params.subjectId), to);
});

// Tirar do planner / mostrar de novo (o assunto continua nos conteúdos)
route('PUT', '/api/planner/subjects/:id/hidden', async ({ ctx, params, body }) => {
  const { hidden } = z.object({ hidden: z.boolean() }).parse(body);
  return setSubjectHidden(ctx, uuid.parse(params.id), hidden);
});

// Arrastar da lista de assuntos para um dia da semana
route('POST', '/api/planner/subjects/:id/schedule', async ({ ctx, params, body }) => {
  const { to } = z.object({ to: isoDate }).parse(body);
  return scheduleSubjectOn(ctx, uuid.parse(params.id), to);
});

// Agenda: organização pessoal, independente do planner de estudos
route('GET', '/api/agenda', async ({ ctx, query }) => agendaView(ctx, isoDate.parse(query.get('from')), isoDate.parse(query.get('to'))));
route('GET', '/api/agenda/planner', async ({ ctx, query }) => plannerTasks(ctx, isoDate.parse(query.get('from')), isoDate.parse(query.get('to'))));
route('POST', '/api/agenda/tasks', async ({ ctx, body }) => createTask(ctx, body));
route('PATCH', '/api/agenda/tasks/:id', async ({ ctx, params, body }) => updateTask(ctx, uuid.parse(params.id), body));
route('DELETE', '/api/agenda/tasks/:id', async ({ ctx, params }) => deleteTask(ctx, uuid.parse(params.id)));
route('PUT', '/api/agenda/notes/:date', async ({ ctx, params, body }) => {
  const { content } = z.object({ content: z.string().max(5000) }).parse(body);
  return saveNote(ctx, isoDate.parse(params.date), content);
});

// Montar o planner à mão: "+" num dia (assunto da prova ou novo), editar e excluir assuntos próprios
route('POST', '/api/planner/days/:date/subjects', async ({ ctx, params, body }) => {
  const b = z.object({
    subjectId: uuid.optional(),
    name: z.string().trim().min(1, 'Escreva o nome do assunto.').max(200).optional(),
    areaId: uuid.nullable().optional(),
  }).refine((x) => !!x.subjectId !== !!x.name, 'Escolha um assunto ou escreva um novo.').parse(body);
  return addSubjectToDay(ctx, { date: isoDate.parse(params.date), ...b });
});
// "Montar do zero": planner vazio, sem prova (os assuntos entram pelo "+" de cada dia)
// Residências
route('GET', '/api/residencies', async ({ ctx }) => listResidencies(ctx));
route('POST', '/api/residencies', async ({ ctx, body }) => createResidency(ctx, body));
route('PATCH', '/api/residencies/:id', async ({ ctx, params, body }) => updateResidency(ctx, uuid.parse(params.id), body));
route('DELETE', '/api/residencies/:id', async ({ ctx, params }) => deleteResidency(ctx, uuid.parse(params.id)));

route('POST', '/api/planner/manual', async ({ ctx }) => {
  await ensurePlan(ctx, await currentUserId(ctx));
  return { ok: true };
});
route('PATCH', '/api/subjects/:id', async ({ ctx, params, body }) => {
  const b = z.object({ name: z.string().trim().min(1, 'Escreva o nome do assunto.').max(200), areaId: uuid.nullable().optional() }).parse(body);
  return updateOwnSubject(ctx, uuid.parse(params.id), b);
});
route('DELETE', '/api/subjects/:id', async ({ ctx, params }) => deleteOwnSubject(ctx, uuid.parse(params.id)));
// Grandes áreas (para classificar um assunto novo)
route('GET', '/api/areas', async ({ ctx }) => {
  await currentUserId(ctx);
  const rows = await q<any[]>(ctx.sb.from('medical_areas').select('id, name, slug, sort_order').is('parent_id', null).eq('active', true).order('sort_order').order('name'));
  return rows.map((r) => ({ id: r.id, name: r.name, other: r.slug === 'outros' }));
});
