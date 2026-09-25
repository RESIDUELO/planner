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
