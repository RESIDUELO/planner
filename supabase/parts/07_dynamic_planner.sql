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
