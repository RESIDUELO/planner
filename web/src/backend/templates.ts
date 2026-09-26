/**
 * Cronogramas pessoais (plan_templates): um planner com datas fixas vindo de
 * um cronograma pronto (ex.: aulas do MEDCOF dia a dia). Só administradores
 * enxergam (RLS). Os temas já estudados entram como concluídos; aulas,
 * sábados de questões, simulados e a revisão final entram nas datas do
 * cronograma. A fila continua dinâmica: aula adiantada sobe as seguintes para
 * os dias de aula livres, sem mexer em sábados, simulados e revisão final.
 */
import { type ISODate } from '../../../shared/dates';
import { MEMORY_VERSION } from '../../../shared/config';
import { review } from '../../../shared/memory';
import { assignReviews } from '../../../shared/reviewQueue';
import { badRequest, currentUserId, notFound, q, rpc, selectAll, type Ctx } from './core';
import { activePlan, savePlan, loadEditions, loadHidden, loadMethods, loadProfile, readjustCards, saveSelection, studyWeekdays } from './planner';

type Kind = 'lesson' | 'questions' | 'mock' | 'review' | 'studied' | 'reserve';
interface TemplateItem {
  kind: Kind; slug: string; name: string; area: string; date?: ISODate; lesson?: string; color?: string; focus?: string;
  detail?: string; refs?: [number, number][]; byYear?: number[]; total?: number; core?: string; cards?: number;
  saturday?: ISODate; fragile?: boolean;
}
interface TemplateData {
  code: string; name: string; description: string; startDate: ISODate; examDate: ISODate; studiedAt: ISODate;
  years: number[]; questionsPerExam: number; source: string; items: TemplateItem[];
}

const DATED: Kind[] = ['lesson', 'questions', 'mock', 'review'];
const LEVEL: Record<string, string> = { A: 'muito_alta', B: 'alta', C: 'media', D: 'baixa' };
const levelFromTotal = (t: number) => (t >= 7 ? 'muito_alta' : t >= 4 ? 'alta' : t >= 2 ? 'media' : 'baixa');

/** Cronogramas disponíveis para quem está logado (vazio para quem não é administrador). */
export async function listTemplates(ctx: Ctx) {
  await currentUserId(ctx);
  const { data, error } = await ctx.sb.from('plan_templates').select('id, code, name, description, data').eq('active', true);
  if (error) return []; // tabela ainda não criada (10_plan_templates.sql)
  return (data as any[]).map((t) => {
    const items = (t.data?.items ?? []) as TemplateItem[];
    return {
      id: t.id, code: t.code, name: t.name, description: t.description,
      startDate: t.data?.startDate, examDate: t.data?.examDate,
      lessons: items.filter((i) => i.kind === 'lesson').length,
      studied: items.filter((i) => i.kind === 'studied').length,
    };
  });
}

async function resolveSubjects(ctx: Ctx, slugs: string[]) {
  const ids = new Map<string, string>();
  for (let i = 0; i < slugs.length; i += 40) {
    const rows = await q(ctx.sb.from('subjects').select('id, slug').in('slug', slugs.slice(i, i + 40)));
    for (const r of rows as any[]) ids.set(r.slug, r.id);
  }
  return ids;
}

