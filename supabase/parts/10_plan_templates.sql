-- =====================================================================
-- Cronogramas pessoais (modelos de planner com datas fixas).
-- Só administradores enxergam e usam. O conteúdo entra pelos arquivos
-- supabase/data/cronograma_*.sql, rodados no SQL Editor.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.plan_templates (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  description     text,
  exam_edition_id uuid references public.exam_editions(id),
  data            jsonb not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.plan_templates enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'plan_templates' and policyname = 'admin_read') then
    create policy admin_read on public.plan_templates for select to authenticated using ((select app.is_admin()) and active);
  end if;
end $$;

revoke all on public.plan_templates from anon, authenticated;
grant select on public.plan_templates to authenticated;
