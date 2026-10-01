-- =====================================================================
-- Acesso pago: cada conta nova só entra no site depois de usar um código
-- de acesso (vendido fora do site pela administração). Vale para sempre.
--
--   * conta nova nasce inativa e "aguardando código" (awaiting_token);
--   * public.redeem_access_token(código) marca o código como usado (uma
--     conta só) e ativa o perfil — tudo no banco, então chamar o Supabase
--     direto pelo console não pula a etapa;
--   * conta inativa não lê nem grava nada (app.current_user_id() exige
--     p.active), e quem foi bloqueado pela administração não se reativa
--     com outro código (awaiting_token = false);
--   * a base de provas também só é lida por conta ativa;
--   * o modo visitante (login anônimo) deixa de existir: visitante nasce
--     inativo e os visitantes que já existiam são desativados.
--
-- Contas que já existiam continuam ativas. Seguro para rodar mais de uma vez.
-- Depois de rodar: Authentication → Sign In / Providers → desative
-- "Allow anonymous sign-ins".
-- =====================================================================
alter table public.user_profiles add column if not exists awaiting_token boolean not null default false;

create table if not exists public.access_tokens (
  id          uuid primary key default gen_random_uuid(),
  -- Só letras e números, sem 0/O/1/I; a tela mostra em grupos de 4 (ABCD-EFGH-JKLM)
  code        text not null unique check (code ~ '^[A-Z0-9]{8,32}$'),
  note        text not null default '' check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  used_by     uuid unique references auth.users(id) on delete set null,
  used_at     timestamptz,
  revoked_at  timestamptz
);
alter table public.access_tokens enable row level security;

-- Tentativas erradas (limite contra quem tenta adivinhar códigos)
create table if not exists public.access_token_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists access_token_attempts_user_idx on public.access_token_attempts (user_id, attempted_at);
alter table public.access_token_attempts enable row level security;

-- Ninguém lê essas tabelas pela API: só pelas funções abaixo
revoke all on public.access_tokens, public.access_token_attempts from anon, authenticated;

-- ---------------------------------------------------------------------
-- Perfis novos (substitui a versão de 02_security.sql)
-- ---------------------------------------------------------------------
create or replace function app.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_guest boolean := coalesce(new.is_anonymous, false);
begin
  insert into public.user_profiles(user_id, name, role, active, awaiting_token)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), case when v_guest then 'Visitante' else split_part(coalesce(new.email, ''), '@', 1) end),
    case when v_guest then 'visitor'::public.user_role else 'user'::public.user_role end,
    false,
    not v_guest
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- Visitante que vira conta continua precisando de um código
create or replace function app.on_auth_user_updated() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    perform set_config('app.bypass_profile_guard', 'on', true);
    update public.user_profiles
       set role = 'user',
           awaiting_token = not active,
           name = coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), name)
     where user_id = new.id and role = 'visitor';
    perform set_config('app.bypass_profile_guard', 'off', true);
  end if;
  return new;
end $$;

-- O usuário não muda o próprio awaiting_token (nem tem grant na coluna; isto é a segunda trava)
create or replace function app.guard_user_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' or app.is_privileged_session() then
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id é imutável' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.awaiting_token is distinct from old.awaiting_token) then
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

