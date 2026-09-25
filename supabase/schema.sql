-- =====================================================================
-- Residência Planner — schema completo para o Supabase
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rode UMA vez num projeto novo. Gerado por supabase/build-schema.mjs a
-- partir de supabase/parts/ (não edite este arquivo à mão).
-- =====================================================================

-- >>> 01_tables.sql
-- =====================================================================
-- Residência Planner — esquema principal
--
-- Separação:
--   * schema auth   → Supabase Auth (login, visitante anônimo, sessões)
--   * schema app    → funções auxiliares (papéis, auditoria, gatilhos)
--   * schema public → dados globais (curados pelo ADMIN) e dados individuais
--
-- Dados globais só podem ser alterados por administradores. Isso é garantido
-- pelo próprio PostgreSQL via Row Level Security (ver 02_security.sql), não
-- apenas pelo frontend.
-- =====================================================================

create schema if not exists app;

create type public.user_role as enum ('admin', 'user', 'visitor');

create table public.user_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  name       text not null,
  role       public.user_role not null default 'user',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;

-- ---------------------------------------------------------------------
-- DADOS GLOBAIS (curados pelo administrador)
-- ---------------------------------------------------------------------
create table public.institutions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  abbreviation text not null,
  state        char(2),
  city         text,
  website      text,
  logo_url     text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (abbreviation)
);
alter table public.institutions enable row level security;

create table public.examining_boards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  abbreviation text not null unique,
  website      text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.examining_boards enable row level security;

create table public.exams (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid not null references public.institutions(id),
  board_id         uuid references public.examining_boards(id),
  name             text not null,
  description      text,
  total_questions  int check (total_questions is null or total_questions > 0),
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  official_url     text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (institution_id, name)
);
alter table public.exams enable row level security;

create type public.edition_status as enum ('draft', 'published', 'archived');

create table public.exam_editions (
  id                  uuid primary key default gen_random_uuid(),
  exam_id             uuid not null references public.exams(id),
  year                int not null check (year between 1990 and 2100),
  exam_date           date,
  registration_start  date,
  registration_end    date,
  registration_fee    numeric(10,2) check (registration_fee is null or registration_fee >= 0),
  number_of_vacancies int check (number_of_vacancies is null or number_of_vacancies >= 0),
  total_questions     int check (total_questions is null or total_questions > 0),
  edital_url          text,
  answer_key_url      text,
  result_url          text,
  status              public.edition_status not null default 'draft',
  source_name         text,
  source_url          text,
  source_checked_at   date,
  registered_by       uuid references auth.users(id),
  notes               text,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (exam_id, year),
  constraint registration_period_chk check (registration_start is null or registration_end is null or registration_start <= registration_end)
);
alter table public.exam_editions enable row level security;
-- procedência dos dados (seção 45)
create index exam_editions_exam_idx on public.exam_editions(exam_id);

-- Hierarquia de áreas: Clínica Médica → Cardiologia
create table public.medical_areas (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.medical_areas(id),
  name       text not null,
  slug       text not null unique,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.medical_areas enable row level security;

-- Assuntos: Arritmias (unidade do planner) → Fibrilação atrial (subassunto)
create table public.subjects (
  id                uuid primary key default gen_random_uuid(),
  medical_area_id   uuid not null references public.medical_areas(id),
  parent_subject_id uuid references public.subjects(id),
  name              text not null,
  description       text,
  slug              text not null unique,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint subject_not_own_parent check (parent_subject_id is null or parent_subject_id <> id)
);
alter table public.subjects enable row level security;
create index subjects_parent_idx on public.subjects(parent_subject_id);
create index subjects_area_idx on public.subjects(medical_area_id);

-- Nomes alternativos usados em importações ("Arritmia supraventricular" → Arritmias).
-- Só são criados quando o administrador confirma a associação.
create table public.subject_aliases (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  alias      text not null,
  created_at timestamptz not null default now()
);
alter table public.subject_aliases enable row level security;

create unique index subject_aliases_alias_key on public.subject_aliases (lower(alias));

create type public.difficulty as enum ('easy', 'medium', 'hard');

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  exam_edition_id uuid not null references public.exam_editions(id),
  question_number int not null check (question_number > 0),
  statement       text,
  summary         text,
  alternative_a   text,
  alternative_b   text,
  alternative_c   text,
  alternative_d   text,
  alternative_e   text,
  correct_answer  char(1) check (correct_answer in ('A','B','C','D','E')),
  annulled        boolean not null default false,
  explanation     text,
  difficulty      public.difficulty,
  question_type   text,
  guideline       text,
  source          text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (exam_edition_id, question_number),
  constraint answer_or_annulled check (annulled or correct_answer is not null)
);
alter table public.questions enable row level security;
-- questions: o que a questão cobra (quando o enunciado não está disponível)

create table public.question_subjects (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions(id),
  subject_id       uuid not null references public.subjects(id),
  relevance_weight numeric(4,3) not null default 1 check (relevance_weight > 0 and relevance_weight <= 1),
  is_primary       boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (question_id, subject_id)
);
alter table public.question_subjects enable row level security;
create index question_subjects_subject_idx on public.question_subjects(subject_id);
create unique index question_subjects_one_primary on public.question_subjects(question_id) where is_primary;

create table public.study_methods (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  activity_type     text not null,
  default_minutes   int not null check (default_minutes > 0),
  sort_order        int not null default 0,
  active            boolean not null default true
);
alter table public.study_methods enable row level security;

create table public.algorithm_versions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  version     text not null unique,
  description text,
  parameters  jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.algorithm_versions enable row level security;

create table public.admin_audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  actor_name   text,
  entity       text not null,
  entity_id    text,
  entity_label text,
  action       text not null,
  old_values   jsonb,
  new_values   jsonb,
  changed_at   timestamptz not null default now()
);
alter table public.admin_audit_logs enable row level security;
create index admin_audit_logs_entity_idx on public.admin_audit_logs(entity, entity_id);
create index admin_audit_logs_changed_idx on public.admin_audit_logs(changed_at desc);

create table public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references public.exams(id),
  filename        text not null,
  file_format     text not null,
  source          text,
  total_rows      int not null,
  inserted_rows   int not null,
  skipped_rows    int not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
alter table public.import_batches enable row level security;

-- ---------------------------------------------------------------------
-- DADOS INDIVIDUAIS (cada usuário só enxerga os próprios)
-- ---------------------------------------------------------------------
create table public.user_exams (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  exam_id   uuid not null references public.exams(id),
  priority  int not null default 1,
  selected  boolean not null default true,
  unique (user_id, exam_id)
);
alter table public.user_exams enable row level security;

create table public.user_exam_editions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  exam_edition_id uuid not null references public.exam_editions(id),
  is_primary      boolean not null default false,
  selected        boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (user_id, exam_edition_id)
);
alter table public.user_exam_editions enable row level security;
create unique index user_exam_editions_one_primary on public.user_exam_editions(user_id) where is_primary and selected;

create type public.registration_status as enum
  ('not_interested', 'want_to', 'pending', 'registered', 'closed', 'taken');

create table public.registrations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  exam_edition_id     uuid not null references public.exam_editions(id),
  status              public.registration_status not null,
  registration_number text,
  registration_date   date,
  notes               text,
  updated_at          timestamptz not null default now(),
  unique (user_id, exam_edition_id)
);
alter table public.registrations enable row level security;