export async function generateFromTemplate(ctx: Ctx, templateId: string): Promise<string> {
  const userId = await currentUserId(ctx);
  const today = ctx.today();
  const t: any = await q(ctx.sb.from('plan_templates').select('id, code, name, description, exam_edition_id, data').eq('id', templateId).maybeSingle());
  if (!t) throw notFound('Cronograma');
  const data = t.data as TemplateData;
  const profile = await loadProfile(ctx, userId);
  if (!profile.configured) throw badRequest('Configure seu tempo de estudo antes de gerar o planner.');
  const allMethods = await loadMethods(ctx, userId);
  const methods = allMethods.filter((m) => m.enabled);
  if (!methods.length) throw badRequest('Selecione pelo menos um método de estudo.');
  const byCode = new Map(allMethods.map((m) => [m.code, m]));
  const questionsMethod = byCode.get('questions') ?? methods[0];
  const reviewMethod = byCode.get('active_recall') ?? questionsMethod;

  const ids = await resolveSubjects(ctx, data.items.map((i) => i.slug));
  const missing = data.items.filter((i) => !ids.has(i.slug));
  if (missing.length) throw badRequest(`Faltam ${missing.length} assuntos do cronograma no banco: rode o arquivo supabase/data/cronograma_${t.code}.sql no SQL Editor.`);

  const edition = t.exam_edition_id as string | null;
  if (!edition) throw badRequest('A prova deste cronograma não está cadastrada.');
  const [ed] = await loadEditions(ctx, [edition]);
  const examDate: ISODate = ed?.exam_date ?? data.examDate;
  if (examDate <= today) throw badRequest('A prova deste cronograma já passou.');
  await saveSelection(ctx, userId, [edition], edition);

  // Ordem: o que tem data (na ordem do cronograma), depois as aulas de reserva e o que já foi estudado
  const dated = data.items.filter((i) => DATED.includes(i.kind) && i.date! < examDate).sort((a, b) => a.date!.localeCompare(b.date!));
  const ordered = [...dated, ...data.items.filter((i) => i.kind === 'reserve'), ...data.items.filter((i) => i.kind === 'studied')];
  const nEds = data.years.length;
  const totalQ = nEds * data.questionsPerExam;
  const maxTotal = Math.max(...ordered.map((i) => i.total ?? 0), 1);

  const subjects = ordered.map((i, k) => {
    const total = i.total ?? 0;
    const by = i.byYear ?? data.years.map(() => 0);
    const level = i.core ? LEVEL[i.core] ?? 'media' : DATED.includes(i.kind) ? 'media' : levelFromTotal(total);
    return {
      subject_id: ids.get(i.slug)!, historical_frequency: total, historical_percentage: total / totalQ,
      annual_average: total / nEds, years_present: by.filter((x) => x > 0).length, years_analyzed: nEds,
      recent_frequency: (by[nEds - 2] + by[nEds - 1]) / (2 * data.questionsPerExam), priority_score: total / maxTotal,
      priority_rank: k + 1, priority_level: level, estimated_questions: total / nEds, size_factor: 1,
      exam_date: examDate, scheduled: i.kind !== 'reserve',
      per_exam: [{
        editionId: edition, percentage: total / totalQ, questions: total, editionsPresent: by.filter((x) => x > 0).length,
        editionsAnalyzed: nEds, annualAverage: total / nEds, estimatedQuestions: total / nEds, rank: k + 1, level,
        byYear: data.years.map((year, j) => ({ year, questions: by[j] ?? 0 })),
        template: { kind: i.kind, date: i.date ?? null, lesson: i.lesson ?? null, color: i.color ?? null, focus: i.focus ?? null,
          detail: i.detail ?? null, refs: i.refs ?? [], cards: i.cards ?? null, saturday: i.saturday ?? null, core: i.core ?? null, fragile: !!i.fragile },
      }],
    };
  });

  // Atividades: aulas com os métodos do aluno; sábados, simulados e revisão final com uma atividade só
  const activities: any[] = [];
  const taskMethod = (i: TemplateItem) => (i.kind === 'review' ? reviewMethod : questionsMethod);
  for (const i of dated) {
    const ms = i.kind === 'lesson' ? methods : [taskMethod(i)];
    const rank = ordered.indexOf(i) + 1;
    for (const m of ms) activities.push({ subject_id: ids.get(i.slug), method_id: m.id, date: i.date, activity_type: m.activity_type, minutes: m.estimated_minutes, priority: rank });
  }
  for (const i of dated.filter((x) => x.kind !== 'lesson')) {
    await rpc(ctx, 'set_subject_activities', { p_subject: ids.get(i.slug), p_methods: [taskMethod(i).id] });
  }

  // O que já foi estudado entra concluído (data do último estudo no Anki)
  const studied = data.items.filter((i) => i.kind === 'studied');
  if (studied.length) {
    await q(ctx.sb.from('subject_method_progress').upsert(
      studied.flatMap((i) => methods.map((m) => ({ user_id: userId, subject_id: ids.get(i.slug), study_method_id: m.id, completed_at: `${data.studiedAt}T12:00:00-03:00` }))),
      { onConflict: 'user_id,subject_id,study_method_id', ignoreDuplicates: true }));
  }

  const lessonSlots = dated.filter((i) => i.kind === 'lesson').map((i) => i.date!);
  const covered = [...dated, ...studied].reduce((s, i) => s + (i.total ?? 0), 0);
  const label = `${ed?.institution ?? 'Prova'} - ${ed?.exam_name ?? ''}`;
  const planId = await savePlan(ctx, {
      name: t.name, start_date: today, end_date: examDate, primary_exam_edition_id: edition, mode: 'single',
      algorithm_version: `template:${t.code}`, scheduler_version: 'template_v1',
      settings_snapshot: {
        profile, methods: methods.map((m) => ({ id: m.id, code: m.code, minutes: m.estimated_minutes })), studyWeekdays: studyWeekdays(profile),
        template: { id: t.id, code: t.code, slots: lessonSlots, lessons: dated.filter((i) => i.kind === 'lesson').map((i) => ids.get(i.slug)) },
        studiedReviews: STUDIED_REVIEWS_VERSION,
      },
      summary: {
        template: { code: t.code, name: t.name, description: t.description, source: data.source },
        studyDays: new Set(dated.map((i) => i.date)).size, finalPhaseDays: dated.filter((i) => i.kind === 'review').length,
        historicalCoverageScheduled: covered / totalQ, warnings: [],
        weights: [{ editionId: edition, label, weight: 1, proximity: 1, daysUntil: null, excludedReason: null }],
        exams: [{ editionId: edition, label, examDate, editionsAnalyzed: nEds, years: data.years, totalQuestions: totalQ, sufficiency: 'good',
          message: `Seu cronograma MEDCOF, com a análise da ${ed?.institution ?? 'prova'} ${data.years[0]}–${data.years[nEds - 1]}.`, expectedTotalQuestions: data.questionsPerExam }],
      },
      exams: [{ exam_edition_id: edition, is_primary: true, weight: 1, exam_date: examDate, editions_analyzed: nEds }],
      subjects,
      activities,
  });
  await scheduleStudiedReviews(ctx, userId, planId, data, ids, examDate, profile);
  await readjustCards(ctx, userId, planId);
  return planId;
}

