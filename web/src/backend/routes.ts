/**
 * Roteador local: atende os mesmos caminhos "/api/..." que as telas usam,
 * só que dentro do navegador, falando direto com o Supabase.
 */
import { z } from 'zod';
import { MASTERY, MEMORY, PRIORITY, SCHEDULER } from '../../../shared/config';
import { diffDays, type ISODate } from '../../../shared/dates';
import { RATINGS, type Rating } from '../../../shared/memory';
import { computeExamStats, sufficiencyMessage } from '../../../shared/stats';
import { levelForRank, LEVEL_LABEL } from '../../../shared/priority';
import { ApiError, badRequest, currentUserId, notFound, q, rpc, selectAll, toApiError, type Ctx } from './core';
import { loadExamHistories, loadSubjectsInfo } from './history';
import { generatePlan, loadMethods, loadPlanState, loadProfile, logPractice, rateReview, replan, setMethodDone, studyWeekdays } from './planner';
import { calendarView, dashboardView, performanceView, todayView } from './agenda';
import { commitImport, parseFile, previewImport, slugify, type Resolution } from './importer';

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

async function requireAdmin(ctx: Ctx) {
  const id = await currentUserId(ctx);
  const p = await profileOf(ctx, id);
  if (p?.role !== 'admin') throw new ApiError(403, 'Área restrita a administradores.');
  return id;
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
  const rows = await q(ctx.sb.from('exam_catalog').select('*').eq('status', 'published')
    .order('exam_date', { ascending: true, nullsFirst: false }).order('institution').order('year', { ascending: false }));
  const sel = await q(ctx.sb.from('user_exam_editions').select('exam_edition_id, selected, is_primary').eq('user_id', uid));
  const regs = await q(ctx.sb.from('registrations').select('exam_edition_id, status, registration_number, notes').eq('user_id', uid));
  const hist = await loadExamHistories(ctx, [...new Set((rows as any[]).map((r) => r.exam_id))]);
  return (rows as any[]).map((r) => {
    const h = hist.get(r.exam_id)!;
    const s: any = (sel as any[]).find((x) => x.exam_edition_id === r.edition_id);
    const g: any = (regs as any[]).find((x) => x.exam_edition_id === r.edition_id);
    return {
      ...r,
      selected: !!s?.selected, is_primary: !!(s?.selected && s?.is_primary),
      registration_status: g?.status ?? null, registration_number: g?.registration_number ?? null, registration_notes: g?.notes ?? null,
      days_left: r.exam_date ? diffDays(r.exam_date, t) : null,
      registration_window: registrationWindow(r, t),
      history: {
        editionsAnalyzed: h.stats.editionsAnalyzed, years: h.stats.years, questions: h.stats.totalQuestions,
        classified: h.stats.classifiedQuestions, sufficiency: h.stats.sufficiency, message: sufficiencyMessage(h.stats.editionsAnalyzed),
      },
    };
  });
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
  }).parse(body);
  if (b.selected !== undefined || b.isPrimary !== undefined) {
    await rpc(ctx, 'set_edition_selection', { p_edition: id, p_selected: b.selected ?? (b.isPrimary ? true : null), p_primary: b.isPrimary ?? null });
  }
  if (b.status !== undefined || b.registrationNumber !== undefined || b.notes !== undefined) {
    await rpc(ctx, 'set_registration', { p_edition: id, p_status: b.status ?? null, p_number: b.registrationNumber ?? null, p_notes: b.notes ?? null });
  }
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
    }),
    methods: z.array(z.object({ id: uuid, enabled: z.boolean(), minutes: z.number().int().min(5).max(600) })).min(1),
  }).parse(body);
  if (!b.methods.some((m) => m.enabled)) throw badRequest('Selecione pelo menos um método de estudo.');
  await q(ctx.sb.from('study_profiles').upsert({
    ...b.profile, preferred_start_time: b.profile.preferred_start_time ?? null, preferred_end_time: b.profile.preferred_end_time ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }));
  await q(ctx.sb.from('user_study_methods').upsert(
    b.methods.map((m) => ({ study_method_id: m.id, enabled: m.enabled, estimated_minutes: m.minutes })),
    { onConflict: 'user_id,study_method_id' }));
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
  const overdueActivities = s.subjects.reduce((n, subj) => n + subj.checklist.filter((c) => !c.done && c.scheduledDate && c.scheduledDate < t).length, 0);
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
  const primary = s.exams.find((e: any) => e.is_primary) as any;
  const n = subj.yearsAnalyzed;
  const pct = (subj.percentage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const explanation = s.exams.length === 1
    ? `${subj.name} está em #${subj.rank} porque representou ${pct}% das questões das ${n} ${n === 1 ? 'edição cadastrada' : 'edições cadastradas'} de ${primary?.institution ?? 'sua prova'}.`
    : `${subj.name} está em #${subj.rank} porque representou, em média ponderada, ${pct}% das questões das provas selecionadas (peso maior para a prova principal e para as provas mais próximas).`;
  return {
    subject: subj, explanation, examWeights: s.plan.summary.weights, exams: s.plan.summary.exams, subtopics: children,
    practice, reviews, weights: PRIORITY.weights, mastery: { priorWeight: MASTERY.priorWeight, priorMean: MASTERY.priorMean },
  };
});

