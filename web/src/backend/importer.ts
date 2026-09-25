/**
 * Importação de questões (CSV, XLSX, JSON) — seções 42 e 43.
 *
 * Roda no navegador do administrador. Fluxo em duas etapas:
 *   1. preview: lê o arquivo, valida linha a linha, detecta duplicadas e
 *      lista áreas/assuntos NÃO encontrados. Nada é gravado.
 *   2. commit: o administrador reenvia o arquivo com uma decisão para cada
 *      item desconhecido (associar a existente / criar / ignorar). Só então,
 *      numa única transação, as questões são inseridas.
 *
 * Nenhum assunto é criado automaticamente.
 */
import Papa from 'papaparse';
import { badRequest, currentUserId, q, rpc, type Ctx } from './core';

export interface ImportRow {
  line: number;
  year: number | null;
  question_number: number | null;
  area: string | null;
  specialty: string | null;
  subject: string | null;
  subsubject: string | null;
  statement: string | null;
  summary: string | null;
  alternative_a: string | null;
  alternative_b: string | null;
  alternative_c: string | null;
  alternative_d: string | null;
  alternative_e: string | null;
  correct_answer: string | null;
  annulled: boolean;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  question_type: string | null;
  guideline: string | null;
  source: string | null;
  notes: string | null;
  errors: string[];
}

const KEY_ALIASES: Record<string, keyof ImportRow> = {
  year: 'year', ano: 'year', edicao: 'year',
  question_number: 'question_number', numero: 'question_number', questao: 'question_number', q: 'question_number', n: 'question_number', no: 'question_number',
  area: 'area', grande_area: 'area',
  specialty: 'specialty', especialidade: 'specialty',
  subject: 'subject', assunto: 'subject', tema: 'subject',
  subsubject: 'subsubject', subassunto: 'subsubject', subtema: 'subsubject',
  statement: 'statement', enunciado: 'statement',
  summary: 'summary', resumo: 'summary', o_que_cobra: 'summary',
  alternative_a: 'alternative_a', alternativa_a: 'alternative_a', a: 'alternative_a',
  alternative_b: 'alternative_b', alternativa_b: 'alternative_b', b: 'alternative_b',
  alternative_c: 'alternative_c', alternativa_c: 'alternative_c', c: 'alternative_c',
  alternative_d: 'alternative_d', alternativa_d: 'alternative_d', d: 'alternative_d',
  alternative_e: 'alternative_e', alternativa_e: 'alternative_e', e: 'alternative_e',
  correct_answer: 'correct_answer', gabarito: 'correct_answer', resposta: 'correct_answer',
  annulled: 'annulled', anulada: 'annulled',
  explanation: 'explanation', explicacao: 'explanation', comentario: 'explanation',
  difficulty: 'difficulty', dificuldade: 'difficulty',
  question_type: 'question_type', tipo: 'question_type',
  guideline: 'guideline', diretriz: 'guideline',
  source: 'source', fonte: 'source',
  notes: 'notes', observacoes: 'notes', observacao: 'notes',
};

export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const DIFF: Record<string, ImportRow['difficulty']> = {
  easy: 'easy', facil: 'easy', f: 'easy',
  medium: 'medium', media: 'medium', medio: 'medium', m: 'medium',
  hard: 'hard', dificil: 'hard', d: 'hard',
};