/** Versão da regra das revisões dos temas já estudados (planners antigos são corrigidos sozinhos). */
const STUDIED_REVIEWS_VERSION = 2;

/**
 * Temas já estudados (Anki) entram na fila de REVISÕES, por ordem de
 * importância: mais questões na prova primeiro; no empate, baralho frágil e
 * depois o que caiu em mais anos. Começam hoje (estão vencidos desde o último
 * estudo) e respeitam o limite de revisões por dia e os dias de estudo.
 * Temas já revisados no site mantêm a data que a revisão deu.
 */
async function scheduleStudiedReviews(ctx: Ctx, userId: string, planId: string, data: TemplateData, ids: Map<string, string>,
  examDate: ISODate, profile: Awaited<ReturnType<typeof loadProfile>>) {
  const today = ctx.today();
  const years = (i: TemplateItem) => (i.byYear ?? []).filter((x) => x > 0).length;
  const reviewed = new Set(((await selectAll((a, b) => ctx.sb.from('review_logs').select('subject_id').eq('user_id', userId)
    .not('previous_interval', 'is', null).range(a, b))) as any[]).map((r) => r.subject_id));
  const studied = data.items.filter((i) => i.kind === 'studied' && !reviewed.has(ids.get(i.slug)))
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || Number(!!b.fragile) - Number(!!a.fragile) || years(b) - years(a) || a.name.localeCompare(b.name));
  if (!studied.length) return;
  const cards = (await selectAll((a, b) => ctx.sb.from('spaced_repetition_cards').select('id, subject_id').eq('user_id', userId).range(a, b))) as any[];
  const cardBy = new Map(cards.map((c) => [c.subject_id, c.id]));
  const due = assignReviews(studied.map((i, k) => ({ id: i.slug, due: today, score: studied.length - k, examDate })),
    { today, perDay: profile.reviews_per_day, studyWeekdays: studyWeekdays(profile) });
  // Cartão que já existe e nunca foi revisado no site: só reposiciona na fila
  for (const i of studied.filter((x) => cardBy.has(ids.get(x.slug)))) {
    await q(ctx.sb.from('spaced_repetition_cards').update({ next_review_at: due.get(i.slug), study_plan_id: planId }).eq('id', cardBy.get(ids.get(i.slug))));
  }
  const rows = studied.filter((i) => !cardBy.has(ids.get(i.slug))).map((i) => {
    const res = review(null, i.fragile ? 'hard' : 'good', data.studiedAt, examDate);
    return {
      user_id: userId, subject_id: ids.get(i.slug), study_plan_id: planId, stability: res.state.stability, difficulty: res.state.difficulty,
      retrievability: 1, interval_days: res.intervalDays, repetitions: res.state.repetitions, lapses: res.state.lapses,
      last_review_at: `${data.studiedAt}T12:00:00-03:00`, next_review_at: due.get(i.slug), last_rating: i.fragile ? 'hard' : 'good',
      algorithm_version: MEMORY_VERSION,
    };
  });
  if (rows.length) await q(ctx.sb.from('spaced_repetition_cards').upsert(rows, { onConflict: 'user_id,subject_id', ignoreDuplicates: true }));
}

