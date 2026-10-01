-- =====================================================================
-- Catálogo de residências: as residências com as datas de cada etapa
-- (edital, inscrição, prova, resultado...), vagas, taxa e edital,
-- cadastradas pela administração. Na aba Residências a pessoa só marca
-- as que quer; a residência entra na lista dela já com as datas, e as
-- datas cadastradas aqui depois (ex.: resultado divulgado) aparecem
-- sozinhas para todo mundo que a escolheu.
-- Leitura pública (são dados de edital); escrita só de administradores.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.residency_catalog (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 120),
  city            text not null default '' check (char_length(city) <= 120),
  edital_url      text not null default '' check (char_length(edital_url) <= 1000),
  -- [{ name, vacancies, cutoff }]
  specialties     jsonb not null default '[]'::jsonb,
  -- Prova com várias instituições: [{ name, city, specialties: [...] }]
  institutions    jsonb not null default '[]'::jsonb,
  fee             numeric(10,2) check (fee is null or fee >= 0),
  -- Linha do tempo: [{ id, key, label, type, date, end, done }]
  steps           jsonb not null default '[]'::jsonb,
  exam_edition_id uuid references public.exam_editions(id) on delete set null,
  notes           text not null default '' check (char_length(notes) <= 5000),
  published       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.residency_catalog enable row level security;

drop policy if exists read_catalog on public.residency_catalog;
create policy read_catalog on public.residency_catalog for select to anon, authenticated
  using (published or (select app.is_admin()));
drop policy if exists admin_insert on public.residency_catalog;
create policy admin_insert on public.residency_catalog for insert to authenticated with check ((select app.is_admin()));
drop policy if exists admin_update on public.residency_catalog;
create policy admin_update on public.residency_catalog for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
drop policy if exists admin_delete on public.residency_catalog;
create policy admin_delete on public.residency_catalog for delete to authenticated using ((select app.is_admin()));

revoke all on public.residency_catalog from anon;
grant select on public.residency_catalog to anon;
grant select, insert, update, delete on public.residency_catalog to authenticated;

-- A residência da pessoa que veio do catálogo (uma vez cada)
alter table public.residencies add column if not exists catalog_id uuid references public.residency_catalog(id) on delete set null;
create unique index if not exists residencies_user_catalog_idx on public.residencies (user_id, catalog_id) where catalog_id is not null;

-- Datas que a pessoa não quer ver (ex.: pedido de isenção); vale para as residências que ela escolher
alter table public.user_profiles add column if not exists residency_hidden_steps text[] not null default '{}';
grant update (residency_hidden_steps) on public.user_profiles to authenticated;

-- Conferência: deve mostrar 4 linhas
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'residency_catalog';
