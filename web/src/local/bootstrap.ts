/**
 * Banco local do app (sem Supabase): o mesmo schema do site, mais o mínimo do
 * Supabase Auth que ele usa (schema auth, auth.uid(), papéis) e um único
 * usuário local, administrador do próprio aparelho.
 */
import type { PGlite } from '@electric-sql/pglite';

export const LOCAL_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'local@residencia-planner.app',
  name: 'Você',
};

/** O que o schema do site espera encontrar do Supabase. */
export const AUTH_STUB = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean default false,
  created_at timestamptz default now()
);
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select auth.jwt() ->> 'role' $$;
`;

/** Ordem: schema, provas e, por último, o cronograma (que aponta para as provas). */
export function orderDataFiles(names: string[]) {
  return [...names].sort((a, b) => Number(a.startsWith('cronograma')) - Number(b.startsWith('cronograma')) || a.localeCompare(b));
}

/** Cria tudo num banco vazio. `data` já na ordem de orderDataFiles. */
export async function bootstrap(db: PGlite, schemaSql: string, data: string[]) {
  await db.exec(AUTH_STUB);
  await db.exec(schemaSql);
  for (const sql of data) await db.exec(sql);
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('name', $3::text)) on conflict (id) do nothing`,
    [LOCAL_USER.id, LOCAL_USER.email, LOCAL_USER.name],
  );
  // Sem claims na sessão = execução direta (como no SQL Editor), então make_admin é permitido
  await db.query(`select public.make_admin($1)`, [LOCAL_USER.email]);
}
