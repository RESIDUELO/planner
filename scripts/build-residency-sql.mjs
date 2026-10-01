#!/usr/bin/env node
/**
 * Gera supabase/data/residencias_catalogo.sql a partir de data/residencies.json
 * (o catálogo de residências com as datas de cada etapa). Idempotente: cada
 * residência tem um id fixo e rodar de novo atualiza os dados e as datas.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { residencies } = JSON.parse(readFileSync(join(root, 'data/residencies.json'), 'utf8'));
const exams = JSON.parse(readFileSync(join(root, 'data/exams.json'), 'utf8')).exams;
const out = join(root, 'supabase/data/residencias_catalogo.sql');

// Mesma ordem e nomes de shared/residency.ts (DEFAULT_STEPS)
const STEPS = [
  ['edital', 'Edital publicado', 'inscricao'], ['reducao', 'Pedido de redução da taxa', 'inscricao'], ['inscricao', 'Inscrição', 'inscricao'],
  ['boleto', 'Pagamento do boleto', 'inscricao'], ['local', 'Local de prova divulgado', 'prova'], ['prova', 'Prova', 'prova'],
  ['gabarito', 'Gabarito', 'prova'], ['recurso', 'Prazo de recurso', 'prova'], ['resultado1', 'Resultado da 1ª fase', 'resultado'],
  ['fase2', '2ª fase (currículo/entrevista)', 'resultado'], ['final', 'Resultado final', 'resultado'],
];
const RANGE = ['reducao', 'inscricao'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function check(r, d, where) {
  if (d !== null && !DATE.test(d)) throw new Error(`${r.id}: data inválida em ${where}: ${d}`);
  return d;
}

function steps(r) {
  const dates = r.dates ?? {};
  for (const k of Object.keys(dates)) if (!STEPS.some(([key]) => key === k)) throw new Error(`${r.id}: etapa desconhecida "${k}"`);
  const list = STEPS.filter(([key]) => !(r.skip ?? []).includes(key)).map(([key, label, type]) => {
    const v = dates[key] ?? null;
    const [date, end] = RANGE.includes(key) ? (Array.isArray(v) ? v : [v, null]) : [v, null];
    if (date && end && date > end) throw new Error(`${r.id}: ${key} começa depois de terminar`);
    return { id: key, key, label, type, date: check(r, date ?? null, key), end: check(r, end ?? null, key), done: false };
  });
  for (const x of r.extra ?? []) {
    const at = list.map((s) => s.type).lastIndexOf(x.type);
    list.splice(at < 0 ? list.length : at + 1, 0, { id: `x-${slug(x.label)}`, key: 'custom', label: x.label, type: x.type, date: check(r, x.date ?? null, x.label), end: null, done: false });
  }
  return list;
}

if (!residencies.length) {
  rmSync(out, { force: true });
  console.log('data/residencies.json sem residências: nada a gerar');
  process.exit(0);
}

const rows = residencies.map((r) => {
  if (!r.id || !r.name) throw new Error('Cada residência precisa de id e name');
  let exam = 'null';
  if (r.exam) {
    const e = exams.find((x) => x.id === r.exam);
    if (!e) throw new Error(`${r.id}: prova "${r.exam}" não está em data/exams.json`);
    exam = `(select ed.id from exam_editions ed join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
      where i.abbreviation = ${lit(e.institution.abbreviation)} and e.name = ${lit(e.exam.name)} and ed.year = ${e.upcoming.year} limit 1)`;
  }
  return `insert into public.residency_catalog (id, name, city, edital_url, fee, specialties, institutions, steps, exam_edition_id, published, updated_at)
values (md5(${lit(`residency:${r.id}`)})::uuid, ${lit(r.name)}, ${lit(r.city ?? '')}, ${lit(r.edital ?? '')}, ${lit(r.fee ?? null)},
  ${json(r.specialties ?? [])}, ${json(r.institutions ?? [])}, ${json(steps(r))}, ${exam}, true, now())
on conflict (id) do update set name = excluded.name, city = excluded.city, edital_url = excluded.edital_url, fee = excluded.fee,
  specialties = excluded.specialties, institutions = excluded.institutions, steps = excluded.steps,
  exam_edition_id = excluded.exam_edition_id, published = true, updated_at = now();`;
});

writeFileSync(out, `-- Catálogo de residências (gerado de data/residencies.json por scripts/build-residency-sql.mjs).
-- Rode depois de supabase/parts/17_residency_catalog.sql. Pode rodar de novo: atualiza as datas.
${rows.join('\n\n')}

select name, jsonb_array_length(steps) as etapas from public.residency_catalog order by name;
`);
console.log(`residencias_catalogo.sql: ${rows.length} residências`);
