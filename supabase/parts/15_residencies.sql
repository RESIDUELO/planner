-- =====================================================================
-- Residências: as residências em que a pessoa vai se inscrever, com as
-- datas de cada etapa (edital, inscrição, prova, resultado...), vagas e
-- nota de corte por especialidade, taxa e a situação dela. Cada conta
-- tem a sua lista, cadastrada à mão. Uma prova com várias instituições
-- (ex.: ENARE) é uma linha só, com as instituições em `institutions`.
-- Pode ser ligada a uma prova da aba Provas (exam_edition_id): a data da
-- prova passa a ser a mesma nos dois lugares.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.residencies (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 120),
  city                text not null default '' check (char_length(city) <= 120),
  edital_url          text not null default '' check (char_length(edital_url) <= 1000),
  -- [{ name, vacancies, cutoff }]
  specialties         jsonb not null default '[]'::jsonb,
  -- Prova com várias instituições: [{ name, city, specialties: [...] }]
  institutions        jsonb not null default '[]'::jsonb,
  fee                 numeric(10,2) check (fee is null or fee >= 0),
  reduction_requested boolean not null default false,
  -- null: aguardando resposta
  reduction_granted   boolean,
  paid                boolean not null default false,
  decision            text not null default 'maybe' check (decision in ('yes', 'maybe', 'no')),
  enrolled            boolean not null default false,
  notes               text not null default '' check (char_length(notes) <= 5000),
  -- Linha do tempo: [{ id, key, label, type, date, end, done }]
  steps               jsonb not null default '[]'::jsonb,
  exam_edition_id     uuid references public.exam_editions(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists residencies_user_idx on public.residencies (user_id);
alter table public.residencies enable row level security;

-- Permissões refeitas a cada execução (rodar de novo corrige uma instalação incompleta)
drop policy if exists owner_all on public.residencies;
create policy owner_all on public.residencies for all to authenticated
  using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));

revoke all on public.residencies from anon;
grant select, insert, update, delete on public.residencies to authenticated;

-- Conferência: deve mostrar 1 linha (owner_all)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'residencies';
