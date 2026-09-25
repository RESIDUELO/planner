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
