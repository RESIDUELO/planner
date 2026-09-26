/**
 * Residências: a lista pessoal de residências (datas das etapas, vagas,
 * taxa, situação). Uma residência pode ser ligada a uma prova da aba Provas;
 * aí a data da prova é uma só: a de Provas (a oficial, quando cadastrada).
 */
import { z } from 'zod';
import { defaultSteps, RANGE_KEYS, type Residency, type Step } from '../../../shared/residency';
import { ApiError, badRequest, currentUserId, notFound, q, rpc, selectAll, type Ctx } from './core';

const COLS = 'id, name, city, edital_url, specialties, institutions, fee, reduction_requested, reduction_granted, paid, decision, enrolled, notes, steps, exam_edition_id, created_at';

function toResidency(r: any): Residency {
  return {
    id: r.id, name: r.name, city: r.city ?? '', editalUrl: r.edital_url ?? '',
    specialties: Array.isArray(r.specialties) ? r.specialties : [],
    institutions: Array.isArray(r.institutions) ? r.institutions : [],
    fee: r.fee != null ? Number(r.fee) : null,
    reductionRequested: !!r.reduction_requested, reductionGranted: r.reduction_granted ?? null, paid: !!r.paid,
    decision: r.decision ?? 'maybe', enrolled: !!r.enrolled, notes: r.notes ?? '',
    steps: Array.isArray(r.steps) && r.steps.length ? r.steps : defaultSteps(),
    examEditionId: r.exam_edition_id ?? null, createdAt: r.created_at,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');
const text = (max: number) => z.string().trim().max(max);
const specialty = z.object({
  name: text(80).min(1, 'Escreva a especialidade.'),
  vacancies: z.number().int().nonnegative().max(10000).nullable(),
  cutoff: text(30),
});
const step = z.object({
  id: z.string().min(1).max(60),
  key: z.enum(['edital', 'reducao', 'inscricao', 'boleto', 'local', 'prova', 'gabarito', 'recurso', 'resultado1', 'fase2', 'final', 'custom']),
  label: text(80).min(1, 'Escreva o nome da etapa.'),
  type: z.enum(['inscricao', 'prova', 'resultado']),
  date: isoDate.nullable(),
  end: isoDate.nullable(),
  done: z.boolean(),
});
const fields = {
  name: text(120).min(1, 'Escreva o nome da residência.'),
  city: text(120),
  editalUrl: text(1000),
  specialties: z.array(specialty).max(30),
  institutions: z.array(z.object({ name: text(120).min(1, 'Escreva o nome da instituição.'), city: text(120), specialties: z.array(specialty).max(30) })).max(100),
  fee: z.number().nonnegative().max(100000).nullable(),
  reductionRequested: z.boolean(),
  reductionGranted: z.boolean().nullable(),
  paid: z.boolean(),
  decision: z.enum(['yes', 'maybe', 'no']),
  enrolled: z.boolean(),
  notes: z.string().max(5000),
  steps: z.array(step).max(40),
  examEditionId: z.string().uuid().nullable(),
};
const createSchema = z.object(fields).partial().required({ name: true });
const updateSchema = z.object(fields).partial();
type Patch = z.infer<typeof updateSchema>;

function checkSteps(steps: Step[]) {
  for (const s of steps) {
    if (s.end && !RANGE_KEYS.includes(s.key)) s.end = null;
    if (s.date && s.end && s.date > s.end) throw badRequest(`${s.label}: o início precisa ser antes do fim.`);
  }
  if (new Set(steps.map((s) => s.id)).size !== steps.length) throw badRequest('Etapas repetidas.');
}

function toRow(b: Patch) {
  const r: Record<string, unknown> = {};
  if (b.name !== undefined) r.name = b.name;
  if (b.city !== undefined) r.city = b.city;
  if (b.editalUrl !== undefined) r.edital_url = b.editalUrl;
  if (b.specialties !== undefined) r.specialties = b.specialties;
  if (b.institutions !== undefined) r.institutions = b.institutions;
  if (b.fee !== undefined) r.fee = b.fee;
  if (b.reductionRequested !== undefined) r.reduction_requested = b.reductionRequested;
  if (b.reductionGranted !== undefined) r.reduction_granted = b.reductionGranted;
  if (b.paid !== undefined) r.paid = b.paid;
  if (b.decision !== undefined) r.decision = b.decision;
  if (b.enrolled !== undefined) r.enrolled = b.enrolled;
  if (b.notes !== undefined) r.notes = b.notes;
  if (b.steps !== undefined) r.steps = b.steps;
  if (b.examEditionId !== undefined) r.exam_edition_id = b.examEditionId;
  return r;
}

/** O banco recusou gravar: quase sempre a tabela foi criada sem as permissões (SQL rodado pela metade). */
function denied(e: unknown): never {
  if (e instanceof ApiError && e.status === 403) {
    throw new ApiError(403, 'O banco do site não deixou salvar a residência. No Supabase, rode de novo o arquivo supabase/parts/15_residencies.sql (ele refaz as permissões da tabela) e tente outra vez.', e.details);
  }
  throw e;
}

/** Data da prova em Provas: a oficial, quando cadastrada; senão, a informada pelo aluno. */
async function examDates(ctx: Ctx, uid: string, ids: string[]) {
  const out = new Map<string, { date: string | null; official: boolean; institution: string; exam: string }>();
  if (!ids.length) return out;
  const cat = await q<any[]>(ctx.sb.from('exam_catalog').select('edition_id, institution, exam_name, exam_date').in('edition_id', ids));
  const mine = await q<any[]>(ctx.sb.from('user_exam_editions').select('exam_edition_id, exam_date').eq('user_id', uid).in('exam_edition_id', ids));
  for (const c of cat) {
    const m = mine.find((x) => x.exam_edition_id === c.edition_id);
    out.set(c.edition_id, { date: c.exam_date ?? m?.exam_date ?? null, official: !!c.exam_date, institution: c.institution, exam: c.exam_name });
  }
  return out;
}

type Linked = Residency & { exam: { institution: string; name: string; official: boolean } | null };

async function withExams(ctx: Ctx, uid: string, list: Residency[]): Promise<Linked[]> {
  const dates = await examDates(ctx, uid, [...new Set(list.map((r) => r.examEditionId).filter(Boolean) as string[])]);
  return list.map((r) => {
    const e = r.examEditionId ? dates.get(r.examEditionId) : undefined;
    if (!e) return { ...r, exam: null };
    const steps = e.date ? r.steps.map((s) => (s.key === 'prova' ? { ...s, date: e.date } : s)) : r.steps;
    return { ...r, steps, exam: { institution: e.institution, name: e.exam, official: e.official } };
  });
}

export async function listResidencies(ctx: Ctx) {
  const uid = await currentUserId(ctx);
  const rows = await selectAll((a, b) => ctx.sb.from('residencies').select(COLS).eq('user_id', uid).order('created_at').range(a, b));
  return withExams(ctx, uid, (rows as any[]).map(toResidency));
}

/**
 * Residência ligada a uma prova: a data da prova passa a ser uma só.
 * Mudou aqui → grava em Provas (menos a data oficial, que é fixa).
 * Acabou de ligar e aqui não há data → fica a de Provas.
 */
async function syncExam(ctx: Ctx, uid: string, r: Residency, provaChanged: boolean) {
  if (!r.examEditionId) return;
  const prova = r.steps.find((s) => s.key === 'prova');
  const e = (await examDates(ctx, uid, [r.examEditionId])).get(r.examEditionId);
  if (!e) throw badRequest('Prova não encontrada em Provas.');
  // Data oficial é fixa: vale a de Provas
  if (e.official) return;
  if (!prova?.date || prova.date === e.date || (!provaChanged && e.date)) return;
  const cur: any = await q(ctx.sb.from('user_exam_editions').select('registration_start, registration_end, registration_fee')
    .eq('user_id', uid).eq('exam_edition_id', r.examEditionId).maybeSingle());
  await rpc(ctx, 'set_exam_details', {
    p_edition: r.examEditionId, p_exam_date: prova.date,
    p_registration_start: cur?.registration_start ?? null, p_registration_end: cur?.registration_end ?? null, p_registration_fee: cur?.registration_fee ?? null,
  });
}

async function one(ctx: Ctx, uid: string, id: string) {
  const r: any = await q(ctx.sb.from('residencies').select(COLS).eq('id', id).eq('user_id', uid).maybeSingle());
  if (!r) throw notFound('Residência');
  return (await withExams(ctx, uid, [toResidency(r)]))[0];
}

export async function createResidency(ctx: Ctx, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = createSchema.parse(body);
  const steps = b.steps ?? defaultSteps();
  checkSteps(steps);
  const r: any = await q(ctx.sb.from('residencies').insert({ ...toRow({ ...b, steps }), user_id: uid }).select(COLS).single()).catch(denied);
  const res = toResidency(r);
  await syncExam(ctx, uid, res, !!res.steps.find((s) => s.key === 'prova')?.date);
  return one(ctx, uid, res.id);
}

export async function updateResidency(ctx: Ctx, id: string, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = updateSchema.parse(body);
  const before = await one(ctx, uid, id);
  if (b.steps) checkSteps(b.steps);
  const r: any = await q(ctx.sb.from('residencies').update({ ...toRow(b), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', uid).select(COLS).single()).catch(denied);
  const res = toResidency(r);
  const provaOf = (x: Residency) => x.steps.find((s) => s.key === 'prova')?.date ?? null;
  const linkedNow = b.examEditionId !== undefined && b.examEditionId !== before.examEditionId;
  await syncExam(ctx, uid, res, linkedNow ? !!provaOf(res) && !!b.steps : !!b.steps && provaOf(res) !== provaOf(before));
  return one(ctx, uid, id);
}

export async function deleteResidency(ctx: Ctx, id: string) {
  const uid = await currentUserId(ctx);
  await q(ctx.sb.from('residencies').delete().eq('id', id).eq('user_id', uid));
  return { ok: true };
}