create table public.study_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,
  start_date           date not null default current_date,
  daily_hours          numeric(4,2) not null default 4 check (daily_hours > 0 and daily_hours <= 16),
  study_days_per_week  int not null default 6 check (study_days_per_week between 1 and 7),
  questions_per_day    int not null default 20 check (questions_per_day between 0 and 500),
  study_saturday       boolean not null default true,
  study_sunday         boolean not null default false,
  preferred_start_time time,
  preferred_end_time   time,
  updated_at           timestamptz not null default now()
);
alter table public.study_profiles enable row level security;

create table public.user_study_methods (
  user_id           uuid not null references auth.users(id) on delete cascade,
  study_method_id   uuid not null references public.study_methods(id),
  enabled           boolean not null default true,
  estimated_minutes int not null check (estimated_minutes between 5 and 600),
  primary key (user_id, study_method_id)
);
alter table public.user_study_methods enable row level security;

create type public.plan_status as enum ('active', 'archived');

create table public.study_plans (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  name                    text not null,
  start_date              date not null,
  end_date                date not null,
  primary_exam_edition_id uuid references public.exam_editions(id),
  mode                    text not null default 'single' check (mode in ('single','multi')),
  status                  public.plan_status not null default 'active',
  algorithm_version       text not null,
  scheduler_version       text not null,
  settings_snapshot       jsonb not null default '{}'::jsonb,
  summary                 jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint plan_dates_chk check (start_date <= end_date)
);
alter table public.study_plans enable row level security;
create unique index study_plans_one_active on public.study_plans(user_id) where status = 'active';

create table public.study_plan_exams (
  study_plan_id   uuid not null references public.study_plans(id) on delete cascade,
  exam_edition_id uuid not null references public.exam_editions(id),
  user_id         uuid not null references auth.users(id) on delete cascade,
  is_primary      boolean not null default false,
  weight          numeric(8,4) not null,
  exam_date       date,
  editions_analyzed int not null default 0,
  primary key (study_plan_id, exam_edition_id)
);
alter table public.study_plan_exams enable row level security;

create table public.study_plan_subjects (
  study_plan_id         uuid not null references public.study_plans(id) on delete cascade,
  subject_id            uuid not null references public.subjects(id),
  user_id               uuid not null references auth.users(id) on delete cascade,
  historical_frequency  numeric(10,3) not null,
  historical_percentage numeric(8,5) not null,
  annual_average        numeric(10,3) not null,
  years_present         int not null,
  years_analyzed        int not null,
  recent_frequency      numeric(8,5) not null,
  priority_score        numeric(8,5) not null,
  priority_rank         int not null,
  priority_level        text not null,
  estimated_questions   numeric(10,3) not null,
  size_factor           numeric(6,3) not null default 1,
  exam_date             date,
  scheduled             boolean not null default true,
  per_exam              jsonb not null default '[]'::jsonb,
  primary key (study_plan_id, subject_id)
);
alter table public.study_plan_subjects enable row level security;
-- study_plan_subjects: nº absoluto de questões (ponderado)
-- study_plan_subjects: fração da prova (0–1)
-- study_plan_subjects: questões por edição
-- study_plan_subjects: fração nas edições recentes
-- study_plan_subjects: questões esperadas na próxima prova
-- study_plan_subjects: prova mais próxima em que o assunto cai (limita revisões)

create table public.study_schedule (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  study_plan_id     uuid not null references public.study_plans(id) on delete cascade,
  subject_id        uuid not null references public.subjects(id),
  study_method_id   uuid references public.study_methods(id),
  scheduled_date    date not null,
  activity_type     text not null check (activity_type in
                      ('new_subject','review','questions','flashcards','video','summary','reading','active_recall')),
  estimated_minutes int not null check (estimated_minutes > 0),
  priority          int not null,
  completed         boolean not null default false,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);
alter table public.study_schedule enable row level security;
create index study_schedule_user_date_idx on public.study_schedule(user_id, scheduled_date);
create unique index study_schedule_one_per_method on public.study_schedule(study_plan_id, subject_id, study_method_id)
  where activity_type <> 'review';

-- Checklist por assunto × método (independe do planner: sobrevive a replanejamentos)
create table public.subject_method_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id),
  study_method_id uuid not null references public.study_methods(id),
  completed_at    timestamptz not null default now(),
  primary key (user_id, subject_id, study_method_id)
);
alter table public.subject_method_progress enable row level security;

create table public.user_question_attempts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  question_id           uuid not null references public.questions(id),
  subject_id            uuid references public.subjects(id),
  answer                char(1) check (answer in ('A','B','C','D','E')),
  is_correct            boolean not null,
  response_time_seconds int check (response_time_seconds is null or response_time_seconds >= 0),
  confidence            int check (confidence between 1 and 5),
  attempted_at          timestamptz not null default now()
);
alter table public.user_question_attempts enable row level security;
create index user_question_attempts_user_subject_idx on public.user_question_attempts(user_id, subject_id);

-- Registro agregado ("fiz 20 questões, acertei 17") — histórico preservado
create table public.question_practice_logs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  subject_id            uuid not null references public.subjects(id),
  questions_count       int not null check (questions_count > 0 and questions_count <= 1000),
  correct_count         int not null check (correct_count >= 0),
  time_spent_minutes    int check (time_spent_minutes is null or time_spent_minutes >= 0),
  source                text,
  practiced_at          timestamptz not null default now(),
  constraint correct_le_total check (correct_count <= questions_count)
);
alter table public.question_practice_logs enable row level security;
create index question_practice_logs_user_subject_idx on public.question_practice_logs(user_id, subject_id);

create table public.user_subject_performance (
  user_id               uuid not null references auth.users(id) on delete cascade,
  subject_id            uuid not null references public.subjects(id),
  questions_answered    int not null default 0,
  questions_correct     int not null default 0,
  questions_wrong       int not null default 0,
  accuracy              numeric(6,5),
  average_response_time numeric(10,2),
  confidence_score      numeric(6,5),
  last_question_at      timestamptz,
  primary key (user_id, subject_id)
);
alter table public.user_subject_performance enable row level security;

create type public.review_rating as enum ('again', 'hard', 'good', 'easy');

create table public.spaced_repetition_cards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  subject_id        uuid not null references public.subjects(id),
  study_plan_id     uuid references public.study_plans(id) on delete set null,
  stability         numeric(12,4) not null,
  difficulty        numeric(6,4) not null,
  retrievability    numeric(6,5),
  interval_days     numeric(10,3) not null,
  repetitions       int not null default 0,
  lapses            int not null default 0,
  last_review_at    timestamptz not null,
  next_review_at    date,
  last_rating       public.review_rating,
  algorithm_version text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, subject_id)
);
alter table public.spaced_repetition_cards enable row level security;
create index spaced_repetition_cards_due_idx on public.spaced_repetition_cards(user_id, next_review_at);

create table public.review_logs (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  spaced_repetition_card_id uuid not null references public.spaced_repetition_cards(id) on delete cascade,
  subject_id                uuid not null references public.subjects(id),
  reviewed_at               timestamptz not null default now(),
  rating                    public.review_rating not null,
  previous_stability        numeric(12,4),
  new_stability             numeric(12,4) not null,
  previous_difficulty       numeric(6,4),
  new_difficulty            numeric(6,4) not null,
  previous_interval         numeric(10,3),
  new_interval              numeric(10,3) not null,
  scheduled_next_review     date,
  actual_next_review        date,
  retrievability_at_review  numeric(6,5),
  days_until_exam           int,
  time_spent_seconds        int check (time_spent_seconds is null or time_spent_seconds >= 0),
  algorithm_version         text not null
);
alter table public.review_logs enable row level security;
-- review_logs: preenchido quando a revisão seguinte acontece
create index review_logs_user_idx on public.review_logs(user_id, reviewed_at desc);