function toRow(raw: Record<string, unknown>, line: number): ImportRow {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = KEY_ALIASES[norm(k).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')];
    if (key) r[key] = v;
  }
  const errors: string[] = [];
  const year = Number(str(r.year));
  const qn = Number(str(r.question_number));
  let ans = str(r.correct_answer)?.toUpperCase() ?? null;
  const annulledRaw = r.annulled;
  let annulled = annulledRaw === true || ['sim', 's', 'true', '1', 'x', 'yes'].includes(norm(str(annulledRaw)));
  if (ans === 'X' || (ans && norm(ans).startsWith('anul'))) {
    annulled = true;
    ans = null;
  }
  if (ans && !/^[A-E]$/.test(ans)) {
    errors.push(`Gabarito inválido: "${ans}"`);
    ans = null;
  }
  const diffRaw = norm(str(r.difficulty));
  const difficulty = diffRaw ? DIFF[diffRaw] ?? null : null;
  if (diffRaw && !difficulty) errors.push(`Dificuldade inválida: "${str(r.difficulty)}"`);

  const row: ImportRow = {
    line,
    year: Number.isInteger(year) && year >= 1990 && year <= 2100 ? year : null,
    question_number: Number.isInteger(qn) && qn > 0 ? qn : null,
    area: str(r.area),
    specialty: str(r.specialty),
    subject: str(r.subject),
    subsubject: str(r.subsubject),
    statement: str(r.statement),
    summary: str(r.summary),
    alternative_a: str(r.alternative_a),
    alternative_b: str(r.alternative_b),
    alternative_c: str(r.alternative_c),
    alternative_d: str(r.alternative_d),
    alternative_e: str(r.alternative_e),
    correct_answer: ans,
    annulled,
    explanation: str(r.explanation),
    difficulty,
    question_type: str(r.question_type),
    guideline: str(r.guideline),
    source: str(r.source),
    notes: str(r.notes),
    errors,
  };
  if (row.year == null) errors.push('Ano ausente ou inválido');
  if (row.question_number == null) errors.push('Número da questão ausente ou inválido');
  if (!row.correct_answer && !row.annulled) errors.push('Gabarito ausente (use A–E ou marque como anulada)');
  if (!row.statement && !row.summary) errors.push('Informe o enunciado ou o resumo do que a questão cobra');
  if (row.subject && !row.area) errors.push('Assunto informado sem grande área');
  return row;
}

