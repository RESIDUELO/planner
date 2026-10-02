/**
 * Residências: a lista pessoal de residências (datas das etapas, vagas,
 * taxa, situação). Uma residência pode ser ligada a uma prova da aba Provas;
 * aí a data da prova é uma só: a de Provas (a oficial, quando cadastrada).
 */
import { z } from 'zod';
import {
  applyHidden, catalogDates, DEFAULT_STEPS, defaultSteps, RANGE_KEYS, withCatalog, type CatalogEntry, type Residency, type Step, type StepKey,
} from '../../../shared/residency';
import { ApiError, badRequest, currentUserId, notFound, q, rpc, selectAll, type Ctx } from './core';

const BASE_COLS = 'id, name, city, edital_url, specialties, institutions, fee, reduction_requested, reduction_granted, paid, decision, enrolled, notes, steps, exam_edition_id, created_at';
/**
 * Colunas que só existem depois de rodar o SQL delas (catalog_id: 17_residency_catalog.sql,
 * my_score: 19_residency_score.sql); até lá a lista continua funcionando.
 */
const OPTIONAL_COLS = ['catalog_id', 'my_score'] as const;
let present: Set<string> | null = null;
async function optionalCols(ctx: Ctx) {
  if (!present) {
    const found = new Set<string>();
    for (const c of OPTIONAL_COLS) if (!(await ctx.sb.from('residencies').select(c).limit(1)).error) found.add(c);
    present = found;
  }
  return present;
}
async function cols(ctx: Ctx) {
  const extra = [...(await optionalCols(ctx))];
  return extra.length ? `${BASE_COLS}, ${extra.join(', ')}` : BASE_COLS;
}

function toResidency(r: any): Residency {
  return {
    id: r.id, name: r.name, city: r.city ?? '', editalUrl: r.edital_url ?? '',
    specialties: Array.isArray(r.specialties) ? r.specialties : [],
    institutions: Array.isArray(r.institutions) ? r.institutions : [],
    fee: r.fee != null ? Number(r.fee) : null,
    reductionRequested: !!r.reduction_requested, reductionGranted: r.reduction_granted ?? null, paid: !!r.paid,
    decision: r.decision ?? 'maybe', enrolled: !!r.enrolled, notes: r.notes ?? '', myScore: r.my_score ?? '',
    steps: Array.isArray(r.steps) && r.steps.length ? r.steps : defaultSteps(),
    examEditionId: r.exam_edition_id ?? null, catalogId: r.catalog_id ?? null, createdAt: r.created_at,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD).');
/** Id do catálogo: os cadastrados por arquivo (md5) têm formato de UUID, mas não a versão 4. */
export const catalogUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Id inválido.');
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
  hidden: z.boolean().optional(),
  own: z.boolean().optional(),
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
  myScore: text(60),
  steps: z.array(step).max(40),
  examEditionId: z.string().uuid().nullable(),
};
const createSchema = z.object({ ...fields, catalogId: catalogUuid.nullable() }).partial().required({ name: true });
const updateSchema = z.object(fields).partial();
type Patch = z.infer<typeof updateSchema>;

function checkSteps(steps: Step[]) {
  for (const s of steps) {
    if (s.end && !RANGE_KEYS.includes(s.key)) s.end = null;
    if (s.date && s.end && s.date > s.end) throw badRequest(`${s.label}: o início precisa ser antes do fim.`);
  }
  if (new Set(steps.map((s) => s.id)).size !== steps.length) throw badRequest('Etapas repetidas.');
}