-- >>> 02_security.sql
-- =====================================================================
-- Segurança no Supabase: perfis, papéis, RLS, auditoria.
--
-- O navegador fala direto com o banco (PostgREST) usando o token do Supabase
-- Auth. Por isso TODA regra de acesso vive aqui, no PostgreSQL:
--   * tabelas globais: leitura filtrada (usuários só veem o que está
--     publicado), escrita apenas por administradores, sem DELETE;
--   * dados individuais: cada usuário só enxerga e altera os próprios;
--   * ninguém promove o próprio perfil a administrador;
--   * toda alteração administrativa é auditada por gatilho.
-- Visitantes usam o login anônimo do Supabase (papel 'visitor').
-- =====================================================================

grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------------
-- Contexto
-- ---------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.user_id from public.user_profiles p where p.user_id = auth.uid() and p.active
$$;

create or replace function app.current_role_name() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from public.user_profiles p where p.user_id = auth.uid() and p.active
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_role_name() = 'admin', false)
$$;

/** Execução direta (SQL Editor / service role), fora de uma requisição de usuário. */
create or replace function app.is_privileged_session() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}')
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
$$;

grant execute on function app.current_user_id(), app.current_role_name(), app.is_admin(), app.is_privileged_session()
  to authenticated, anon;

-- ---------------------------------------------------------------------
-- Perfis criados/atualizados a partir do Supabase Auth
-- ---------------------------------------------------------------------
create or replace function app.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.user_profiles(user_id, name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), case when coalesce(new.is_anonymous, false) then 'Visitante' else split_part(coalesce(new.email, ''), '@', 1) end),
    case when coalesce(new.is_anonymous, false) then 'visitor'::public.user_role else 'user'::public.user_role end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- Visitante que cria conta (anônimo → permanente) vira usuário, mantendo todo o progresso.
create or replace function app.on_auth_user_updated() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    perform set_config('app.bypass_profile_guard', 'on', true);
    update public.user_profiles
       set role = 'user',
           name = coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), name)
     where user_id = new.id and role = 'visitor';
    perform set_config('app.bypass_profile_guard', 'off', true);
  end if;
  return new;
end $$;

drop trigger if exists rp_on_auth_user_created on auth.users;
create trigger rp_on_auth_user_created after insert on auth.users
  for each row execute function app.on_auth_user_created();
drop trigger if exists rp_on_auth_user_updated on auth.users;
create trigger rp_on_auth_user_updated after update on auth.users
  for each row execute function app.on_auth_user_updated();

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['user_profiles','institutions','examining_boards','exams','exam_editions',
    'medical_areas','subjects','questions','study_plans','spaced_repetition_cards','study_profiles','registrations']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Proteção do perfil: ninguém muda o próprio papel/status
-- ---------------------------------------------------------------------
create or replace function app.guard_user_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' or app.is_privileged_session() then
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id é imutável' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not app.is_admin() then
      raise exception 'somente administradores alteram papel ou status' using errcode = '42501';
    end if;
    if new.user_id = auth.uid() then
      raise exception 'administrador não pode alterar o próprio papel ou status' using errcode = '42501';
    end if;
    if old.role = 'visitor' and new.role is distinct from old.role then
      raise exception 'visitantes precisam criar conta antes de mudar de papel' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger user_profiles_guard before update on public.user_profiles
  for each row execute function app.guard_user_profile();

-- ---------------------------------------------------------------------
-- Auditoria das tabelas administrativas (append-only)
-- ---------------------------------------------------------------------
create or replace function app.audit_label(p_table text, r jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_table
    when 'institutions' then r->>'abbreviation'
    when 'examining_boards' then r->>'abbreviation'
    when 'exams' then (select i.abbreviation || ' — ' || (r->>'name') from institutions i where i.id = (r->>'institution_id')::uuid)
    when 'exam_editions' then (select i.abbreviation || ' ' || (r->>'year') || ' — ' || e.name
                                 from exams e join institutions i on i.id = e.institution_id where e.id = (r->>'exam_id')::uuid)
    when 'questions' then (select i.abbreviation || ' ' || ed.year || ' Q' || (r->>'question_number')
                             from exam_editions ed join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
                            where ed.id = (r->>'exam_edition_id')::uuid)
    when 'question_subjects' then (select 'Q' || q.question_number || ' → ' || s.name from questions q, subjects s
                                    where q.id = (r->>'question_id')::uuid and s.id = (r->>'subject_id')::uuid)
    when 'user_profiles' then r->>'name'
    else coalesce(r->>'name', r->>'alias', r->>'code', r->>'version')
  end;
end $$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; k text;
  v_actor uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    v_old := '{}'::jsonb; v_new := '{}'::jsonb;
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at') and (to_jsonb(old)->k) is distinct from (to_jsonb(new)->k) then
        v_old := v_old || jsonb_build_object(k, to_jsonb(old)->k);
        v_new := v_new || jsonb_build_object(k, to_jsonb(new)->k);
      end if;
    end loop;
    if v_new = '{}'::jsonb then return new; end if;
    v_row := to_jsonb(new);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new); v_row := v_new;
  else
    v_old := to_jsonb(old); v_row := v_old;
  end if;
  insert into admin_audit_logs(actor_id, actor_name, entity, entity_id, entity_label, action, old_values, new_values)
  values (v_actor, coalesce((select name from user_profiles where user_id = v_actor), 'sistema'),
          tg_table_name, v_row->>'id', app.audit_label(tg_table_name, v_row), lower(tg_op), v_old, v_new);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['institutions','examining_boards','exams','exam_editions','medical_areas','subjects',
    'subject_aliases','questions','question_subjects','study_methods','algorithm_versions','user_profiles']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Desempenho por assunto (mantido pelo banco; usuário não escreve direto)
