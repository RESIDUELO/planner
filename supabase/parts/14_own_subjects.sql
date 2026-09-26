-- =====================================================================
-- Assuntos criados pelo próprio aluno ("+ Criar novo assunto" no planner).
-- Ficam na mesma tabela de assuntos, marcados com o dono: só ele os vê, e
-- a base global das provas não muda. Funcionam como qualquer assunto
-- (checklist, revisões, Pomodoro, histórico) porque usam as mesmas tabelas.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.subjects add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
create index if not exists subjects_owner_idx on public.subjects(owner_user_id) where owner_user_id is not null;

-- Área para assuntos sem área escolhida
insert into public.medical_areas (name, slug, sort_order) values ('Outros', 'outros', 99) on conflict (slug) do nothing;

-- Base global: todos (inativos só o administrador); assunto próprio: só o dono
drop policy if exists read_subjects on public.subjects;
create policy read_subjects on public.subjects for select to authenticated
  using ((owner_user_id is null and ((select app.is_admin()) or active)) or owner_user_id = (select app.current_user_id()));

create or replace function public.create_my_subject(p_name text, p_area uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id(); v_id uuid; v_area uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 200 then raise exception 'Escreva o nome do assunto.' using errcode = '22023'; end if;
  if (select count(*) from subjects where owner_user_id = v_uid) >= 2000 then
    raise exception 'Limite de assuntos próprios atingido.' using errcode = '22023';
  end if;
  select id into v_area from medical_areas where id = p_area and active;
  if v_area is null then select id into v_area from medical_areas where slug = 'outros'; end if;
  insert into subjects (medical_area_id, name, slug, owner_user_id)
  values (v_area, v_name, 'u-' || gen_random_uuid(), v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_my_subject(p_id uuid, p_name text, p_area uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id(); v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 200 then raise exception 'Escreva o nome do assunto.' using errcode = '22023'; end if;
  update subjects set name = v_name, updated_at = now(),
         medical_area_id = coalesce((select id from medical_areas where id = p_area and active), medical_area_id)
   where id = p_id and owner_user_id = v_uid and v_uid is not null;
  if not found then raise exception 'Assunto não encontrado.' using errcode = 'P0002'; end if;
end $$;

-- Exclui o assunto próprio e tudo o que é dele (checklist, revisões, questões, cronograma)
create or replace function public.delete_my_subject(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null or not exists (select 1 from subjects where id = p_id and owner_user_id = v_uid) then
    raise exception 'Assunto não encontrado.' using errcode = 'P0002';
  end if;
  delete from review_logs where subject_id = p_id;
  delete from spaced_repetition_cards where subject_id = p_id;
  delete from study_schedule where subject_id = p_id;
  delete from subject_method_progress where subject_id = p_id;
  if to_regclass('public.subject_activity_choices') is not null then
    execute 'delete from public.subject_activity_choices where subject_id = $1' using p_id;
  end if;
  if to_regclass('public.hidden_subjects') is not null then
    execute 'delete from public.hidden_subjects where subject_id = $1' using p_id;
  end if;
  delete from user_question_attempts where subject_id = p_id;
  delete from question_practice_logs where subject_id = p_id;
  delete from user_subject_performance where subject_id = p_id;
  delete from study_plan_subjects where subject_id = p_id;
  delete from subjects where id = p_id;
end $$;

revoke execute on function public.create_my_subject(text, uuid), public.update_my_subject(uuid, text, uuid), public.delete_my_subject(uuid) from public, anon;
grant execute on function public.create_my_subject(text, uuid), public.update_my_subject(uuid, text, uuid), public.delete_my_subject(uuid) to authenticated;

-- Informações do assunto: diz também se é do próprio aluno
create or replace function public.subjects_info(p_ids uuid[])
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'area', coalesce(pa.name, a.name), 'area_id', coalesce(pa.id, a.id),
           'specialty', case when a.parent_id is not null then a.name end,
           'own', s.owner_user_id is not null)), '[]'::jsonb)
    from subjects s
    join medical_areas a on a.id = s.medical_area_id
    left join medical_areas pa on pa.id = a.parent_id
   where s.id = any(p_ids)
$$;

-- "Zerar meu perfil" também apaga os assuntos criados pelo aluno
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
  delete from subjects where owner_user_id = v_uid;
end $$;
