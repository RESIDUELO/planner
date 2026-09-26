-- =====================================================================
-- "Excluir do planner": o assunto continua nos conteúdos, mas some do
-- planner (semana, hoje, revisões) e não entra em nenhuma conta
-- (progresso, % garantido, agenda). Dá para mostrar de novo.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
create table if not exists public.hidden_subjects (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  created_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);
alter table public.hidden_subjects enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'hidden_subjects' and policyname = 'owner_all') then
    create policy owner_all on public.hidden_subjects for all to authenticated
      using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()));
  end if;
end $$;

revoke all on public.hidden_subjects from anon;
grant select, insert, delete on public.hidden_subjects to authenticated;

-- "Zerar meu perfil" também limpa os assuntos ocultos
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
  if to_regclass('public.hidden_subjects') is not null then
    execute 'delete from public.hidden_subjects where user_id = $1' using v_uid;
  end if;
  delete from study_plans where user_id = v_uid;
  delete from user_study_methods where user_id = v_uid;
  delete from study_profiles where user_id = v_uid;
  delete from registrations where user_id = v_uid;
  delete from user_exam_editions where user_id = v_uid;
  delete from user_exams where user_id = v_uid;
end $$;

revoke execute on function public.reset_my_data() from public, anon;
grant execute on function public.reset_my_data() to authenticated;
