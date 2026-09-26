-- =====================================================================
-- Agenda: organização pessoal (tarefas, lembretes, tarefas gerais e
-- anotações por dia). Independente do planner de estudos: nada aqui
-- entra no algoritmo, nas revisões ou no desempenho. Uma tarefa pode
-- aparecer no planner ("Mostrar no Planner"), mas continua sendo a
-- mesma linha desta tabela (uma única fonte de verdade).
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.agenda_tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- day: "hoje preciso fazer isso" · reminder: lembrete do dia · general: "em algum momento"
  kind            text not null default 'day' check (kind in ('day', 'reminder', 'general')),
  title           text not null check (char_length(title) between 1 and 300),
  -- Dia da tarefa/lembrete; na tarefa geral é o prazo (opcional)
  date            date,
  time            time,
  priority        smallint check (priority between 1 and 3),
  note            text not null default '' check (char_length(note) <= 2000),
  checklist       jsonb not null default '[]'::jsonb,
  show_in_planner boolean not null default false,
  done            boolean not null default false,
  done_at         timestamptz,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint agenda_tasks_date_chk check (kind = 'general' or date is not null)
);
create index if not exists agenda_tasks_user_date_idx on public.agenda_tasks (user_id, date);
alter table public.agenda_tasks enable row level security;

create table if not exists public.agenda_notes (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  content    text not null default '' check (char_length(content) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.agenda_notes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'agenda_tasks' and policyname = 'owner_all') then
    create policy owner_all on public.agenda_tasks for all to authenticated
      using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'agenda_notes' and policyname = 'owner_all') then
    create policy owner_all on public.agenda_notes for all to authenticated
      using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
  end if;
end $$;

revoke all on public.agenda_tasks, public.agenda_notes from anon;
grant select, insert, update, delete on public.agenda_tasks, public.agenda_notes to authenticated;