route('POST', '/api/planner/subjects/:id/methods/:methodId', async ({ ctx, params, body }) => {
  const { done } = z.object({ done: z.boolean() }).parse(body);
  return setMethodDone(ctx, uuid.parse(params.id), uuid.parse(params.methodId), done);
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

// ============================================================================
// Administração (1ª barreira aqui; a 2ª é o RLS/funções do banco)
// ============================================================================
const optText = (max = 2000) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v ?? null));
const optUrl = z.string().trim().max(1000).nullable().optional()
  .transform((v) => (v === '' ? null : v ?? null))
  .refine((v) => v == null || /^https?:\/\//i.test(v), 'URL deve começar com http:// ou https://');
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null));

const institutionSchema = z.object({
  name: z.string().trim().min(2).max(200),
  abbreviation: z.string().trim().min(2).max(40),
  state: z.string().trim().length(2).toUpperCase().nullable().optional().or(z.literal('').transform(() => null)),
  city: optText(120), website: optUrl, logo_url: optUrl, active: z.boolean().optional(),
});
const boardSchema = z.object({
  name: z.string().trim().min(2).max(200), abbreviation: z.string().trim().min(2).max(40), website: optUrl, active: z.boolean().optional(),
});
const examSchema = z.object({
  institution_id: uuid, board_id: uuid.nullable().optional(), name: z.string().trim().min(2).max(200), description: optText(),
  total_questions: z.number().int().positive().nullable().optional(), duration_minutes: z.number().int().positive().nullable().optional(),
  official_url: optUrl, active: z.boolean().optional(),
});
const editionSchema = z.object({
  exam_id: uuid, year: z.number().int().min(1990).max(2100), exam_date: optDate, registration_start: optDate, registration_end: optDate,
  registration_fee: z.number().nonnegative().max(100000).nullable().optional(), number_of_vacancies: z.number().int().nonnegative().nullable().optional(),
  total_questions: z.number().int().positive().nullable().optional(), edital_url: optUrl, answer_key_url: optUrl, result_url: optUrl,
  source_name: optText(300), source_url: optUrl, source_checked_at: optDate, notes: optText(),
});
const areaSchema = z.object({ parent_id: uuid.nullable().optional(), name: z.string().trim().min(2).max(200), sort_order: z.number().int().optional(), active: z.boolean().optional() });
const subjectSchema = z.object({
  medical_area_id: uuid, parent_subject_id: uuid.nullable().optional(), name: z.string().trim().min(2).max(300), description: optText(), active: z.boolean().optional(),
});
const questionSchema = z.object({
  exam_edition_id: uuid, question_number: z.number().int().positive(), statement: optText(20000), summary: optText(2000),
  alternative_a: optText(5000), alternative_b: optText(5000), alternative_c: optText(5000), alternative_d: optText(5000), alternative_e: optText(5000),
  correct_answer: z.enum(['A', 'B', 'C', 'D', 'E']).nullable().optional(), annulled: z.boolean().optional(), explanation: optText(20000),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(), question_type: optText(200), guideline: optText(300),
  source: optText(500), notes: optText(), active: z.boolean().optional(),
});

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const insertRow = (ctx: Ctx, table: string, data: Record<string, unknown>) => q(ctx.sb.from(table).insert(clean(data)).select().single());
async function updateRow(ctx: Ctx, table: string, id: string, data: Record<string, unknown>) {
  const d = clean(data);
  if (!Object.keys(d).length) return q(ctx.sb.from(table).select().eq('id', id).single());
  const rows = await q(ctx.sb.from(table).update(d).eq('id', id).select());
  if (!(rows as any[]).length) throw notFound();
  return (rows as any[])[0];
}
async function uniqueSlug(ctx: Ctx, table: 'subjects' | 'medical_areas', name: string, exceptId?: string) {
  const base = slugify(name);
  const rows = await q(ctx.sb.from(table).select('id, slug').like('slug', `${base}%`));
  const taken = new Set((rows as any[]).filter((r) => r.id !== exceptId).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

function adminRoute(method: string, pattern: string, handler: Handler) {
  route(method, pattern, async (a) => { await requireAdmin(a.ctx); return handler(a); });
}

adminRoute('GET', '/api/admin/dashboard', async ({ ctx }) => rpc(ctx, 'admin_dashboard'));

adminRoute('GET', '/api/admin/institutions', async ({ ctx }) => q(ctx.sb.from('admin_institutions').select('*').order('abbreviation')));
adminRoute('POST', '/api/admin/institutions', async ({ ctx, body }) => insertRow(ctx, 'institutions', institutionSchema.parse(body)));
adminRoute('PUT', '/api/admin/institutions/:id', async ({ ctx, params, body }) => updateRow(ctx, 'institutions', uuid.parse(params.id), institutionSchema.partial().parse(body)));

adminRoute('GET', '/api/admin/boards', async ({ ctx }) => q(ctx.sb.from('examining_boards').select('*').order('abbreviation')));
adminRoute('POST', '/api/admin/boards', async ({ ctx, body }) => insertRow(ctx, 'examining_boards', boardSchema.parse(body)));
adminRoute('PUT', '/api/admin/boards/:id', async ({ ctx, params, body }) => updateRow(ctx, 'examining_boards', uuid.parse(params.id), boardSchema.partial().parse(body)));

adminRoute('GET', '/api/admin/exams', async ({ ctx }) => q(ctx.sb.from('admin_exams').select('*').order('institution').order('name')));
adminRoute('POST', '/api/admin/exams', async ({ ctx, body }) => insertRow(ctx, 'exams', examSchema.parse(body)));
adminRoute('PUT', '/api/admin/exams/:id', async ({ ctx, params, body }) => updateRow(ctx, 'exams', uuid.parse(params.id), examSchema.partial().parse(body)));

adminRoute('GET', '/api/admin/editions', async ({ ctx, query }) => {
  let b = ctx.sb.from('admin_editions').select('*');
  const examId = query.get('examId');
  if (examId) b = b.eq('exam_id', uuid.parse(examId));
  return q(b.order('institution').order('exam_name').order('year', { ascending: false }));
});
adminRoute('GET', '/api/admin/editions/:id', async ({ ctx, params }) => {
  const ed: any = await q(ctx.sb.from('admin_editions').select('*').eq('id', uuid.parse(params.id)).maybeSingle());
  if (!ed) throw notFound('Edição');
  const counts = { questions: ed.questions, annulled: ed.annulled, classified: ed.classified, with_statement: ed.with_statement };
  const expected = ed.total_questions ?? ed.exam_total_questions;
  const checks = [
    { key: 'date', ok: !!ed.exam_date, label: 'Data da prova cadastrada' },
    { key: 'registration', ok: !!(ed.registration_start || ed.registration_end), label: 'Período de inscrição cadastrado' },
    { key: 'fee', ok: ed.registration_fee != null, label: 'Valor da inscrição cadastrado' },
    { key: 'source', ok: !!(ed.source_name || ed.source_url), label: 'Fonte dos dados informada' },
    { key: 'questions', ok: counts.questions > 0, label: 'Questões cadastradas (para análise histórica)' },
    { key: 'total', ok: !expected || counts.questions === 0 || counts.questions === expected, label: `Nº de questões confere com o total previsto${expected ? ` (${expected})` : ''}` },
    { key: 'classified', ok: counts.questions === 0 || counts.classified === counts.questions, label: 'Todas as questões classificadas' },
  ];
  return { edition: ed, counts, checks };
});
adminRoute('POST', '/api/admin/editions', async ({ ctx, body }) => {
  const uid = await currentUserId(ctx);
  return insertRow(ctx, 'exam_editions', { ...editionSchema.parse(body), status: 'draft', registered_by: uid });
});
adminRoute('PUT', '/api/admin/editions/:id', async ({ ctx, params, body }) =>
  updateRow(ctx, 'exam_editions', uuid.parse(params.id), editionSchema.partial().omit({ exam_id: true }).parse(body)));
adminRoute('POST', '/api/admin/editions/:id/status', async ({ ctx, params, body }) => {
  const { status } = z.object({ status: z.enum(['draft', 'published', 'archived']) }).parse(body);
  return updateRow(ctx, 'exam_editions', uuid.parse(params.id), { status, published_at: status === 'published' ? new Date().toISOString() : undefined });
});

adminRoute('GET', '/api/admin/areas', async ({ ctx }) => q(ctx.sb.from('admin_areas').select('*').order('sort_order').order('name')));
adminRoute('POST', '/api/admin/areas', async ({ ctx, body }) => {
  const d = areaSchema.parse(body);
  if (d.parent_id) {
    const p: any = await q(ctx.sb.from('medical_areas').select('parent_id').eq('id', d.parent_id).maybeSingle());
    if (!p) throw badRequest('Área-mãe inexistente.');
    if (p.parent_id) throw badRequest('Use no máximo dois níveis: grande área → especialidade.');
  }
  return insertRow(ctx, 'medical_areas', { ...d, slug: await uniqueSlug(ctx, 'medical_areas', d.name) });
});
adminRoute('PUT', '/api/admin/areas/:id', async ({ ctx, params, body }) => {
  const id = uuid.parse(params.id);
  const d = areaSchema.partial().parse(body);
  return updateRow(ctx, 'medical_areas', id, { ...d, slug: d.name ? await uniqueSlug(ctx, 'medical_areas', d.name, id) : undefined });
});

adminRoute('GET', '/api/admin/subjects', async ({ ctx }) => rpc(ctx, 'admin_subjects'));
adminRoute('POST', '/api/admin/subjects', async ({ ctx, body }) => {
  const d = subjectSchema.parse(body);
  return insertRow(ctx, 'subjects', { ...d, slug: await uniqueSlug(ctx, 'subjects', d.name) });
});
adminRoute('PUT', '/api/admin/subjects/:id', async ({ ctx, params, body }) => {
  const id = uuid.parse(params.id);
  const d = subjectSchema.partial().parse(body);
  if (d.parent_subject_id) {
    // Evita ciclos: o novo pai não pode descender deste assunto
    let cur: string | null = d.parent_subject_id;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === id) throw badRequest('Hierarquia inválida: o assunto não pode ser pai de si mesmo.');
      const row: any = await q(ctx.sb.from('subjects').select('parent_subject_id').eq('id', cur).maybeSingle());
      cur = row?.parent_subject_id ?? null;
    }
  }
  return updateRow(ctx, 'subjects', id, { ...d, slug: d.name ? await uniqueSlug(ctx, 'subjects', d.name, id) : undefined });
});
adminRoute('POST', '/api/admin/subjects/:id/merge', async ({ ctx, params, body }) => {
  const { targetId } = z.object({ targetId: uuid }).parse(body);
  await rpc(ctx, 'merge_subject', { p_source: uuid.parse(params.id), p_target: targetId });
  return { ok: true };
});
adminRoute('POST', '/api/admin/subjects/:id/aliases', async ({ ctx, params, body }) => {
  const { alias } = z.object({ alias: z.string().trim().min(2).max(300) }).parse(body);
  return insertRow(ctx, 'subject_aliases', { subject_id: uuid.parse(params.id), alias });
});
adminRoute('DELETE', '/api/admin/subjects/:id/aliases/:alias', async ({ ctx, params }) => {
  await q(ctx.sb.from('subject_aliases').delete().eq('subject_id', uuid.parse(params.id)).eq('alias', params.alias));
  return { ok: true };
});

