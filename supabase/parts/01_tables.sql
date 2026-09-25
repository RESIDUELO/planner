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
