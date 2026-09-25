#!/usr/bin/env node
/**
 * Gera supabase/data/cronograma_<code>.sql a partir de data/templates/*.json.
 * Cria os assuntos do cronograma (prefixo "medcof--") e grava o modelo em
 * public.plan_templates. Idempotente.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './build-data-sql.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

for (const f of readdirSync(join(root, 'data/templates')).filter((x) => x.endsWith('.json'))) {
  const t = JSON.parse(readFileSync(join(root, 'data/templates', f), 'utf8'));
  const areas = [...new Set(t.items.map((i) => i.area))];
  const out = [];
  out.push(`-- =====================================================================
-- Cronograma pessoal: ${t.name}
-- Fonte: ${t.source}
-- Visível só para administradores. Gerado por scripts/build-template-sql.mjs.
-- Pode rodar mais de uma vez.
-- =====================================================================
insert into public.medical_areas (name, slug) values
${areas.map((a) => `  (${lit(a)}, ${lit(slug(a))})`).join(',\n')}
on conflict (slug) do nothing;

insert into public.subjects (medical_area_id, name, slug)
select a.id, v.name, v.slug from (values
${t.items.map((i) => `  (${lit(i.name)}, ${lit(i.slug)}, ${lit(slug(i.area))})`).join(',\n')}
) as v(name, slug, area) join public.medical_areas a on a.slug = v.area
on conflict (slug) do update set name = excluded.name;

insert into public.plan_templates (code, name, description, exam_edition_id, data)
select ${lit(t.code)}, ${lit(t.name)}, ${lit(t.description)}, ed.id, ${lit(JSON.stringify(t))}::jsonb
from public.exam_editions ed join public.exams e on e.id = ed.exam_id join public.institutions i on i.id = e.institution_id
where i.abbreviation = ${lit(t.exam.institution)} and e.name = ${lit(t.exam.name)} and ed.year = ${t.exam.year}
on conflict (code) do update set name = excluded.name, description = excluded.description,
  exam_edition_id = excluded.exam_edition_id, data = excluded.data, updated_at = now();

-- Conferência: 1 cronograma e ${t.items.length} assuntos
select (select count(*) from public.plan_templates where code = ${lit(t.code)}) as cronogramas,
       (select count(*) from public.subjects where slug like 'medcof--%') as assuntos;
`);
  const file = join(root, 'supabase/data', `cronograma_${t.code}.sql`);
  writeFileSync(file, out.join('\n'));
  console.log(`supabase/data/cronograma_${t.code}.sql  (${(out.join('').length / 1024).toFixed(0)} KB)`);
}