function toRow(b: Patch & { catalogId?: string | null }) {
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
  if (b.myScore !== undefined) r.my_score = b.myScore;
  if (b.steps !== undefined) r.steps = b.steps;
  if (b.examEditionId !== undefined) r.exam_edition_id = b.examEditionId;
  if (b.catalogId) r.catalog_id = b.catalogId;
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

type Linked = Residency & {
  exam: { institution: string; name: string; official: boolean } | null;
  /** Do catálogo: as datas oficiais de cada etapa. */
  catalog: { id: string; official: Record<string, { date: string | null; end: string | null }> } | null;
};

async function withExams(ctx: Ctx, uid: string, raw: Residency[]): Promise<Linked[]> {
  const cat = await catalogByIds(ctx, [...new Set(raw.map((r) => r.catalogId).filter(Boolean) as string[])]);
  const list = raw.map((r) => {
    const c = r.catalogId ? cat.get(r.catalogId) : undefined;
    return c ? { ...withCatalog(r, c), catalog: { id: c.id, official: catalogDates(c) } } : { ...r, catalog: null };
  });
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
  await syncCatalog(ctx);
  const c = await cols(ctx);
  const rows = await selectAll((a, b) => ctx.sb.from('residencies').select(c).eq('user_id', uid).order('created_at').range(a, b));
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

/** Sem a coluna da nota no banco (SQL 19 não rodado): avisa se há nota para guardar; senão, só não grava. */
async function scoreFits(ctx: Ctx, row: Record<string, unknown>) {
  if (!('my_score' in row) || (await optionalCols(ctx)).has('my_score')) return row;
  if (row.my_score) throw badRequest('Para guardar a nota, o banco do site precisa ser atualizado: no Supabase, rode o arquivo supabase/parts/19_residency_score.sql.');
  const { my_score: _, ...rest } = row;
  return rest;
}

async function one(ctx: Ctx, uid: string, id: string) {
  const r: any = await q(ctx.sb.from('residencies').select(await cols(ctx)).eq('id', id).eq('user_id', uid).maybeSingle());
  if (!r) throw notFound('Residência');
  return (await withExams(ctx, uid, [toResidency(r)]))[0];
}

export async function createResidency(ctx: Ctx, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = createSchema.parse(body);
  const steps = b.steps ?? defaultSteps();
  checkSteps(steps);
  const r: any = await q(ctx.sb.from('residencies').insert({ ...(await scoreFits(ctx, toRow({ ...b, steps }))), user_id: uid }).select(await cols(ctx)).single()).catch(denied);
  const res = toResidency(r);
  await syncExam(ctx, uid, res, !!res.steps.find((s) => s.key === 'prova')?.date);
  return one(ctx, uid, res.id);
}

export async function updateResidency(ctx: Ctx, id: string, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = updateSchema.parse(body);
  const before = await one(ctx, uid, id);
  if (b.steps) checkSteps(b.steps);
  const r: any = await q(ctx.sb.from('residencies').update({ ...(await scoreFits(ctx, toRow(b))), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', uid).select(await cols(ctx)).single()).catch(denied);
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

// ============================================================================
// Catálogo: residências com as datas cadastradas pela administração
// ============================================================================
const CATALOG_COLS = 'id, name, city, edital_url, specialties, institutions, fee, steps, exam_edition_id, notes, published, updated_at';

function toEntry(r: any): CatalogEntry {
  return {
    id: r.id, name: r.name, city: r.city ?? '', editalUrl: r.edital_url ?? '',
    specialties: Array.isArray(r.specialties) ? r.specialties : [],
    institutions: Array.isArray(r.institutions) ? r.institutions : [],
    fee: r.fee != null ? Number(r.fee) : null,
    steps: (Array.isArray(r.steps) && r.steps.length ? r.steps : defaultSteps()).map((s: Step) => ({ ...s, done: false })),
    examEditionId: r.exam_edition_id ?? null, notes: r.notes ?? '', published: r.published !== false, updatedAt: r.updated_at,
  };
}

/** Catálogo ainda não criado no banco (falta rodar 17_residency_catalog.sql). */
const missing = (e: unknown) => e instanceof ApiError && e.status === 503;

async function catalogByIds(ctx: Ctx, ids: string[]) {
  const out = new Map<string, CatalogEntry>();
  if (!ids.length) return out;
  const rows = await q<any[]>(ctx.sb.from('residency_catalog').select(CATALOG_COLS).in('id', ids)).catch((e) => { if (missing(e)) return []; throw e; });
  for (const r of rows) out.set(r.id, toEntry(r));
  return out;
}

/**
 * App off-line: o catálogo vem do site quando há internet (no máximo a cada
 * 10 minutos) e fica guardado no aparelho. Sem internet, vale o guardado.
 */
let catalogSource: (() => Promise<any[] | null>) | null = null;
let lastSync = 0;
export function setCatalogSource(f: typeof catalogSource) { catalogSource = f; lastSync = 0; }

async function syncCatalog(ctx: Ctx) {
  if (!catalogSource || Date.now() - lastSync < 10 * 60_000) return;
  lastSync = Date.now();
  const rows = await catalogSource().catch(() => null);
  if (!rows) return;
  const keep = rows.map((r) => ({
    id: r.id, name: r.name, city: r.city ?? '', edital_url: r.edital_url ?? '', specialties: r.specialties ?? [], institutions: r.institutions ?? [],
    fee: r.fee ?? null, steps: r.steps ?? [], exam_edition_id: null, notes: r.notes ?? '', published: true, updated_at: r.updated_at ?? new Date().toISOString(),
  }));
  // A prova ligada só vale se ela existe também no aparelho
  const editions = [...new Set(rows.map((r) => r.exam_edition_id).filter(Boolean))] as string[];
  const known = editions.length ? new Set((await q<any[]>(ctx.sb.from('exam_editions').select('id').in('id', editions)).catch(() => [])).map((e) => e.id)) : new Set();
  keep.forEach((k, i) => { if (known.has(rows[i].exam_edition_id)) k.exam_edition_id = rows[i].exam_edition_id; });
  try {
    if (keep.length) await q(ctx.sb.from('residency_catalog').upsert(keep));
    const del = ctx.sb.from('residency_catalog').delete();
    await q(keep.length ? del.not('id', 'in', `(${keep.map((k) => k.id).join(',')})`) : del.neq('id', '00000000-0000-0000-0000-000000000000'));
  } catch { /* fica o que já estava guardado */ }
}

export async function listCatalog(ctx: Ctx) {
  await currentUserId(ctx);
  await syncCatalog(ctx);
  const rows = await q<any[]>(ctx.sb.from('residency_catalog').select(CATALOG_COLS).order('name')).catch((e) => { if (missing(e)) return null; throw e; });
  if (!rows) return { ready: false, entries: [] };
  const entries = rows.map(toEntry);
  const dates = await examDates(ctx, await currentUserId(ctx), [...new Set(entries.map((e) => e.examEditionId).filter(Boolean) as string[])]);
  return {
    ready: true,
    entries: entries.map((e) => {
      const official = e.examEditionId ? dates.get(e.examEditionId) : undefined;
      // Data oficial da prova (de Provas) vale também aqui
      return official?.official && official.date ? { ...e, steps: e.steps.map((s) => (s.key === 'prova' ? { ...s, date: official.date } : s)) } : e;
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

/** Coloca na lista da pessoa as residências escolhidas do catálogo (as que ela já tem ficam como estão). */
export async function addFromCatalog(ctx: Ctx, body: unknown) {
  const uid = await currentUserId(ctx);
  const { ids } = z.object({ ids: z.array(catalogUuid).min(1, 'Escolha pelo menos uma residência.').max(100) }).parse(body);
  const hidden = await hiddenPref(ctx, uid);
  if (!(await cols(ctx)).includes('catalog_id')) {
    throw new ApiError(503, 'O banco do site está desatualizado: rode no Supabase o arquivo supabase/parts/17_residency_catalog.sql.');
  }
  const have = new Set((await q<any[]>(ctx.sb.from('residencies').select('catalog_id').eq('user_id', uid).in('catalog_id', ids))).map((r) => r.catalog_id));
  const cat = await catalogByIds(ctx, ids);
  const added: string[] = [];
  for (const id of ids) {
    const c = cat.get(id);
    if (!c || have.has(id)) continue;
    const r = await createResidency(ctx, {
      catalogId: c.id, name: c.name, city: c.city, editalUrl: c.editalUrl, specialties: c.specialties, institutions: c.institutions,
      fee: c.fee, steps: applyHidden(c.steps, hidden), examEditionId: c.examEditionId, decision: 'yes',
    });
    added.push(r.id);
  }
  return { ok: true, added: added.length };
}

// Administração do catálogo (o banco confere o papel; aqui só a mensagem fica mais clara)
const catalogSchema = z.object({
  name: fields.name, city: fields.city, editalUrl: fields.editalUrl, specialties: fields.specialties, institutions: fields.institutions,
  fee: fields.fee, steps: fields.steps, examEditionId: fields.examEditionId, notes: fields.notes, published: z.boolean(),
}).partial();

async function requireAdmin(ctx: Ctx) {
  const uid = await currentUserId(ctx);
  const p: any = await q(ctx.sb.from('user_profiles').select('role').eq('user_id', uid).maybeSingle());
  if (p?.role !== 'admin') throw new ApiError(403, 'Só a administração cadastra residências no catálogo.');
}

function catalogRow(b: z.infer<typeof catalogSchema>) {
  const r: Record<string, unknown> = {};
  if (b.name !== undefined) r.name = b.name;
  if (b.city !== undefined) r.city = b.city;
  if (b.editalUrl !== undefined) r.edital_url = b.editalUrl;
  if (b.specialties !== undefined) r.specialties = b.specialties;
  if (b.institutions !== undefined) r.institutions = b.institutions;
  if (b.fee !== undefined) r.fee = b.fee;
  if (b.steps !== undefined) r.steps = b.steps.map((s) => ({ ...s, done: false }));
  if (b.examEditionId !== undefined) r.exam_edition_id = b.examEditionId;
  if (b.notes !== undefined) r.notes = b.notes;
  if (b.published !== undefined) r.published = b.published;
  return r;
}

export async function createCatalogEntry(ctx: Ctx, body: unknown) {
  await requireAdmin(ctx);
  const b = catalogSchema.required({ name: true }).parse(body);
  if (b.steps) checkSteps(b.steps);
  const r: any = await q(ctx.sb.from('residency_catalog').insert(catalogRow({ steps: defaultSteps(), ...b })).select(CATALOG_COLS).single());
  return toEntry(r);
}

export async function updateCatalogEntry(ctx: Ctx, id: string, body: unknown) {
  await requireAdmin(ctx);
  const b = catalogSchema.parse(body);
  if (b.steps) checkSteps(b.steps);
  const r: any = await q(ctx.sb.from('residency_catalog').update({ ...catalogRow(b), updated_at: new Date().toISOString() }).eq('id', id).select(CATALOG_COLS).maybeSingle());
  if (!r) throw notFound('Residência do catálogo');
  return toEntry(r);
}

export async function deleteCatalogEntry(ctx: Ctx, id: string) {
  await requireAdmin(ctx);
  await q(ctx.sb.from('residency_catalog').delete().eq('id', id));
  return { ok: true };
}

// ============================================================================
// Datas que a pessoa quer ver (ex.: sem isenção) e "resetar todas"
// ============================================================================
const STEP_KEYS = DEFAULT_STEPS.map((s) => s.key);

/** Etapas que a pessoa prefere não ver (vale para as residências que ela escolher depois). */
async function hiddenPref(ctx: Ctx, uid: string): Promise<StepKey[]> {
  const { data, error } = await ctx.sb.from('user_profiles').select('residency_hidden_steps').eq('user_id', uid).maybeSingle();
  if (error) return []; // coluna ainda não criada (17_residency_catalog.sql)
  return ((data as any)?.residency_hidden_steps ?? []).filter((k: any) => STEP_KEYS.includes(k));
}

export async function getVisibleSteps(ctx: Ctx) {
  const uid = await currentUserId(ctx);
  return { hidden: await hiddenPref(ctx, uid) };
}

/** Salva a preferência e esconde/mostra essas etapas em todas as residências da lista. */
export async function setVisibleSteps(ctx: Ctx, body: unknown) {
  const uid = await currentUserId(ctx);
  const b = z.object({ hidden: z.array(z.enum(STEP_KEYS as [StepKey, ...StepKey[]])).max(20) }).parse(body);
  // Só muda o que mudou na preferência: etapa escondida numa residência só continua escondida
  const before = await hiddenPref(ctx, uid);
  const hide = b.hidden.filter((k) => !before.includes(k));
  const show = before.filter((k) => !b.hidden.includes(k));
  await ctx.sb.from('user_profiles').update({ residency_hidden_steps: b.hidden }).eq('user_id', uid);
  const rows = await selectAll((a, z2) => ctx.sb.from('residencies').select('*').eq('user_id', uid).range(a, z2));
  const entries = await catalogByIds(ctx, [...new Set((rows as any[]).map((r) => r.catalog_id).filter(Boolean))]);
  for (const r of rows as any[]) {
    let steps: Step[] = Array.isArray(r.steps) && r.steps.length ? r.steps : defaultSteps();
    // Etapa do catálogo que ainda não está guardada na residência dela: entra para guardar o "escondida"
    const c = r.catalog_id ? entries.get(r.catalog_id) : undefined;
    if (c) {
      const have = new Set(steps.map((x) => x.id));
      steps = [...steps, ...c.steps.filter((x) => !have.has(x.id)).map((x) => ({ ...x, date: null, end: null }))];
    }
    await q(ctx.sb.from('residencies').update({ steps: applyHidden(steps, hide, show) }).eq('id', r.id).eq('user_id', uid));
  }
  return { ok: true, hidden: b.hidden };
}

/** Tira todas as residências da lista (para escolher de novo). */
export async function deleteAllResidencies(ctx: Ctx) {
  const uid = await currentUserId(ctx);
  const rows = await q<any[]>(ctx.sb.from('residencies').select('id').eq('user_id', uid));
  await q(ctx.sb.from('residencies').delete().eq('user_id', uid));
  return { ok: true, removed: rows.length };
}