/**
 * Corrige planners de cronograma criados antes desta regra: cria/reposiciona
 * as revisões dos temas já estudados. Roda uma vez por planner.
 */
export async function ensureStudiedReviews(ctx: Ctx, userId: string, plan: any) {
  const snap = plan.settings_snapshot ?? {};
  if (!snap.template?.id || snap.studiedReviews === STUDIED_REVIEWS_VERSION) return false;
  const t: any = await q(ctx.sb.from('plan_templates').select('data').eq('id', snap.template.id).maybeSingle());
  if (!t) return false;
  const data = t.data as TemplateData;
  const ids = await resolveSubjects(ctx, data.items.filter((i) => i.kind === 'studied').map((i) => i.slug));
  const profile = await loadProfile(ctx, userId);
  await scheduleStudiedReviews(ctx, userId, plan.id, data, ids, plan.end_date, profile);
  const next = { ...snap, studiedReviews: STUDIED_REVIEWS_VERSION };
  await q(ctx.sb.from('study_plans').update({ settings_snapshot: next }).eq('id', plan.id));
  plan.settings_snapshot = next;
  return true;
}

/**
 * Fila do cronograma. Aulas pendentes ocupam, em ordem, os dias de aula do
 * cronograma a partir de amanhã (ou de hoje, ao reorganizar os atrasados).
 * Sábados de questões, simulados e revisão final não se movem.
 */
export async function reflowTemplate(ctx: Ctx, plan: any, opts: { includeOverdue?: boolean } = {}) {
  const today = ctx.today();
  const tpl = plan.settings_snapshot?.template;
  if (!tpl?.slots) return;
  const lessonOrder = new Map<string, number>((tpl.lessons as string[]).map((id, k) => [id, k]));
  const rows = await selectAll((a, b) => ctx.sb.from('study_schedule').select('*')
    .eq('study_plan_id', plan.id).neq('activity_type', 'review').range(a, b)) as any[];
  // Aulas arrastadas para um dia ficam nesse dia; aulas tiradas do planner saem da fila
  const pinned = new Set(rows.filter((r) => r.pinned && !r.completed).map((r) => r.subject_id));
  for (const id of await loadHidden(ctx, plan.user_id)) pinned.add(id);
  const current = new Map<string, ISODate>();
  for (const r of rows) {
    if (r.completed || !lessonOrder.has(r.subject_id) || pinned.has(r.subject_id)) continue;
    const d = current.get(r.subject_id);
    if (!d || r.scheduled_date < d) current.set(r.subject_id, r.scheduled_date);
  }
  const queue = [...current.entries()]
    .filter(([, d]) => (opts.includeOverdue ? true : d > today))
    .sort((a, b) => a[1].localeCompare(b[1]) || lessonOrder.get(a[0])! - lessonOrder.get(b[0])!);
  const slots = (tpl.slots as ISODate[]).filter((d) => (opts.includeOverdue ? d >= today : d > today)).sort();
  if (!slots.length) return;
  for (let k = 0; k < queue.length; k++) {
    const [subjectId, d] = queue[k];
    const target = slots[Math.min(k, slots.length - 1)];
    if (target !== d) {
      await q(ctx.sb.from('study_schedule').update({ scheduled_date: target })
        .eq('study_plan_id', plan.id).eq('subject_id', subjectId).eq('completed', false));
    }
  }
}

/** "Reorganizar a partir de hoje" num cronograma: atrasadas entram na fila a partir de hoje. */
export async function replanTemplate(ctx: Ctx) {
  const userId = await currentUserId(ctx);
  const plan = await activePlan(ctx, userId);
  if (!plan) throw badRequest('Nenhum planner ativo.');
  await reflowTemplate(ctx, plan, { includeOverdue: true });
  return plan.id as string;
}