adminRoute('GET', '/api/admin/editions/:id/questions', async ({ ctx, params }) => rpc(ctx, 'admin_edition_questions', { p_edition: uuid.parse(params.id) }));
adminRoute('POST', '/api/admin/questions', async ({ ctx, body }) => {
  const d = questionSchema.parse(body);
  if (!d.annulled && !d.correct_answer) throw badRequest('Informe o gabarito ou marque a questão como anulada.');
  if (!d.statement && !d.summary) throw badRequest('Informe o enunciado ou o resumo do que a questão cobra.');
  return insertRow(ctx, 'questions', d);
});
adminRoute('PUT', '/api/admin/questions/:id', async ({ ctx, params, body }) =>
  updateRow(ctx, 'questions', uuid.parse(params.id), questionSchema.partial().omit({ exam_edition_id: true }).parse(body)));
adminRoute('PUT', '/api/admin/questions/:id/subjects', async ({ ctx, params, body }) => {
  const links = z.array(z.object({ subjectId: uuid, weight: z.number().gt(0).max(1).default(1), isPrimary: z.boolean().default(false) })).max(5).parse(body);
  if (links.length && links.filter((l) => l.isPrimary).length !== 1) throw badRequest('Marque exatamente um assunto principal.');
  if (new Set(links.map((l) => l.subjectId)).size !== links.length) throw badRequest('Assunto repetido.');
  await rpc(ctx, 'set_question_subjects', { p_question: uuid.parse(params.id), p_links: links });
  return { ok: true };
});