-- ---------------------------------------------------------------------
create or replace function app.refresh_subject_performance(p_user uuid, p_subject uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total int; v_correct int; v_time numeric; v_conf numeric; v_last timestamptz;
begin
  select coalesce(sum(n), 0), coalesce(sum(c), 0), max(t) into v_total, v_correct, v_last from (
    select questions_count n, correct_count c, practiced_at t from question_practice_logs
     where user_id = p_user and subject_id = p_subject
    union all
    select 1, case when is_correct then 1 else 0 end, attempted_at from user_question_attempts
     where user_id = p_user and subject_id = p_subject
  ) x;
  select avg(response_time_seconds), avg(confidence) / 5.0 into v_time, v_conf
    from user_question_attempts where user_id = p_user and subject_id = p_subject;

  if v_total = 0 then
    delete from user_subject_performance where user_id = p_user and subject_id = p_subject;
    return;
  end if;
  insert into user_subject_performance as p (user_id, subject_id, questions_answered, questions_correct, questions_wrong,
                                             accuracy, average_response_time, confidence_score, last_question_at)
  values (p_user, p_subject, v_total, v_correct, v_total - v_correct, v_correct::numeric / v_total, v_time, v_conf, v_last)
  on conflict (user_id, subject_id) do update set
    questions_answered = excluded.questions_answered, questions_correct = excluded.questions_correct,
    questions_wrong = excluded.questions_wrong, accuracy = excluded.accuracy,
    average_response_time = excluded.average_response_time, confidence_score = excluded.confidence_score,
    last_question_at = excluded.last_question_at;
end $$;

create or replace function app.on_practice_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.subject_id is not null then
    perform app.refresh_subject_performance(old.user_id, old.subject_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.subject_id is not null then
    perform app.refresh_subject_performance(new.user_id, new.subject_id);
  end if;
  return coalesce(new, old);
end $$;

create trigger question_practice_logs_perf after insert or update or delete on public.question_practice_logs
  for each row execute function app.on_practice_change();
create trigger user_question_attempts_perf after insert or update or delete on public.user_question_attempts
  for each row execute function app.on_practice_change();

-- ---------------------------------------------------------------------
-- Grants (o Supabase concede tudo por padrão; aqui restringimos)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Globais: leitura para todos (filtrada por RLS), escrita só admin (RLS). Sem DELETE.
grant select, insert, update on public.institutions, public.examining_boards, public.exams, public.exam_editions,
  public.medical_areas, public.subjects, public.questions, public.study_methods, public.algorithm_versions,
  public.import_batches to authenticated;
grant select, insert, update, delete on public.question_subjects, public.subject_aliases to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant select, update (name) on public.user_profiles to authenticated;
grant update (role, active) on public.user_profiles to authenticated;

-- Individuais
grant select, insert, update, delete on public.user_exams, public.user_exam_editions, public.registrations,
  public.study_profiles, public.user_study_methods, public.study_plans, public.study_plan_exams,
  public.study_plan_subjects, public.study_schedule, public.spaced_repetition_cards, public.subject_method_progress
  to authenticated;
grant select, insert on public.review_logs, public.question_practice_logs, public.user_question_attempts to authenticated;
grant update (actual_next_review) on public.review_logs to authenticated;
grant delete on public.question_practice_logs to authenticated;
grant select on public.user_subject_performance to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['user_profiles','institutions','examining_boards','exams','exam_editions','medical_areas',
    'subjects','subject_aliases','questions','question_subjects','study_methods','algorithm_versions','admin_audit_logs',
    'import_batches','user_exams','user_exam_editions','registrations','study_profiles','user_study_methods','study_plans',
    'study_plan_exams','study_plan_subjects','study_schedule','user_question_attempts','question_practice_logs',
    'user_subject_performance','spaced_repetition_cards','review_logs','subject_method_progress']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['institutions','examining_boards','exams','exam_editions','medical_areas','subjects',
    'subject_aliases','questions','question_subjects','study_methods','algorithm_versions','import_batches']
  loop
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select app.is_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select app.is_admin()))', t);
  end loop;
end $$;

create policy read_editions on public.exam_editions for select to authenticated
  using ((select app.is_admin()) or status = 'published');

create policy read_exams on public.exams for select to authenticated
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exam_editions ed where ed.exam_id = exams.id and ed.status = 'published')));

create policy read_institutions on public.institutions for select to authenticated
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exams e join public.exam_editions ed on ed.exam_id = e.id
     where e.institution_id = institutions.id and e.active and ed.status = 'published')));

create policy read_boards on public.examining_boards for select to authenticated
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exams e join public.exam_editions ed on ed.exam_id = e.id
     where e.board_id = examining_boards.id and e.active and ed.status = 'published')));

create policy read_questions on public.questions for select to authenticated
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exam_editions ed where ed.id = questions.exam_edition_id and ed.status = 'published')));

create policy read_question_subjects on public.question_subjects for select to authenticated
  using ((select app.is_admin()) or exists (
    select 1 from public.questions q join public.exam_editions ed on ed.id = q.exam_edition_id
     where q.id = question_subjects.question_id and q.active and ed.status = 'published'));

create policy read_areas on public.medical_areas for select to authenticated using ((select app.is_admin()) or active);
create policy read_subjects on public.subjects for select to authenticated using ((select app.is_admin()) or active);
create policy read_aliases on public.subject_aliases for select to authenticated using ((select app.is_admin()));
create policy read_methods on public.study_methods for select to authenticated using (true);
create policy read_algorithms on public.algorithm_versions for select to authenticated using (true);
create policy read_import_batches on public.import_batches for select to authenticated using ((select app.is_admin()));
create policy read_audit on public.admin_audit_logs for select to authenticated using ((select app.is_admin()));

create policy read_profiles on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy update_profiles on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()))
  with check (user_id = (select auth.uid()) or (select app.is_admin()));

do $$ declare t text; begin
  foreach t in array array['user_exams','user_exam_editions','registrations','study_profiles','user_study_methods',
    'study_plans','study_plan_exams','study_plan_subjects','study_schedule','user_question_attempts',
    'question_practice_logs','user_subject_performance','spaced_repetition_cards','review_logs','subject_method_progress']
  loop
    execute format('create policy owner_all on public.%I for all to authenticated using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()))', t);
  end loop;
end $$;


-- >>> 03_api.sql
-- =====================================================================
-- API do banco (chamada pelo navegador via Supabase).
--
-- Views usam security_invoker: as policies de RLS de quem consulta valem.
-- Funções são SECURITY INVOKER (RLS vale) salvo quando indicado; as de
-- administração verificam app.is_admin() e o RLS barra de novo na escrita.
-- Respostas grandes voltam como um único jsonb para não esbarrar no limite
-- de linhas da API do Supabase.
-- =====================================================================

-- Dados individuais: user_id preenchido automaticamente com o usuário logado
do $$ declare t text; begin
  foreach t in array array['user_exams','user_exam_editions','registrations','study_profiles','user_study_methods',
    'study_plans','study_plan_exams','study_plan_subjects','study_schedule','user_question_attempts',
    'question_practice_logs','spaced_repetition_cards','review_logs','subject_method_progress']
  loop
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
  end loop;
end $$;

-- Mapeia cada assunto para a unidade do planner (assunto raiz)
create or replace view public.subject_roots with (security_invoker = true) as
  with recursive tree as (
    select id, id as root from public.subjects where parent_subject_id is null
    union all
    select s.id, t.root from public.subjects s join tree t on s.parent_subject_id = t.id
  ) select id, root from tree;

-- ---------------------------------------------------------------------
-- Leitura (aluno)
-- ---------------------------------------------------------------------
create or replace view public.exam_catalog with (security_invoker = true) as
select ed.id as edition_id, ed.year, ed.exam_date, ed.registration_start, ed.registration_end, ed.registration_fee,
       ed.number_of_vacancies, coalesce(ed.total_questions, e.total_questions) as total_questions, ed.edital_url,
       ed.answer_key_url, ed.result_url, ed.source_name, ed.source_url, ed.source_checked_at, ed.status,
       e.id as exam_id, e.name as exam_name, e.description as exam_description, e.duration_minutes, e.official_url,
       e.total_questions as exam_total_questions,
       i.id as institution_id, i.name as institution_name, i.abbreviation as institution, i.state, i.city, i.logo_url,
       b.name as board_name, b.abbreviation as board
  from public.exam_editions ed
  join public.exams e on e.id = ed.exam_id and e.active
  join public.institutions i on i.id = e.institution_id
  left join public.examining_boards b on b.id = e.board_id;

