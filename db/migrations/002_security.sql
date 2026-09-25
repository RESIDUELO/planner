-- =====================================================================
-- Segurança: papéis, contexto da requisição, RLS, auditoria.
--
-- A API executa TODA transação com `SET LOCAL ROLE rp_app` e informa apenas o
-- hash do token de sessão (`app.session`). O usuário atual e seu papel são
-- resolvidos DENTRO do banco a partir desse hash. Assim, mesmo uma requisição
-- manual (ou um bug numa rota) não consegue:
--   * alterar tabelas globais sem ser administrador;
--   * ler ou alterar dados de outro usuário;
--   * promover o próprio perfil a administrador;
--   * apagar registros históricos (DELETE não é concedido nas tabelas globais).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'rp_app') then
    create role rp_app nologin;
  end if;
end $$;

grant usage on schema public, app to rp_app;
revoke all on schema auth from public;
revoke all on all tables in schema auth from public;

-- ---------------------------------------------------------------------
-- Contexto
-- ---------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable security definer set search_path = auth, public, pg_temp as $$
  select s.user_id
    from auth.sessions s
    join public.user_profiles p on p.user_id = s.user_id and p.active
   where s.token_hash = nullif(current_setting('app.session', true), '')
     and s.expires_at > now()
$$;

create or replace function app.current_role_name() returns public.user_role
language sql stable security definer set search_path = auth, public, pg_temp as $$
  select p.role from public.user_profiles p where p.user_id = app.current_user_id()
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = auth, public, pg_temp as $$
  select coalesce(app.current_role_name() = 'admin', false)
$$;

grant execute on function app.current_user_id(), app.current_role_name(), app.is_admin() to rp_app;

-- ---------------------------------------------------------------------
-- Autenticação (hash bcrypt via pgcrypto; o hash nunca sai do banco)
-- ---------------------------------------------------------------------
create or replace function auth.register(p_email text, p_password text, p_name text)
returns uuid language plpgsql security definer set search_path = auth, public, pg_temp as $$
declare v_id uuid;
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'senha_curta' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where email = p_email::citext) then
    raise exception 'email_em_uso' using errcode = '23505';
  end if;
  insert into auth.users(email, password_hash) values (p_email, crypt(p_password, gen_salt('bf', 10)))
  returning id into v_id;
  insert into public.user_profiles(user_id, name, role) values (v_id, p_name, 'user');
  return v_id;
end $$;

create or replace function auth.create_guest() returns uuid
language plpgsql security definer set search_path = auth, public, pg_temp as $$
declare v_id uuid;
begin
  insert into auth.users(is_guest) values (true) returning id into v_id;
  insert into public.user_profiles(user_id, name, role) values (v_id, 'Visitante', 'visitor');
  return v_id;
end $$;

-- Converte o visitante atual em conta comum, preservando todo o progresso.
create or replace function auth.upgrade_guest(p_email text, p_password text, p_name text)
returns uuid language plpgsql security definer set search_path = auth, public, pg_temp as $$
declare v_id uuid := app.current_user_id();
begin
  if v_id is null or not exists (select 1 from auth.users where id = v_id and is_guest) then
    raise exception 'nao_e_visitante' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'senha_curta' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where email = p_email::citext) then
    raise exception 'email_em_uso' using errcode = '23505';
  end if;
  update auth.users set email = p_email, password_hash = crypt(p_password, gen_salt('bf', 10)), is_guest = false
   where id = v_id;
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.user_profiles set name = p_name, role = 'user' where user_id = v_id;
  perform set_config('app.bypass_profile_guard', 'off', true);
  return v_id;
end $$;

create or replace function auth.verify_login(p_email text, p_password text) returns uuid
language sql security definer set search_path = auth, public, pg_temp as $$
  update auth.users u set last_login_at = now()
   where u.email = p_email::citext and not u.is_guest
     and u.password_hash = crypt(p_password, u.password_hash)
     and exists (select 1 from public.user_profiles p where p.user_id = u.id and p.active)
  returning u.id
$$;

create or replace function auth.create_session(p_user uuid, p_token_hash text, p_days int, p_user_agent text)
returns void language sql security definer set search_path = auth, public, pg_temp as $$
  insert into auth.sessions(user_id, token_hash, expires_at, user_agent)
  values (p_user, p_token_hash, now() + make_interval(days => p_days), left(p_user_agent, 300))
$$;

create or replace function auth.end_session(p_token_hash text) returns void
language sql security definer set search_path = auth, public, pg_temp as $$
  delete from auth.sessions where token_hash = p_token_hash
$$;

create or replace function auth.session_info(p_token_hash text)
returns table(user_id uuid, email text, name text, role public.user_role, is_guest boolean)
language sql security definer set search_path = auth, public, pg_temp as $$
  update auth.sessions s set last_seen_at = now()
   where s.token_hash = p_token_hash and s.expires_at > now()
  returning s.user_id,
            (select u.email::text from auth.users u where u.id = s.user_id),
            (select p.name from public.user_profiles p where p.user_id = s.user_id),
            (select p.role from public.user_profiles p where p.user_id = s.user_id and p.active),
            (select u.is_guest from auth.users u where u.id = s.user_id)
$$;

-- E-mail dos usuários (somente administradores)
create or replace function auth.admin_user_emails()
returns table(user_id uuid, email text, is_guest boolean, last_login_at timestamptz)
language plpgsql stable security definer set search_path = auth, public, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'acesso_negado' using errcode = '42501'; end if;
  return query select u.id, u.email::text, u.is_guest, u.last_login_at from auth.users u;
end $$;