adminRoute('GET', '/api/admin/exams/:id/stats', async ({ ctx, params, query }) => {
  const id = uuid.parse(params.id);
  const includeDrafts = query.get('includeDrafts') !== 'false';
  const leaf = query.get('level') === 'leaf';
  const exam: any = await q(ctx.sb.from('admin_exams').select('*').eq('id', id).maybeSingle());
  if (!exam) throw notFound('Prova');
  const hist = (await loadExamHistories(ctx, [id], includeDrafts)).get(id)!;
  const stats = leaf
    ? computeExamStats(hist.editions.map((e) => ({ id: e.id, year: e.year, questionCount: e.questionCount })),
      hist.links.map((l) => ({ questionId: l[0], editionId: l[1], subjectId: l[5], weight: Number(l[4]) })))
    : hist.stats;
  const info = await loadSubjectsInfo(ctx, stats.subjects.map((s) => s.subjectId));
  return {
    exam, editions: hist.editions, includeDrafts, message: sufficiencyMessage(stats.editionsAnalyzed), ...stats,
    subjects: stats.subjects.map((s, i) => ({ ...s, rank: i + 1, name: info.get(s.subjectId)?.name, area: info.get(s.subjectId)?.area, level: LEVEL_LABEL[levelForRank(i + 1, stats.subjects.length)] })),
  };
});