create or replace function public.exam_history_data(p_exam_ids uuid[], p_include_drafts boolean default false)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', ed.id, 'exam_id', ed.exam_id, 'year', ed.year, 'status', ed.status,
               'question_count', (select count(*) from questions q where q.exam_edition_id = ed.id and q.active),
               'classified_count', (select count(*) from questions q where q.exam_edition_id = ed.id and q.active
                                     and exists (select 1 from question_subjects qs where qs.question_id = q.id)))
             order by ed.year)
        from exam_editions ed
       where ed.exam_id = any(p_exam_ids)
         and (case when p_include_drafts then ed.status <> 'archived' else ed.status = 'published' end)), '[]'::jsonb),
    -- links: [questão, edição, prova, assunto raiz, peso, assunto classificado]
    'links', coalesce((
      select jsonb_agg(jsonb_build_array(q.id, q.exam_edition_id, ed.exam_id, r.root, qs.relevance_weight, qs.subject_id))
        from questions q
        join exam_editions ed on ed.id = q.exam_edition_id
        join question_subjects qs on qs.question_id = q.id
        join subject_roots r on r.id = qs.subject_id
        join subjects s on s.id = r.root and s.active
       where ed.exam_id = any(p_exam_ids) and q.active
         and (case when p_include_drafts then ed.status <> 'archived' else ed.status = 'published' end)), '[]'::jsonb)
  )
$$;

create or replace function public.subjects_info(p_ids uuid[])
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'area', coalesce(pa.name, a.name), 'area_id', coalesce(pa.id, a.id),
           'specialty', case when a.parent_id is not null then a.name end)), '[]'::jsonb)
    from subjects s
    join medical_areas a on a.id = s.medical_area_id
    left join medical_areas pa on pa.id = a.parent_id
   where s.id = any(p_ids)
$$;

create or replace function public.subject_children(p_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from subjects where parent_subject_id = p_id and active
$$;

-- ---------------------------------------------------------------------
-- Escrita (aluno)
-- ---------------------------------------------------------------------
create or replace function public.set_edition_selection(p_edition uuid, p_selected boolean, p_primary boolean)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id(); v_exam uuid;
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  select exam_id into v_exam from exam_editions where id = p_edition and status = 'published';
  if v_exam is null then raise exception 'Prova não encontrada.' using errcode = 'P0002'; end if;
  if p_primary then
    update user_exam_editions set is_primary = false where user_id = v_uid and is_primary;
  end if;
  insert into user_exam_editions(user_id, exam_edition_id, selected, is_primary)
  values (v_uid, p_edition, coalesce(p_selected, true), coalesce(p_primary, false))
  on conflict (user_id, exam_edition_id) do update set
    selected = coalesce(p_selected, user_exam_editions.selected),
    is_primary = case when coalesce(p_selected, user_exam_editions.selected) = false then false
                      else coalesce(p_primary, user_exam_editions.is_primary) end;
  -- sempre há uma prova principal entre as selecionadas
  update user_exam_editions set is_primary = true
   where id = (select ue.id from user_exam_editions ue join exam_editions ed on ed.id = ue.exam_edition_id
                where ue.user_id = v_uid and ue.selected order by ed.exam_date nulls last limit 1)
     and not exists (select 1 from user_exam_editions where user_id = v_uid and selected and is_primary);
  insert into user_exams(user_id, exam_id, selected) values (v_uid, v_exam, coalesce(p_selected, true))
  on conflict (user_id, exam_id) do update set selected = excluded.selected;
end $$;

create or replace function public.set_registration(p_edition uuid, p_status public.registration_status,
  p_number text default null, p_notes text default null)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  if p_status is null then
    delete from registrations where user_id = v_uid and exam_edition_id = p_edition;
    return;
  end if;
  insert into registrations(user_id, exam_edition_id, status, registration_number, notes, registration_date)
  values (v_uid, p_edition, p_status, p_number, p_notes, case when p_status = 'registered' then current_date end)
  on conflict (user_id, exam_edition_id) do update set
    status = p_status,
    registration_number = coalesce(p_number, registrations.registration_number),
    notes = coalesce(p_notes, registrations.notes),
    registration_date = case when p_status = 'registered' and registrations.registration_date is null
                             then current_date else registrations.registration_date end,
    updated_at = now();
end $$;

/**
 * Grava um planner calculado no navegador (algoritmos em shared/) numa única
 * transação: arquiva o anterior (histórico preservado) e insere o novo.
 */
create or replace function public.save_plan(p jsonb)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id(); v_id uuid;
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  update study_plans set status = 'archived' where user_id = v_uid and status = 'active';
  insert into study_plans(user_id, name, start_date, end_date, primary_exam_edition_id, mode, algorithm_version,
                          scheduler_version, settings_snapshot, summary)
  values (v_uid, p->>'name', (p->>'start_date')::date, (p->>'end_date')::date, (p->>'primary_exam_edition_id')::uuid,
          p->>'mode', p->>'algorithm_version', p->>'scheduler_version', p->'settings_snapshot', p->'summary')
  returning id into v_id;

  insert into study_plan_exams(study_plan_id, exam_edition_id, user_id, is_primary, weight, exam_date, editions_analyzed)
  select v_id, x.exam_edition_id, v_uid, x.is_primary, x.weight, x.exam_date, x.editions_analyzed
    from jsonb_to_recordset(p->'exams') as x(exam_edition_id uuid, is_primary boolean, weight numeric, exam_date date, editions_analyzed int);

  insert into study_plan_subjects(study_plan_id, user_id, subject_id, historical_frequency, historical_percentage,
     annual_average, years_present, years_analyzed, recent_frequency, priority_score, priority_rank, priority_level,
     estimated_questions, size_factor, exam_date, scheduled, per_exam)
  select v_id, v_uid, x.subject_id, x.historical_frequency, x.historical_percentage, x.annual_average, x.years_present,
         x.years_analyzed, x.recent_frequency, x.priority_score, x.priority_rank, x.priority_level,
         x.estimated_questions, x.size_factor, x.exam_date, x.scheduled, x.per_exam
    from jsonb_to_recordset(p->'subjects') as x(subject_id uuid, historical_frequency numeric, historical_percentage numeric,
         annual_average numeric, years_present int, years_analyzed int, recent_frequency numeric, priority_score numeric,
         priority_rank int, priority_level text, estimated_questions numeric, size_factor numeric, exam_date date,
         scheduled boolean, per_exam jsonb);

  insert into study_schedule(user_id, study_plan_id, subject_id, study_method_id, scheduled_date, activity_type,
                             estimated_minutes, priority)
  select v_uid, v_id, x.subject_id, x.method_id, x.date, x.activity_type, x.minutes, x.priority
    from jsonb_to_recordset(p->'activities') as x(subject_id uuid, method_id uuid, date date, activity_type text, minutes int, priority int);

  -- Checklist já concluído continua concluído
  update study_schedule s set completed = true, completed_at = mp.completed_at
    from subject_method_progress mp
   where s.study_plan_id = v_id and mp.user_id = v_uid and mp.subject_id = s.subject_id and mp.study_method_id = s.study_method_id;
  return v_id;
end $$;

create or replace function public.set_method_done(p_subject uuid, p_method uuid, p_done boolean)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  if p_done then
    insert into subject_method_progress(user_id, subject_id, study_method_id) values (v_uid, p_subject, p_method)
    on conflict do nothing;
  else
    delete from subject_method_progress where user_id = v_uid and subject_id = p_subject and study_method_id = p_method;
  end if;
  update study_schedule s set completed = p_done, completed_at = case when p_done then now() end
   where s.user_id = v_uid and s.subject_id = p_subject and s.study_method_id = p_method
     and s.study_plan_id in (select id from study_plans where user_id = v_uid and status = 'active');
end $$;

-- ---------------------------------------------------------------------
-- Administração
-- ---------------------------------------------------------------------
create or replace function app.require_admin() returns void language plpgsql stable as $$
begin
  if not app.is_admin() then raise exception 'Área restrita a administradores.' using errcode = '42501'; end if;
end $$;
grant execute on function app.require_admin() to authenticated;

create or replace view public.admin_institutions with (security_invoker = true) as
select i.*, (select count(*) from exams e where e.institution_id = i.id)::int as exams from institutions i;

create or replace view public.admin_exams with (security_invoker = true) as
select e.*, i.abbreviation as institution, i.name as institution_name, b.abbreviation as board,
       (select count(*) from exam_editions ed where ed.exam_id = e.id)::int as editions,
       (select count(*) from exam_editions ed where ed.exam_id = e.id and ed.status = 'published')::int as published_editions,
       (select count(*) from questions q join exam_editions ed on ed.id = q.exam_edition_id where ed.exam_id = e.id and q.active)::int as questions
  from exams e join institutions i on i.id = e.institution_id left join examining_boards b on b.id = e.board_id;

create or replace view public.admin_editions with (security_invoker = true) as
select ed.*, e.name as exam_name, e.total_questions as exam_total_questions, i.abbreviation as institution,
       b.abbreviation as board,
       (select count(*) from questions q where q.exam_edition_id = ed.id and q.active)::int as questions,
       (select count(*) from questions q where q.exam_edition_id = ed.id and q.active
          and exists (select 1 from question_subjects qs where qs.question_id = q.id))::int as classified,
       (select count(*) from questions q where q.exam_edition_id = ed.id and q.active and q.annulled)::int as annulled,
       (select count(*) from questions q where q.exam_edition_id = ed.id and q.active and q.statement is not null)::int as with_statement,
       p.name as registered_by_name
  from exam_editions ed join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
  left join examining_boards b on b.id = e.board_id
  left join user_profiles p on p.user_id = ed.registered_by;

create or replace view public.admin_areas with (security_invoker = true) as
select a.*, (select count(*) from subjects s where s.medical_area_id = a.id)::int as subjects from medical_areas a;

create or replace view public.admin_import_batches with (security_invoker = true) as
select b.*, e.name as exam_name, i.abbreviation as institution, p.name as created_by_name
  from import_batches b join exams e on e.id = b.exam_id join institutions i on i.id = e.institution_id
  left join user_profiles p on p.user_id = b.created_by;

create or replace function public.admin_subjects()
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_area, x.name) from (
    select s.*, a.name as area_name, pa.name as parent_area_name, ps.name as parent_name, coalesce(pa.name, a.name) as sort_area,
           (select count(distinct qs.question_id) from question_subjects qs where qs.subject_id = s.id)::int as questions,
           (select coalesce(jsonb_agg(al.alias order by al.alias), '[]') from subject_aliases al where al.subject_id = s.id) as aliases
      from subjects s
      join medical_areas a on a.id = s.medical_area_id
      left join medical_areas pa on pa.id = a.parent_id
      left join subjects ps on ps.id = s.parent_subject_id) x), '[]'::jsonb);
