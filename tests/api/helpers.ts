/**
 * Harness dos testes de integração: sobe um "Supabase local" (PostgreSQL +
 * Supabase Auth + PostgREST) e usa a MESMA camada de dados que roda no
 * navegador (web/src/backend) para exercitar o sistema de ponta a ponta.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createCtx, ApiError } from '../../web/src/backend/core';
import { handle } from '../../web/src/backend/routes';
import { todayISO } from '../../shared/dates';
// @ts-expect-error módulo JS sem tipos
import { startLocalSupabase } from '../../scripts/local-supabase.mjs';

export interface LocalSupabase { url: string; anonKey: string; serviceKey: string; dbUrl: string; stop: () => Promise<void> }

export async function startStack(): Promise<LocalSupabase> {
  return startLocalSupabase({ db: 'rp_test', port: Number(process.env.TEST_SB_PORT ?? 54400) });
}

let sbEnv: LocalSupabase;
export const setStack = (s: LocalSupabase) => { sbEnv = s; };

export async function dbQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: sbEnv.dbUrl });
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}

export class Client {
  today: string | null = null;
  sb = createClient(sbEnv.url, sbEnv.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  ctx = createCtx(this.sb, () => this.today ?? todayISO());

  async req<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<{ status: number; body: T }> {
    try {
      return { status: 200, body: await handle(this.ctx, method, url, body) };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: e.message, details: e.details } as any };
      throw e;
    }
  }

  async ok<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, url, body);
    if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async accessToken() {
    return (await this.sb.auth.getSession()).data.session!.access_token;
  }
}

export async function createAdmin(email: string, password: string) {
  const c = new Client();
  await c.ok('POST', '/api/auth/register', { name: 'Admin Teste', email, password });
  await dbQuery(`select public.make_admin($1)`, [email]);
  return c;
}

/** Chamada crua à API REST do Supabase com o token de um usuário (simula requisição forjada). */
export async function rest(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${sbEnv.url}/rest/v1${path}`, {
    method,
    headers: { apikey: sbEnv.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

export function importFile(name: string) {
  const path = join(process.cwd(), 'data', 'import', name);
  return { filename: name, content: readFileSync(path).toString('base64') };
}

export function createAll(preview: { unknown: { key: string }[] }) {
  return Object.fromEntries(preview.unknown.map((u) => [u.key, { action: 'create' as const }]));
}