const importBody = z.object({
  examId: uuid, filename: z.string().min(1).max(300), content: z.string().min(1),
  resolutions: z.record(z.string(), z.union([
    z.object({ action: z.literal('map'), id: uuid }), z.object({ action: z.literal('create') }), z.object({ action: z.literal('ignore') }),
  ])).optional(),
  source: optText(500),
});
adminRoute('POST', '/api/admin/import/preview', async ({ ctx, body }) => {
  const b = importBody.parse(body);
  return previewImport(ctx, b.examId, await parseFile(b.filename, b.content));
});
adminRoute('POST', '/api/admin/import/commit', async ({ ctx, body }) => {
  const b = importBody.parse(body);
  if (!b.resolutions) throw badRequest('Confirmação ausente.');
  return commitImport(ctx, b.examId, b.filename, await parseFile(b.filename, b.content), b.resolutions as Record<string, Resolution>, b.source ?? null);
});
adminRoute('GET', '/api/admin/import/batches', async ({ ctx }) => q(ctx.sb.from('admin_import_batches').select('*').order('created_at', { ascending: false }).limit(50)));

adminRoute('GET', '/api/admin/users', async ({ ctx }) => rpc(ctx, 'admin_users'));
adminRoute('PUT', '/api/admin/users/:userId', async ({ ctx, params, body }) => {
  const d = z.object({ role: z.enum(['admin', 'user']).optional(), active: z.boolean().optional() }).parse(body);
  const rows = await q(ctx.sb.from('user_profiles').update(clean(d)).eq('user_id', uuid.parse(params.userId)).select('user_id'));
  if (!(rows as any[]).length) throw notFound('Usuário');
  return { ok: true };
});

adminRoute('GET', '/api/admin/logs', async ({ ctx, query }) => {
  const page = Math.max(1, Number(query.get('page') ?? 1) || 1);
  const entity = query.get('entity');
  let b = ctx.sb.from('admin_audit_logs').select('*', { count: 'exact' });
  if (entity) b = b.eq('entity', entity);
  const { data, count, error } = await b.order('changed_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 50, page * 50 - 1);
  if (error) throw toApiError(error);
  return { rows: data, total: count ?? 0, page, pageSize: 50 };
});

adminRoute('GET', '/api/admin/algorithms', async ({ ctx }) => ({
  versions: await q(ctx.sb.from('algorithm_versions').select('*').order('created_at')),
  parameters: { priority: PRIORITY, memory: MEMORY, scheduler: SCHEDULER, mastery: MASTERY },
}));

export { selectAll };