end $$;

create or replace function public.admin_catalog()
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return jsonb_build_object(
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'name', name)) from medical_areas where active), '[]'),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'parent_subject_id', parent_subject_id, 'medical_area_id', medical_area_id, 'name', name)) from subjects where active), '[]'),
    'aliases', coalesce((select jsonb_agg(jsonb_build_object('alias', alias, 'subject_id', subject_id)) from subject_aliases), '[]'));
end $$;

create or replace function public.admin_edition_questions(p_edition uuid)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('subjects', coalesce((
      select jsonb_agg(jsonb_build_object('subject_id', s.id, 'name', s.name, 'parent', ps.name,
               'weight', qs.relevance_weight, 'is_primary', qs.is_primary) order by qs.is_primary desc)
        from question_subjects qs join subjects s on s.id = qs.subject_id left join subjects ps on ps.id = s.parent_subject_id
       where qs.question_id = q.id), '[]')) order by q.question_number)
    from questions q where q.exam_edition_id = p_edition), '[]'::jsonb);
end $$;

create or replace function public.admin_existing_questions(p_exam uuid)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return jsonb_build_object(
    'questions', coalesce((select jsonb_agg(jsonb_build_array(ed.year, q.question_number))
                             from questions q join exam_editions ed on ed.id = q.exam_edition_id where ed.exam_id = p_exam), '[]'),
    'editions', coalesce((select jsonb_agg(jsonb_build_object('year', year, 'status', status)) from exam_editions where exam_id = p_exam), '[]'));
end $$;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return jsonb_build_object(
    'counts', (select to_jsonb(c) from (select
        (select count(*) from institutions)::int as institutions,
        (select count(*) from examining_boards)::int as boards,
        (select count(*) from exams)::int as exams,
        (select count(*) from exam_editions)::int as editions,
        (select count(*) from exam_editions where status = 'published')::int as published_editions,
        (select count(*) from exam_editions where status = 'draft')::int as draft_editions,
        (select count(*) from questions where active)::int as questions,
        (select count(*) from questions q where active and not exists (select 1 from question_subjects qs where qs.question_id = q.id))::int as unclassified_questions,
        (select count(*) from subjects where active)::int as subjects,
        (select count(*) from subjects where active and parent_subject_id is null)::int as root_subjects,
        (select count(*) from user_profiles)::int as users,
        (select count(*) from user_profiles where role = 'visitor')::int as visitors) c),
    'recent', coalesce((select jsonb_agg(to_jsonb(l)) from (select * from admin_audit_logs order by changed_at desc, id desc limit 8) l), '[]'));
end $$;

-- E-mails vêm do Supabase Auth: SECURITY DEFINER, mas só para administradores.
create or replace function public.admin_users()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'name', p.name, 'role', p.role, 'active', p.active, 'created_at', p.created_at,
      'email', u.email, 'is_guest', coalesce(u.is_anonymous, false), 'last_login_at', u.last_sign_in_at,
      'plans', (select count(*) from study_plans sp where sp.user_id = p.user_id)) order by p.created_at desc)
    from user_profiles p join auth.users u on u.id = p.user_id), '[]'::jsonb);
end $$;

create or replace function public.set_question_subjects(p_question uuid, p_links jsonb)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  if jsonb_array_length(p_links) > 0 and (select count(*) from jsonb_array_elements(p_links) x where (x->>'isPrimary')::boolean) <> 1 then
    raise exception 'Marque exatamente um assunto principal.' using errcode = '22023';
  end if;
  delete from question_subjects where question_id = p_question
    and subject_id not in (select (x->>'subjectId')::uuid from jsonb_array_elements(p_links) x);
  update question_subjects set is_primary = false where question_id = p_question;
  insert into question_subjects(question_id, subject_id, relevance_weight, is_primary)
  select p_question, (x->>'subjectId')::uuid, coalesce((x->>'weight')::numeric, 1), coalesce((x->>'isPrimary')::boolean, false)
    from jsonb_array_elements(p_links) x
  on conflict (question_id, subject_id) do update set relevance_weight = excluded.relevance_weight, is_primary = excluded.is_primary;
