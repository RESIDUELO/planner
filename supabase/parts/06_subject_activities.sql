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