export interface ParsedFile {
  format: 'csv' | 'xlsx' | 'json';
  rows: ImportRow[];
  meta: { source?: string | null; exam_hint?: unknown };
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function parseFile(filename: string, contentBase64: string): Promise<ParsedFile> {
  const bytes = decodeBase64(contentBase64);
  const text = () => new TextDecoder('utf-8').decode(bytes);
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'json') {
    let doc: any;
    try {
      doc = JSON.parse(text());
    } catch {
      throw badRequest('JSON inválido.');
    }
    const list = Array.isArray(doc) ? doc : doc?.questions;
    if (!Array.isArray(list)) throw badRequest('O JSON deve ser uma lista de questões ou um objeto com a chave "questions".');
    return { format: 'json', rows: list.map((r: any, i: number) => toRow(r ?? {}, i + 1)), meta: { source: doc?.source ?? null, exam_hint: doc?.exam_hint } };
  }
  if (ext === 'csv') {
    const res = Papa.parse<Record<string, string>>(text().replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
    if (res.errors.length && !res.data.length) throw badRequest(`CSV inválido: ${res.errors[0].message}`);
    return { format: 'csv', rows: res.data.map((r, i) => toRow(r, i + 2)), meta: {} };
  }
  if (ext === 'xlsx') {
    let sheet: unknown[][];
    try {
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const parsed: any = await readXlsxFile(new Blob([bytes as BlobPart]));
      sheet = Array.isArray(parsed?.[0]?.data) ? parsed[0].data : parsed;
    } catch {
      throw badRequest('Planilha XLSX inválida.');
    }
    const [header, ...data] = sheet;
    if (!header) throw badRequest('Planilha vazia.');
    const keys = header.map((h) => String(h ?? ''));
    return {
      format: 'xlsx',
      rows: data
        .filter((r) => r.some((c) => c != null && String(c).trim() !== ''))
        .map((r, i) => toRow(Object.fromEntries(keys.map((k, j) => [k, r[j]])), i + 2)),
      meta: {},
    };
  }
  throw badRequest('Formato não suportado. Use CSV, XLSX ou JSON.');
}

// ---------------------------------------------------------------------------
// Resolução de áreas e assuntos
// ---------------------------------------------------------------------------

export type UnknownKind = 'area' | 'specialty' | 'subject' | 'subsubject';
export interface UnknownItem {
  key: string;
  kind: UnknownKind;
  name: string;
  parentKey: string | null;
  parentName: string | null;
  rows: number;
  suggestions: { id: string; name: string; path: string }[];
}

export type Resolution = { action: 'map'; id: string } | { action: 'create' } | { action: 'ignore' };

interface Catalog {
  areas: { id: string; parent_id: string | null; name: string }[];
  subjects: { id: string; parent_subject_id: string | null; medical_area_id: string; name: string }[];
  aliases: { alias: string; subject_id: string }[];
}

async function loadCatalog(ctx: Ctx): Promise<Catalog> {
  return rpc<Catalog>(ctx, 'admin_catalog');
}

const keyOf = (kind: UnknownKind, ...names: (string | null)[]) => `${kind}:${names.map((n) => norm(n)).join('>')}`;

function suggest(name: string, pool: { id: string; name: string; path: string }[]) {
  const n = norm(name);
  const tokens = new Set(n.split(/[^a-z0-9]+/).filter((t) => t.length > 3));
  return pool
    .map((p) => {
      const pn = norm(p.name);
      let score = 0;
      if (pn.includes(n) || n.includes(pn)) score += 3;
      for (const t of pn.split(/[^a-z0-9]+/)) if (tokens.has(t)) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.p);
}

interface ResolvedRow {
  row: ImportRow;
  subjectId: string | null; // assunto final (subassunto, se houver)
  skipReason: string | null;
}

/**
 * Resolve as linhas contra o catálogo. Com `resolutions`, aplica as decisões do
 * administrador (criando áreas/assuntos quando pedido — somente no commit).
 */
async function resolveRows(ctx: Ctx, rows: ImportRow[], resolutions: Record<string, Resolution> | null, create: boolean) {
  const cat = await loadCatalog(ctx);
  const slugs = create ? await existingSlugs(ctx) : { subjects: new Set<string>(), medical_areas: new Set<string>() };
  const unknown = new Map<string, UnknownItem>();
  const created = new Map<string, string>();
  const areaPath = (id: string) => {
    const a = cat.areas.find((x) => x.id === id);
    const p = a?.parent_id ? cat.areas.find((x) => x.id === a.parent_id) : null;
    return [p?.name, a?.name].filter(Boolean).join(' › ');
  };
  const subjectPath = (s: Catalog['subjects'][number]) => {
    const parent = s.parent_subject_id ? cat.subjects.find((x) => x.id === s.parent_subject_id) : null;
    return [areaPath(s.medical_area_id), parent?.name, s.name].filter(Boolean).join(' › ');
  };
  const areaDescendants = (areaId: string) => new Set([areaId, ...cat.areas.filter((a) => a.parent_id === areaId).map((a) => a.id)]);

  const note = (kind: UnknownKind, name: string, parentKey: string | null, parentName: string | null, key: string, pool: { id: string; name: string; path: string }[]) => {
    const u = unknown.get(key);
    if (u) u.rows++;
    else unknown.set(key, { key, kind, name, parentKey, parentName, rows: 1, suggestions: suggest(name, pool) });
  };

  const decide = async (key: string, kind: UnknownKind, name: string, parent: { areaId?: string; subjectId?: string }): Promise<string | null | 'pending'> => {
    if (created.has(key)) return created.get(key)!;
    const res = resolutions?.[key];
    if (!res) return 'pending';
    if (res.action === 'ignore') return null;
    if (res.action === 'map') {
      if (create && (kind === 'subject' || kind === 'subsubject')) {
        const { error } = await ctx.sb.from('subject_aliases').insert({ subject_id: res.id, alias: name });
        if (error && error.code !== '23505') throw error;
      }
      created.set(key, res.id);
      return res.id;
    }
    if (!create) return 'pending-create';
    let id: string;
    if (kind === 'area' || kind === 'specialty') {
      const r: any = await q(ctx.sb.from('medical_areas')
        .insert({ parent_id: parent.areaId ?? null, name, slug: uniqueSlug(slugs.medical_areas, name) }).select('id').single());
      id = r.id;
      cat.areas.push({ id, parent_id: parent.areaId ?? null, name });
    } else {
      const r: any = await q(ctx.sb.from('subjects')
        .insert({ medical_area_id: parent.areaId, parent_subject_id: parent.subjectId ?? null, name, slug: uniqueSlug(slugs.subjects, name) }).select('id').single());
      id = r.id;
      cat.subjects.push({ id, parent_subject_id: parent.subjectId ?? null, medical_area_id: parent.areaId!, name });
    }
    created.set(key, id);
    return id;
  };

  const out: ResolvedRow[] = [];
  for (const row of rows) {
    if (!row.subject) {
      out.push({ row, subjectId: null, skipReason: null });
      continue;
    }
    let pending = false;
    // 1) Grande área
    const areaKey = keyOf('area', row.area);
    let areaId: string | null | 'pending' | 'pending-create' =
      cat.areas.find((a) => !a.parent_id && norm(a.name) === norm(row.area))?.id ?? null;
    if (!areaId) {
      const d = await decide(areaKey, 'area', row.area!, {});
      if (d === 'pending') note('area', row.area!, null, null, areaKey, cat.areas.filter((a) => !a.parent_id).map((a) => ({ id: a.id, name: a.name, path: a.name })));
      areaId = d;
    }
    if (areaId === null) { out.push({ row, subjectId: null, skipReason: 'Área ignorada' }); continue; }
    if (areaId === 'pending' || areaId === 'pending-create') pending = true;

    // 2) Especialidade (opcional)
    let placeAreaId = areaId;
    const specKey = keyOf('specialty', row.area, row.specialty);
    if (row.specialty) {
      let specId: string | null | 'pending' | 'pending-create' = null;
      if (!pending) specId = cat.areas.find((a) => a.parent_id === areaId && norm(a.name) === norm(row.specialty))?.id ?? null;
      if (!specId) {
        const d = await decide(specKey, 'specialty', row.specialty, { areaId: pending ? undefined : (areaId as string) });
        if (d === 'pending') note('specialty', row.specialty, areaKey, row.area, specKey,
          pending ? [] : cat.areas.filter((a) => a.parent_id === areaId).map((a) => ({ id: a.id, name: a.name, path: areaPath(a.id) })));
        specId = d;
      }
      if (specId === 'pending' || specId === 'pending-create') pending = true;
      else if (specId) placeAreaId = specId;
    }

    // 3) Assunto (unidade do planner): alias → nome dentro da área
    const subjKey = keyOf('subject', row.area, row.specialty, row.subject);
    let subjectId: string | null | 'pending' | 'pending-create' = null;
    const alias = cat.aliases.find((a) => norm(a.alias) === norm(row.subject));
    if (alias) subjectId = alias.subject_id;
    else if (!pending) {
      const scope = areaDescendants(areaId as string);
      subjectId = cat.subjects.find((s) => !s.parent_subject_id && scope.has(s.medical_area_id) && norm(s.name) === norm(row.subject))?.id ?? null;
    }
    if (!subjectId) {
      const d = await decide(subjKey, 'subject', row.subject, { areaId: pending ? undefined : (placeAreaId as string) });
      if (d === 'pending') {
        const scope = pending ? null : areaDescendants(areaId as string);
        note('subject', row.subject, row.specialty ? specKey : areaKey, row.specialty ?? row.area, subjKey,
          cat.subjects.filter((s) => !s.parent_subject_id && (!scope || scope.has(s.medical_area_id))).map((s) => ({ id: s.id, name: s.name, path: subjectPath(s) })));
      }
      subjectId = d;
    }
    if (subjectId === null) { out.push({ row, subjectId: null, skipReason: 'Assunto ignorado (questão importada sem classificação)' }); continue; }
    if (subjectId === 'pending' || subjectId === 'pending-create') pending = true;

    // 4) Subassunto (opcional)
    let finalId = subjectId;
    if (row.subsubject) {
      const subKey = keyOf('subsubject', row.area, row.specialty, row.subject, row.subsubject);
      let subId: string | null | 'pending' | 'pending-create' = null;
      const subAlias = cat.aliases.find((a) => norm(a.alias) === norm(row.subsubject));
      if (subAlias) subId = subAlias.subject_id;
      else if (!pending) subId = cat.subjects.find((s) => s.parent_subject_id === subjectId && norm(s.name) === norm(row.subsubject))?.id ?? null;
      if (!subId) {
        const parentSubject = pending ? null : cat.subjects.find((s) => s.id === subjectId);
        const d = await decide(subKey, 'subsubject', row.subsubject, { areaId: parentSubject?.medical_area_id, subjectId: pending ? undefined : (subjectId as string) });
        if (d === 'pending') note('subsubject', row.subsubject, subjKey, row.subject, subKey,
          pending ? [] : cat.subjects.filter((s) => s.parent_subject_id === subjectId).map((s) => ({ id: s.id, name: s.name, path: subjectPath(s) })));
        subId = d;
      }
      if (subId === 'pending' || subId === 'pending-create') pending = true;
      else if (subId) finalId = subId; // ignorar subassunto → classifica no assunto
    }
    out.push({ row, subjectId: pending ? null : (finalId as string), skipReason: pending ? 'pending' : null });
  }
  return { resolved: out, unknown: [...unknown.values()] };
}

async function existingSlugs(ctx: Ctx) {
  const subjects = await q(ctx.sb.from('subjects').select('slug').range(0, 100000));
  const areas = await q(ctx.sb.from('medical_areas').select('slug').range(0, 100000));
  return { subjects: new Set((subjects as any[]).map((r) => r.slug)), medical_areas: new Set((areas as any[]).map((r) => r.slug)) };
}

function uniqueSlug(taken: Set<string>, name: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  taken.add(slug);
  return slug;
}

// ---------------------------------------------------------------------------
// Preview e commit
// ---------------------------------------------------------------------------

export async function previewImport(ctx: Ctx, examId: string, file: ParsedFile) {
  const exam: any = await q(ctx.sb.from('admin_exams').select('id, name, institution').eq('id', examId).maybeSingle());
  if (!exam) throw badRequest('Prova não encontrada.');
  const existing = await rpc<{ questions: [number, number][]; editions: { year: number; status: string }[] }>(ctx, 'admin_existing_questions', { p_exam: examId });
  const existingKeys = new Set(existing.questions.map(([y, n]) => `${y}#${n}`));
  const editions = existing.editions;
  const seen = new Set<string>();

  const valid: ImportRow[] = [];
  const invalid: ImportRow[] = [];
  const duplicates: (ImportRow & { duplicateOf: 'database' | 'file' })[] = [];
  for (const r of file.rows) {
    if (r.errors.length) { invalid.push(r); continue; }
    const k = `${r.year}#${r.question_number}`;
    if (existingKeys.has(k)) { duplicates.push({ ...r, duplicateOf: 'database' }); continue; }
    if (seen.has(k)) { duplicates.push({ ...r, duplicateOf: 'file' }); continue; }
    seen.add(k);
    valid.push(r);
  }
  const { unknown } = await resolveRows(ctx, valid, null, false);
  const years = [...new Set(valid.map((r) => r.year!))].sort();
  return {
    exam: { id: exam.id, name: exam.name, abbreviation: exam.institution },
    format: file.format,
    source: file.meta.source ?? null,
    examHint: file.meta.exam_hint ?? null,
    total: file.rows.length,
    valid: valid.length,
    invalid: invalid.map((r) => ({ line: r.line, year: r.year, question_number: r.question_number, errors: r.errors })),
    duplicates: duplicates.map((r) => ({ line: r.line, year: r.year, question_number: r.question_number, duplicateOf: r.duplicateOf })),
    unclassified: valid.filter((r) => !r.subject).length,
    annulled: valid.filter((r) => r.annulled).length,
    years: years.map((y) => ({
      year: y,
      questions: valid.filter((r) => r.year === y).length,
      edition: editions.find((e) => e.year === y)?.status ?? null,
    })),
    unknown,
    sample: valid.slice(0, 8).map(({ errors: _e, ...r }) => r),
  };
}

export async function commitImport(
  ctx: Ctx, examId: string, filename: string, file: ParsedFile, resolutions: Record<string, Resolution>, source: string | null,
) {
  await currentUserId(ctx);
  const preview = await previewImport(ctx, examId, file);
  const missing = preview.unknown.filter((u) => !resolutions[u.key]);
  if (missing.length) {
    throw badRequest('Existem itens não encontrados sem decisão. Associe, crie ou ignore cada um.', missing.map((m) => m.key));
  }
  const dupKeys = new Set(preview.duplicates.map((d) => `${d.year}#${d.question_number}#${d.line}`));
  const rows = file.rows.filter((r) => !r.errors.length && !dupKeys.has(`${r.year}#${r.question_number}#${r.line}`));
  const { resolved } = await resolveRows(ctx, rows, resolutions, true);
  const src = source ?? (file.meta.source as string | null) ?? null;
  return rpc(ctx, 'import_questions', {
    p_exam: examId,
    p_rows: resolved.map(({ row, subjectId }) => ({
      year: row.year, question_number: row.question_number, statement: row.statement, summary: row.summary,
      alternative_a: row.alternative_a, alternative_b: row.alternative_b, alternative_c: row.alternative_c,
      alternative_d: row.alternative_d, alternative_e: row.alternative_e, correct_answer: row.correct_answer,
      annulled: row.annulled, explanation: row.explanation, difficulty: row.difficulty, question_type: row.question_type,
      guideline: row.guideline, source: row.source, notes: row.notes, subject_id: subjectId,
    })),
    p_filename: filename,
    p_format: file.format,
    p_source: src,
    p_total_rows: file.rows.length,
  });
}