end $$;

/** Mescla um assunto em outro: reclassifica, cria alias e desativa o original (não apaga). */
create or replace function public.merge_subject(p_source uuid, p_target uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_name text;
begin
  perform app.require_admin();
  if p_source = p_target then raise exception 'Escolha outro assunto.' using errcode = '22023'; end if;
  select name into v_name from subjects where id = p_source;
  if v_name is null then raise exception 'Assunto não encontrado.' using errcode = 'P0002'; end if;
  update subjects set parent_subject_id = p_target where parent_subject_id = p_source;
  update question_subjects qs set subject_id = p_target where subject_id = p_source
     and not exists (select 1 from question_subjects x where x.question_id = qs.question_id and x.subject_id = p_target);
  delete from question_subjects where subject_id = p_source;
  update subject_aliases set subject_id = p_target where subject_id = p_source;
  insert into subject_aliases(subject_id, alias) values (p_target, v_name) on conflict do nothing;
  update subjects set active = false where id = p_source;
end $$;

/**
 * Importação: insere questões e classificações numa transação, criando como
 * RASCUNHO as edições que ainda não existem. Áreas e assuntos novos já foram
 * criados pelo navegador após a decisão explícita do administrador.
 */
create or replace function public.import_questions(p_exam uuid, p_rows jsonb, p_filename text, p_format text,
  p_source text, p_total_rows int)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare y int; v_created int[] := '{}'; v_inserted int; v_links int;
begin
  perform app.require_admin();
  for y in select distinct (x->>'year')::int from jsonb_array_elements(p_rows) x order by 1 loop
    if not exists (select 1 from exam_editions where exam_id = p_exam and year = y) then
      insert into exam_editions(exam_id, year, status, source_name, registered_by)
      values (p_exam, y, 'draft', coalesce(p_source, 'Importação ' || p_filename), auth.uid());
      v_created := v_created || y;
    end if;
  end loop;

  with rows as (
    select x.*, ed.id as edition_id
      from jsonb_to_recordset(p_rows) as x(year int, question_number int, statement text, summary text,
             alternative_a text, alternative_b text, alternative_c text, alternative_d text, alternative_e text,
             correct_answer char(1), annulled boolean, explanation text, difficulty public.difficulty, question_type text,
             guideline text, source text, notes text, subject_id uuid)
      join exam_editions ed on ed.exam_id = p_exam and ed.year = x.year
  ), ins as (
    insert into questions(exam_edition_id, question_number, statement, summary, alternative_a, alternative_b, alternative_c,
        alternative_d, alternative_e, correct_answer, annulled, explanation, difficulty, question_type, guideline, source, notes)
    select edition_id, question_number, statement, summary, alternative_a, alternative_b, alternative_c, alternative_d,
           alternative_e, correct_answer, coalesce(annulled, false), explanation, difficulty, question_type, guideline,
           coalesce(source, p_source, p_filename), notes
      from rows
    returning id, exam_edition_id, question_number
  ), links as (
    insert into question_subjects(question_id, subject_id, relevance_weight, is_primary)
    select ins.id, r.subject_id, 1, true from ins join rows r on r.edition_id = ins.exam_edition_id and r.question_number = ins.question_number
     where r.subject_id is not null
    returning 1
  )
  select (select count(*) from ins), (select count(*) from links) into v_inserted, v_links;

  insert into import_batches(exam_id, filename, file_format, source, total_rows, inserted_rows, skipped_rows, created_by)
  values (p_exam, p_filename, p_format, p_source, p_total_rows, v_inserted, p_total_rows - v_inserted, auth.uid());

  return jsonb_build_object('inserted', v_inserted, 'classified', v_links, 'unclassified', v_inserted - v_links,
                            'skipped', p_total_rows - v_inserted, 'editionsCreated', to_jsonb(v_created));
end $$;

/**
 * Promove um usuário a administrador. Uso EXCLUSIVO no SQL Editor do Supabase:
 *   select public.make_admin('voce@exemplo.com');
 */
create or replace function public.make_admin(p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not app.is_privileged_session() then raise exception 'use o SQL Editor' using errcode = '42501'; end if;
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'Nenhum usuário com o e-mail %. Crie a conta no site primeiro.', p_email; end if;
  update user_profiles set role = 'admin', active = true where user_id = v_id;
  return 'Administrador: ' || p_email;
end $$;

-- Permissões das views e funções
revoke all on function public.make_admin(text) from public, anon, authenticated;
grant select on public.subject_roots, public.exam_catalog, public.admin_institutions, public.admin_exams,
  public.admin_editions, public.admin_areas, public.admin_import_batches to authenticated;
grant execute on function public.exam_history_data(uuid[], boolean), public.subjects_info(uuid[]),
  public.subject_children(uuid), public.set_edition_selection(uuid, boolean, boolean),
  public.set_registration(uuid, public.registration_status, text, text), public.save_plan(jsonb),
  public.set_method_done(uuid, uuid, boolean), public.admin_subjects(), public.admin_catalog(),
  public.admin_edition_questions(uuid), public.admin_existing_questions(uuid), public.admin_dashboard(),
  public.admin_users(), public.set_question_subjects(uuid, jsonb), public.merge_subject(uuid, uuid),
  public.import_questions(uuid, jsonb, text, text, text, int) to authenticated;
revoke execute on all functions in schema public from anon;


-- >>> 04_reference.sql
-- Dados de referência do SISTEMA (não são dados de provas).
-- Nenhuma instituição, prova, edição, questão ou assunto é criado aqui:
-- essa base é exclusivamente alimentada pelo administrador.

insert into public.study_methods (code, name, activity_type, default_minutes, sort_order) values
  ('video',         'Videoaula',     'video',         60, 1),
  ('flashcards',    'Flashcards',    'flashcards',    20, 2),
  ('summary',       'Resumo',        'summary',       40, 3),
  ('reading',       'Leitura',       'reading',       45, 4),
  ('questions',     'Questões',      'questions',     40, 5),
  ('active_recall', 'Revisão ativa', 'active_recall', 20, 6);

insert into public.algorithm_versions (name, version, description, parameters) values
  ('Prioridade', 'priority_v2',
   'Ranking pela regularidade (em quantas provas o assunto caiu; os que caíram todos os anos vêm primeiro), depois pela quantidade de questões e pela recência, ponderado pelas provas selecionadas; score dinâmico: 40% histórico, 25% proximidade da prova, 20% esquecimento, 15% desempenho.',
   '{"weights":{"historical":0.40,"proximity":0.25,"forgetting":0.20,"performance":0.15}}'),
  ('Repetição espaçada', 'fsrs_v1',
   'Modelo próprio inspirado no FSRS: estabilidade, dificuldade e retrievability com curva de esquecimento em lei de potência; retenção-alvo e intervalo máximo ajustados pelo tempo até a prova; nunca agenda após a prova.',
   '{}'),
  ('Agenda', 'scheduler_v1',
   'Distribuição diária respeitando horas, dias de estudo, questões/dia e carga projetada de revisões; reta final reservada para revisões.',
   '{}');


-- >>> 05_user_exam_details.sql
-- =====================================================================
-- Data da prova, período de inscrição e valor são informados pelo PRÓPRIO
-- aluno (dados individuais). O administrador cadastra apenas instituição,
-- prova e o histórico de questões; o aluno só escolhe entre essas provas.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.user_exam_editions add column if not exists exam_date date;
alter table public.user_exam_editions add column if not exists registration_start date;
alter table public.user_exam_editions add column if not exists registration_end date;
alter table public.user_exam_editions add column if not exists registration_fee numeric(10,2);
alter table public.user_exam_editions add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_exam_editions_fee_chk') then
    alter table public.user_exam_editions add constraint user_exam_editions_fee_chk
      check (registration_fee is null or registration_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_exam_editions_period_chk') then
    alter table public.user_exam_editions add constraint user_exam_editions_period_chk
      check (registration_start is null or registration_end is null or registration_start <= registration_end);
  end if;
end $$;

/** Salva os dados da prova informados pelo aluno (não altera a seleção). */
create or replace function public.set_exam_details(p_edition uuid, p_exam_date date, p_registration_start date,
  p_registration_end date, p_registration_fee numeric)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  if not exists (select 1 from exam_editions where id = p_edition and status = 'published') then
    raise exception 'Prova não encontrada.' using errcode = 'P0002';
  end if;
  insert into user_exam_editions(user_id, exam_edition_id, selected, exam_date, registration_start, registration_end, registration_fee)
  values (v_uid, p_edition, false, p_exam_date, p_registration_start, p_registration_end, p_registration_fee)
  on conflict (user_id, exam_edition_id) do update set
    exam_date = excluded.exam_date, registration_start = excluded.registration_start,
    registration_end = excluded.registration_end, registration_fee = excluded.registration_fee, updated_at = now();
end $$;

grant execute on function public.set_exam_details(uuid, date, date, date, numeric) to authenticated;
revoke execute on function public.set_exam_details(uuid, date, date, date, numeric) from anon;


-- >>> 06_subject_activities.sql
-- =====================================================================
-- Atividades escolhidas pelo aluno para cada assunto (opcional).
-- Sem escolha específica, valem os métodos marcados em "Como você estuda?".
-- Um assunto é CONCLUÍDO quando todas as atividades escolhidas estão feitas.
-- Questões são só mais uma atividade: nunca são exigidas.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.subject_activity_choices (
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id),
  study_method_id uuid not null references public.study_methods(id),
  created_at      timestamptz not null default now(),
  primary key (user_id, subject_id, study_method_id)
);
alter table public.subject_activity_choices enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'subject_activity_choices' and policyname = 'owner_all') then
    create policy owner_all on public.subject_activity_choices for all to authenticated
      using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
  end if;
end $$;

revoke all on public.subject_activity_choices from anon;
grant select, insert, delete on public.subject_activity_choices to authenticated;

/** Define as atividades de um assunto (lista vazia = voltar ao padrão). */
create or replace function public.set_subject_activities(p_subject uuid, p_methods uuid[])
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  delete from subject_activity_choices where user_id = v_uid and subject_id = p_subject;
  insert into subject_activity_choices(user_id, subject_id, study_method_id)
  select v_uid, p_subject, m from unnest(coalesce(p_methods, '{}'::uuid[])) as m
  on conflict do nothing;
end $$;
grant execute on function public.set_subject_activities(uuid, uuid[]) to authenticated;
revoke execute on function public.set_subject_activities(uuid, uuid[]) from anon;


-- >>> 07_dynamic_planner.sql
-- =====================================================================
-- Planner dinâmico
--  * revisões por dia escolhidas pelo aluno (padrão: até 2)
--  * observações da semana (anotações livres do aluno)
--  * datas oficiais das próximas provas (cadastradas pelo administrador;
--    quando existem, o aluno não precisa — nem pode — alterá-las)
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.study_profiles add column if not exists reviews_per_day int not null default 2;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'study_profiles_reviews_per_day_chk') then
    alter table public.study_profiles add constraint study_profiles_reviews_per_day_chk check (reviews_per_day between 1 and 30);
  end if;