grant usage on schema auth to rp_app;
grant execute on function auth.register(text, text, text), auth.create_guest(), auth.upgrade_guest(text, text, text),
  auth.verify_login(text, text), auth.create_session(uuid, text, int, text), auth.end_session(text),
  auth.session_info(text), auth.admin_user_emails() to rp_app;

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
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' then return new; end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not app.is_admin() then
      raise exception 'somente administradores alteram papel ou status' using errcode = '42501';
    end if;
    if new.user_id = app.current_user_id() then
      raise exception 'administrador não pode alterar o próprio papel ou status' using errcode = '42501';
    end if;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id é imutável' using errcode = '42501';
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
  v_actor uuid := app.current_user_id();
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
-- Grants
-- ---------------------------------------------------------------------
-- Globais: leitura para todos (filtrada por RLS), escrita só admin (RLS). Sem DELETE.
grant select, insert, update on public.institutions, public.examining_boards, public.exams, public.exam_editions,
  public.medical_areas, public.subjects, public.questions, public.study_methods, public.algorithm_versions,
  public.import_batches to rp_app;
grant select, insert, update, delete on public.question_subjects, public.subject_aliases to rp_app;
grant select on public.admin_audit_logs to rp_app;
grant select, update on public.user_profiles to rp_app;

-- Individuais
grant select, insert, update, delete on public.user_exams, public.user_exam_editions, public.registrations,
  public.study_profiles, public.user_study_methods, public.study_plans, public.study_plan_exams,
  public.study_plan_subjects, public.study_schedule, public.spaced_repetition_cards to rp_app;
grant select, insert on public.review_logs, public.question_practice_logs, public.user_question_attempts to rp_app;
grant update (actual_next_review) on public.review_logs to rp_app;
grant delete on public.question_practice_logs to rp_app;
grant select on public.user_subject_performance to rp_app;

-- ---------------------------------------------------------------------
-- Row Level Security
-- (sem FORCE: o dono das tabelas — papel de migração — e as funções
--  SECURITY DEFINER acima não passam pelas policies; rp_app sempre passa)
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['user_profiles','institutions','examining_boards','exams','exam_editions','medical_areas',
    'subjects','subject_aliases','questions','question_subjects','study_methods','algorithm_versions','admin_audit_logs',
    'import_batches','user_exams','user_exam_editions','registrations','study_profiles','user_study_methods','study_plans',
    'study_plan_exams','study_plan_subjects','study_schedule','user_question_attempts','question_practice_logs',
    'user_subject_performance','spaced_repetition_cards','review_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Escrita administrativa: uma policy por comando para todas as tabelas globais
do $$ declare t text; begin
  foreach t in array array['institutions','examining_boards','exams','exam_editions','medical_areas','subjects',
    'subject_aliases','questions','question_subjects','study_methods','algorithm_versions','import_batches']
  loop
    execute format('create policy admin_insert on public.%I for insert to rp_app with check ((select app.is_admin()))', t);
    execute format('create policy admin_update on public.%I for update to rp_app using ((select app.is_admin())) with check ((select app.is_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to rp_app using ((select app.is_admin()))', t);
  end loop;
end $$;

-- Leitura: admin vê tudo; demais somente o que está publicado/ativo
create policy read_editions on public.exam_editions for select to rp_app
  using ((select app.is_admin()) or status = 'published');

create policy read_exams on public.exams for select to rp_app
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exam_editions ed where ed.exam_id = exams.id and ed.status = 'published')));

create policy read_institutions on public.institutions for select to rp_app
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exams e join public.exam_editions ed on ed.exam_id = e.id
     where e.institution_id = institutions.id and e.active and ed.status = 'published')));

create policy read_boards on public.examining_boards for select to rp_app
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exams e join public.exam_editions ed on ed.exam_id = e.id
     where e.board_id = examining_boards.id and e.active and ed.status = 'published')));

create policy read_questions on public.questions for select to rp_app
  using ((select app.is_admin()) or (active and exists (
    select 1 from public.exam_editions ed where ed.id = questions.exam_edition_id and ed.status = 'published')));

create policy read_question_subjects on public.question_subjects for select to rp_app
  using ((select app.is_admin()) or exists (
    select 1 from public.questions q join public.exam_editions ed on ed.id = q.exam_edition_id
     where q.id = question_subjects.question_id and q.active and ed.status = 'published'));

create policy read_areas on public.medical_areas for select to rp_app using ((select app.is_admin()) or active);
create policy read_subjects on public.subjects for select to rp_app using ((select app.is_admin()) or active);
create policy read_aliases on public.subject_aliases for select to rp_app using ((select app.is_admin()));
create policy read_methods on public.study_methods for select to rp_app using (true);
create policy read_algorithms on public.algorithm_versions for select to rp_app using (true);
create policy read_import_batches on public.import_batches for select to rp_app using ((select app.is_admin()));
create policy read_audit on public.admin_audit_logs for select to rp_app using ((select app.is_admin()));

-- Perfis
create policy read_profiles on public.user_profiles for select to rp_app
  using (user_id = (select app.current_user_id()) or (select app.is_admin()));
create policy update_profiles on public.user_profiles for update to rp_app
  using (user_id = (select app.current_user_id()) or (select app.is_admin()))
  with check (user_id = (select app.current_user_id()) or (select app.is_admin()));

-- Dados individuais: dono apenas
do $$ declare t text; begin
  foreach t in array array['user_exams','user_exam_editions','registrations','study_profiles','user_study_methods',
    'study_plans','study_plan_exams','study_plan_subjects','study_schedule','user_question_attempts',
    'question_practice_logs','user_subject_performance','spaced_repetition_cards','review_logs']
  loop
    execute format('create policy owner_all on public.%I for all to rp_app using (user_id = (select app.current_user_id())) with check (user_id = (select app.current_user_id()))', t);
  end loop;
end $$;
