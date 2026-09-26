/**
 * supabase-js apontado para o banco local: as chamadas a /rest/v1 vão para o
 * PGlite (rest.ts) e o "login" é uma sessão fixa do usuário local.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { handleRest } from './rest';
import { LOCAL_USER } from './bootstrap';

const URL_BASE = 'http://local.residencia-planner';
const STORAGE_KEY = 'residencia-planner-local-auth';
const FAR = 4102444800; // 2100-01-01

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: LOCAL_USER.id, role: 'authenticated', aud: 'authenticated', email: LOCAL_USER.email, exp: FAR })}.local`;

const USER = {
  id: LOCAL_USER.id, aud: 'authenticated', role: 'authenticated', email: LOCAL_USER.email, is_anonymous: false,
  app_metadata: { provider: 'local' }, user_metadata: { name: LOCAL_USER.name }, created_at: '2026-01-01T00:00:00Z',
};
const SESSION = { access_token: TOKEN, refresh_token: 'local', token_type: 'bearer', expires_in: FAR, expires_at: FAR, user: USER };

/** Armazenamento em memória com a sessão já "logada". */
function sessionStorage() {
  const mem = new Map<string, string>([[STORAGE_KEY, JSON.stringify(SESSION)]]);
  return {
    getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(SESSION) : mem.get(k) ?? null),
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createLocalSupabase(db: PGlite): SupabaseClient {
  const localFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/rest/v1/')) return handleRest(db, input, init);
    // Auth: a sessão local nunca expira; sair não faz nada
    if (url.includes('/auth/v1/token')) return json(SESSION);
    if (url.includes('/auth/v1/user')) return json(USER);
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    return json({ message: 'Indisponível no app off-line.' }, 400);
  };
  return createClient(URL_BASE, 'local-anon-key', {
    global: { fetch: localFetch as typeof fetch },
    auth: { storage: sessionStorage(), storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