end $$;

create table if not exists public.weekly_notes (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  content    text not null default '' check (char_length(content) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.weekly_notes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'weekly_notes' and policyname = 'owner_all') then
    create policy owner_all on public.weekly_notes for all to authenticated
      using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
  end if;
end $$;

revoke all on public.weekly_notes from anon;
grant select, insert, update, delete on public.weekly_notes to authenticated;

-- Datas oficiais das próximas provas
update public.exam_editions ed set exam_date = v.d
  from (values ('FAMERP', date '2026-11-24'), ('UNOESTE/HRPP', date '2026-12-05')) as v(inst, d),
       public.exams e, public.institutions i
 where ed.exam_id = e.id and e.institution_id = i.id and i.abbreviation = v.inst
   and e.name = 'R1 Acesso Direto' and ed.year = 2027;

-- Conferência
select i.abbreviation, ed.year, ed.exam_date
  from public.exam_editions ed join public.exams e on e.id = ed.exam_id join public.institutions i on i.id = e.institution_id
 where ed.year = 2027 order by 1;


-- >>> 08_official_dates.sql
-- =====================================================================
-- Datas oficiais das próximas provas (cadastradas pelo administrador).
-- A FAMEMA (08/12/2026) já entra com a data pelo arquivo supabase/data/famema_r1.sql.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
update public.exam_editions ed set exam_date = v.d
  from (values ('FAMERP', date '2026-11-24'), ('UNOESTE/HRPP', date '2026-12-05'),
               ('HU-UEL', date '2026-11-08'), ('FAMEMA', date '2026-12-08')) as v(inst, d),
       public.exams e, public.institutions i
 where ed.exam_id = e.id and e.institution_id = i.id and i.abbreviation = v.inst
   and e.name = 'R1 Acesso Direto' and ed.year = 2027;

-- Conferência
select i.abbreviation, ed.year, ed.exam_date
  from public.exam_editions ed join public.exams e on e.id = ed.exam_id join public.institutions i on i.id = e.institution_id
 where ed.year = 2027 order by 1;


-- >>> 09_reset_profile.sql
-- =====================================================================
-- "Zerar meu perfil": apaga TODOS os dados de estudo do próprio aluno
-- (provas escolhidas, planner, checklist, questões, revisões, observações,
-- configurações) e mantém só a conta (nome e e-mail). Não toca em nada de
-- outros usuários nem nas provas cadastradas. Seguro para rodar de novo.
-- =====================================================================
create or replace function public.reset_my_data()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  delete from review_logs where user_id = v_uid;
  delete from spaced_repetition_cards where user_id = v_uid;
  delete from question_practice_logs where user_id = v_uid;
  delete from user_question_attempts where user_id = v_uid;
  delete from user_subject_performance where user_id = v_uid;
  delete from subject_method_progress where user_id = v_uid;
  if to_regclass('public.subject_activity_choices') is not null then
    execute 'delete from public.subject_activity_choices where user_id = $1' using v_uid;
  end if;
  if to_regclass('public.weekly_notes') is not null then
    execute 'delete from public.weekly_notes where user_id = $1' using v_uid;
  end if;
  delete from study_plans where user_id = v_uid;          -- cascata: provas, assuntos e agenda do plano
  delete from user_study_methods where user_id = v_uid;
  delete from study_profiles where user_id = v_uid;
  delete from registrations where user_id = v_uid;
  delete from user_exam_editions where user_id = v_uid;
  delete from user_exams where user_id = v_uid;
end $$;

revoke execute on function public.reset_my_data() from public, anon;
grant execute on function public.reset_my_data() to authenticated;


-- >>> 10_plan_templates.sql
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
