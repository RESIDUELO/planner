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