create or replace function public.make_admin(p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not app.is_privileged_session() then raise exception 'use o SQL Editor' using errcode = '42501'; end if;
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'Nenhum usuário com o e-mail %. Crie a conta no site primeiro.', p_email; end if;
  update user_profiles set role = 'admin', active = true, awaiting_token = false where user_id = v_id;
  return 'Administrador: ' || p_email;
end $$;
revoke all on function public.make_admin(text) from public, anon, authenticated;

-- A base de provas (o que se vende) só para contas ativas: a política restritiva
-- soma-se às de leitura de 02_security.sql (conta sem código ou bloqueada não lê nada)
do $$ declare t text; begin
  foreach t in array array['institutions','examining_boards','exams','exam_editions','medical_areas','subjects',
    'subject_aliases','questions','question_subjects','study_methods','algorithm_versions','import_batches','admin_audit_logs']
  loop
    execute format('drop policy if exists active_only on public.%I', t);
    execute format('create policy active_only on public.%I as restrictive for select to authenticated using ((select app.current_user_id()) is not null)', t);
  end loop;
end $$;

-- Visitantes que já existiam saem (só no SQL Editor, onde a trava do perfil não vale)
update public.user_profiles set active = false where role = 'visitor' and active;

-- ---------------------------------------------------------------------
-- Situação da conta logada: 'active' | 'awaiting_token' | 'blocked'
-- ---------------------------------------------------------------------
create or replace function public.my_access()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when p.active then 'active' when p.awaiting_token then 'awaiting_token' else 'blocked' end
    from user_profiles p where p.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Usar um código
-- ---------------------------------------------------------------------
create or replace function app.normalize_access_code(p_code text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

/** Devolve {ok, error}: erro de código não pode virar exceção, senão a tentativa não fica registrada. */
create or replace function public.redeem_access_token(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile user_profiles%rowtype;
  v_token uuid;
begin
  if v_uid is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  if coalesce((select is_anonymous from auth.users where id = v_uid), false) then
    raise exception 'Crie uma conta com e-mail para usar o código.' using errcode = '42501';
  end if;
  select * into v_profile from user_profiles where user_id = v_uid for update;
  if not found then raise exception 'Perfil não encontrado.' using errcode = 'P0002'; end if;
  if v_profile.active then return jsonb_build_object('ok', true); end if;
  if not v_profile.awaiting_token then
    raise exception 'Esta conta está bloqueada. Fale com a administração.' using errcode = '42501';
  end if;
  if (select count(*) from access_token_attempts
       where user_id = v_uid and attempted_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  end if;

  update access_tokens set used_by = v_uid, used_at = now()
   where code = app.normalize_access_code(p_code) and used_by is null and revoked_at is null
  returning id into v_token;
  if v_token is null then
    insert into access_token_attempts(user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'Código inválido ou já usado.');
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  update user_profiles set active = true, awaiting_token = false where user_id = v_uid;
  perform set_config('app.bypass_profile_guard', 'off', true);
  delete from access_token_attempts where user_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Administração dos códigos
-- ---------------------------------------------------------------------
/** 12 caracteres de um alfabeto de 32 (sem 0/O/1/I) = 60 bits aleatórios. */
create or replace function app.new_access_code() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  out text := '';
  i int;
begin
  -- Bytes 6 e 8 do UUID v4 têm bits fixos (versão/variante): ficam de fora
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15] loop
    out := out || substr(alphabet, get_byte(b, i) % 32 + 1, 1);
  end loop;
  return out;
end $$;

create or replace function public.admin_create_access_tokens(p_count int, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_codes text[] := '{}'; v_code text;
begin
  perform app.require_admin();
  if p_count is null or p_count < 1 or p_count > 100 then
    raise exception 'Gere de 1 a 100 códigos por vez.' using errcode = '22023';
  end if;
  while coalesce(array_length(v_codes, 1), 0) < p_count loop
    v_code := app.new_access_code();
    insert into access_tokens(code, note, created_by) values (v_code, left(coalesce(p_note, ''), 200), auth.uid())
    on conflict (code) do nothing;
    if found then v_codes := v_codes || v_code; end if;
  end loop;
  return to_jsonb(v_codes);
end $$;

create or replace function public.admin_access_tokens()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform app.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'code', t.code, 'note', t.note, 'created_at', t.created_at,
      'used_at', t.used_at, 'revoked_at', t.revoked_at,
      'used_by_email', u.email, 'used_by_name', p.name, 'user_active', p.active)
      order by t.created_at desc, t.code)
    from access_tokens t
    left join auth.users u on u.id = t.used_by
    left join user_profiles p on p.user_id = t.used_by), '[]'::jsonb);
end $$;

/** Cancela um código. Se já foi usado, a conta que usou perde o acesso. */
create or replace function public.admin_revoke_access_token(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  perform app.require_admin();
  update access_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_id returning used_by into v_user;
  if not found then raise exception 'Código não encontrado.' using errcode = 'P0002'; end if;
  if v_user is not null and v_user <> auth.uid() then
    perform set_config('app.bypass_profile_guard', 'on', true);
    update user_profiles set active = false, awaiting_token = false where user_id = v_user and role <> 'admin';
    perform set_config('app.bypass_profile_guard', 'off', true);
  end if;
end $$;

revoke execute on function public.my_access(), public.redeem_access_token(text), public.admin_create_access_tokens(int, text),
  public.admin_access_tokens(), public.admin_revoke_access_token(uuid) from public, anon;
grant execute on function public.my_access(), public.redeem_access_token(text), public.admin_create_access_tokens(int, text),
  public.admin_access_tokens(), public.admin_revoke_access_token(uuid) to authenticated;
revoke execute on function app.new_access_code(), app.normalize_access_code(text) from public, anon, authenticated;

-- Conferência: deve mostrar 0 (nenhum visitante com acesso)
select count(*) as visitantes_ativos from public.user_profiles where role = 'visitor' and active;
