-- =====================================================================
-- Avisos do Security Advisor do Supabase.
-- 1) search_path fixo nas funções auxiliares (Function Search Path Mutable).
-- 2) admin_users() não pode ser chamada sem login: o "revoke ... from anon"
--    não bastava, porque toda função nasce executável por PUBLIC (que
--    inclui anon). Continua só para administradores (app.require_admin).
-- Seguro para rodar mais de uma vez.
-- =====================================================================
alter function app.is_privileged_session() set search_path = public, pg_temp;
alter function app.touch_updated_at() set search_path = public, pg_temp;
alter function app.require_admin() set search_path = public, pg_temp;

revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
