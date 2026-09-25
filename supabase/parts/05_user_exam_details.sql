-- =====================================================================
-- Data da prova, período de inscrição e valor são informados pelo PRÓPRIO
-- aluno (dados individuais). O administrador cadastra apenas instituição,
-- prova e o histórico de questões; o aluno só escolhe entre essas provas.
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter table public.user_exam_editions add column if not exists exam_date date;
alter table public.user_exam_editions add column if not exists registration_start date;
alter table public.user_exam_editions add column if not exists registration_end date;
alter table public.user_exam_editions add column if not exists registration_fee numeric(10,2);
alter table public.user_exam_editions add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_exam_editions_fee_chk') then
    alter table public.user_exam_editions add constraint user_exam_editions_fee_chk
      check (registration_fee is null or registration_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_exam_editions_period_chk') then
    alter table public.user_exam_editions add constraint user_exam_editions_period_chk
      check (registration_start is null or registration_end is null or registration_start <= registration_end);
  end if;
end $$;

/** Salva os dados da prova informados pelo aluno (não altera a seleção). */
create or replace function public.set_exam_details(p_edition uuid, p_exam_date date, p_registration_start date,
  p_registration_end date, p_registration_fee numeric)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := app.current_user_id();
begin
  if v_uid is null then raise exception 'login necessário' using errcode = '42501'; end if;
  if not exists (select 1 from exam_editions where id = p_edition and status = 'published') then
    raise exception 'Prova não encontrada.' using errcode = 'P0002';
  end if;
  insert into user_exam_editions(user_id, exam_edition_id, selected, exam_date, registration_start, registration_end, registration_fee)
  values (v_uid, p_edition, false, p_exam_date, p_registration_start, p_registration_end, p_registration_fee)
  on conflict (user_id, exam_edition_id) do update set
    exam_date = excluded.exam_date, registration_start = excluded.registration_start,
    registration_end = excluded.registration_end, registration_fee = excluded.registration_fee, updated_at = now();
end $$;

grant execute on function public.set_exam_details(uuid, date, date, date, numeric) to authenticated;
revoke execute on function public.set_exam_details(uuid, date, date, date, numeric) from anon;
