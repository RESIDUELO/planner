#!/usr/bin/env node
/**
 * Gera os arquivos SQL de dados (supabase/data/*.sql) a partir de
 * data/exams.json + data/import/*.json. O administrador cola cada arquivo no
 * SQL Editor do Supabase. Os arquivos são idempotentes: rodar de novo não
 * duplica nada (on conflict do nothing / update dos metadados).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'data/exams.json'), 'utf8'));
mkdirSync(join(root, 'supabase/data'), { recursive: true });

const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function slug(...parts) {
  const base = parts.filter(Boolean).map((p) => norm(p).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).join('--');
  if (base.length <= 100) return base;
  return base.slice(0, 88) + '-' + createHash('sha1').update(base).digest('hex').slice(0, 10);
}
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function buildExamSql(entry) {
  const doc = JSON.parse(readFileSync(join(root, 'data/import', entry.file), 'utf8'));
  const qs = doc.questions;
  const inst = entry.institution;
  const examRef = `(select e.id from public.exams e join public.institutions i on i.id = e.institution_id where i.abbreviation = ${lit(inst.abbreviation)} and e.name = ${lit(entry.exam.name)})`;
  const out = [];
  const classified = qs.filter((q) => q.subject).length;
  out.push(`-- =====================================================================
-- ${inst.abbreviation} — ${entry.exam.name}: ${qs.length} questões, ${classified} classificadas
-- Fonte: ${entry.source.name}
-- Gerado por scripts/build-data-sql.mjs (não edite à mão). Pode rodar mais de uma vez.
-- =====================================================================
`);
  out.push(`insert into public.institutions (name, abbreviation, state, city) values (${lit(inst.name)}, ${lit(inst.abbreviation)}, ${lit(inst.state)}, ${lit(inst.city)})
on conflict (abbreviation) do update set name = excluded.name, state = excluded.state, city = excluded.city;

insert into public.exams (institution_id, name, total_questions)
select id, ${lit(entry.exam.name)}, ${lit(entry.exam.total_questions)} from public.institutions where abbreviation = ${lit(inst.abbreviation)}
on conflict (institution_id, name) do update set total_questions = excluded.total_questions;
`);

  // Áreas, especialidades, assuntos e subassuntos (identificados por slug do caminho completo)
  const areas = new Map(), specs = new Map(), subjects = new Map(), subs = new Map();
  const register = (c) => {
    areas.set(slug(c.area), c.area);
    const areaSlug = c.specialty ? slug(c.area, c.specialty) : slug(c.area);
    if (c.specialty) specs.set(areaSlug, { name: c.specialty, parent: slug(c.area) });
    const sSlug = slug(c.area, c.specialty, c.subject);
    subjects.set(sSlug, { name: c.subject, area: areaSlug });
    return { areaSlug, sSlug };
  };
  for (const q of qs) {
    // Questão sem classificação no relatório: entra na contagem da prova, sem assunto
    if (!q.subject) continue;
    // Questão que o relatório conta em mais de um assunto
    q._extra = (q.extra_subjects ?? []).map((c) => register(c).sSlug);
    const { areaSlug, sSlug } = register(q);
    q._slug = sSlug;
    if (q.subsubject) {
      const ssSlug = slug(q.area, q.specialty, q.subject, q.subsubject);
      subs.set(ssSlug, { name: q.subsubject, area: areaSlug, parent: sSlug });
      q._slug = ssSlug;
    }
  }
  out.push(`-- Grandes áreas e especialidades
insert into public.medical_areas (name, slug) values
${[...areas].map(([s, n]) => `  (${lit(n)}, ${lit(s)})`).join(',\n')}
on conflict (slug) do nothing;
`);
  if (specs.size) out.push(`insert into public.medical_areas (parent_id, name, slug)
select p.id, v.name, v.slug from (values
${[...specs].map(([s, v]) => `  (${lit(v.name)}, ${lit(s)}, ${lit(v.parent)})`).join(',\n')}
) as v(name, slug, parent) join public.medical_areas p on p.slug = v.parent
on conflict (slug) do nothing;
`);
  out.push(`-- Assuntos (unidade do planner)
insert into public.subjects (medical_area_id, name, slug)
select a.id, v.name, v.slug from (values
${[...subjects].map(([s, v]) => `  (${lit(v.name)}, ${lit(s)}, ${lit(v.area)})`).join(',\n')}
) as v(name, slug, area) join public.medical_areas a on a.slug = v.area
on conflict (slug) do nothing;
`);
  if (subs.size) out.push(`-- Subassuntos
insert into public.subjects (medical_area_id, parent_subject_id, name, slug)
select a.id, p.id, v.name, v.slug from (values
${[...subs].map(([s, v]) => `  (${lit(v.name)}, ${lit(s)}, ${lit(v.area)}, ${lit(v.parent)})`).join(',\n')}
) as v(name, slug, area, parent) join public.medical_areas a on a.slug = v.area join public.subjects p on p.slug = v.parent
on conflict (slug) do nothing;
`);

  // Edições: históricas (com questões) e a próxima
  const years = [...new Set(qs.map((q) => q.year))].sort();
  const src = entry.source;
  out.push(`-- Edições históricas (publicadas: entram na análise)
insert into public.exam_editions (exam_id, year, total_questions, status, published_at, source_name, source_checked_at)
select ${examRef}, v.year, v.total, 'published', now(), ${lit(src.name)}, ${src.checked_at ? `date ${lit(src.checked_at)}` : 'null'}
from (values ${years.map((y) => `(${y}, ${qs.filter((q) => q.year === y).length})`).join(', ')}) as v(year, total)
on conflict (exam_id, year) do update set total_questions = excluded.total_questions, source_name = excluded.source_name,
  source_checked_at = excluded.source_checked_at;
`);
  const u = entry.upcoming;
  if (u) out.push(`-- Próxima prova (data oficial quando houver; inscrição e valor são do aluno)
insert into public.exam_editions (exam_id, year, status, published_at, notes, exam_date)
values (${examRef}, ${u.year}, 'published', now(), ${lit(u.notes)}, ${u.exam_date ? `date ${lit(u.exam_date)}` : 'null'})
on conflict (exam_id, year) do update set notes = excluded.notes, exam_date = excluded.exam_date;
`);

  // Questões
  const qsrc = doc.source ?? src.name;
  if (qs.some((q) => !q.annulled && !q.correct_answer)) out.push(`-- O relatório não traz o gabarito questão a questão: a resposta pode ficar em branco
alter table public.questions drop constraint if exists answer_or_annulled;
`);
  for (const part of chunk(qs, 250)) {
    out.push(`insert into public.questions (exam_edition_id, question_number, summary, correct_answer, annulled, difficulty, question_type, guideline, source, notes)
select ed.id, v.n, v.summary, v.answer, v.annulled, v.difficulty::public.difficulty, v.qtype, v.guideline, ${lit(qsrc)}, v.notes
from (values
${part.map((q) => `  (${q.year}, ${q.question_number}, ${lit(q.summary)}, ${lit(q.correct_answer)}, ${q.annulled}, ${lit(q.difficulty)}, ${lit(q.question_type)}, ${lit(q.guideline)}, ${lit(q.notes ?? null)})`).join(',\n')}
) as v(year, n, summary, answer, annulled, difficulty, qtype, guideline, notes)
join public.exam_editions ed on ed.exam_id = ${examRef} and ed.year = v.year
on conflict (exam_edition_id, question_number) do nothing;
`);
  }
  // Classificação
  const links = qs.filter((q) => q._slug).flatMap((q) => [[q, q._slug, true], ...q._extra.map((x) => [q, x, false])]);
  for (const part of chunk(links, 500)) {
    out.push(`insert into public.question_subjects (question_id, subject_id, relevance_weight, is_primary)
select q.id, s.id, 1, v.prim
from (values
${part.map(([q, sl, prim]) => `  (${q.year}, ${q.question_number}, ${lit(sl)}, ${prim})`).join(',\n')}
) as v(year, n, slug, prim)
join public.exam_editions ed on ed.exam_id = ${examRef} and ed.year = v.year
join public.questions q on q.exam_edition_id = ed.id and q.question_number = v.n
join public.subjects s on s.slug = v.slug
on conflict do nothing;
`);
  }
  out.push(`-- Conferência: deve mostrar ${qs.length} questões, ${classified} classificadas
select i.abbreviation, count(distinct q.id) as questoes, count(distinct qs.question_id) as classificadas
from public.questions q join public.exam_editions ed on ed.id = q.exam_edition_id
join public.exams e on e.id = ed.exam_id join public.institutions i on i.id = e.institution_id
left join public.question_subjects qs on qs.question_id = q.id
where i.abbreviation = ${lit(inst.abbreviation)} group by i.abbreviation;
`);
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const e of manifest.exams) {
    const sql = buildExamSql(e);
    writeFileSync(join(root, 'supabase/data', `${e.id}.sql`), sql);
    console.log(`supabase/data/${e.id}.sql  (${(sql.length / 1024).toFixed(0)} KB)`);
  }
}
