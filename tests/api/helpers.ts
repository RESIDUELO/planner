import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app';
import { initPool, closePool } from '../../server/db';
import { migrate } from '../../db/migrate';

export const OWNER_URL = process.env.TEST_DATABASE_URL ?? 'postgres://rp_owner:rp_owner@localhost:5432/residencia_planner_test';

export async function resetDatabase() {
  const u = new URL(OWNER_URL);
  const dbName = u.pathname.slice(1);
  u.pathname = '/postgres';
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`drop database if exists ${dbName} with (force)`);
  await c.query(`create database ${dbName}`);
  await c.end();
  await migrate(OWNER_URL, () => {});
}

export async function startApp(): Promise<FastifyInstance> {
  process.env.ALLOW_TIME_TRAVEL = 'true';
  initPool(OWNER_URL);
  return buildApp();
}

export async function stopApp(app: FastifyInstance) {
  await app.close();
  await closePool();
}

export async function ownerQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

export async function createAdmin(email: string, password: string) {
  const r = await ownerQuery(`select auth.register($1, $2, 'Admin Teste') as id`, [email, password]);
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  await c.query('begin');
  await c.query(`select set_config('app.bypass_profile_guard', 'on', true)`);
  await c.query(`update public.user_profiles set role = 'admin' where user_id = $1`, [r.rows[0].id]);
  await c.query('commit');
  await c.end();
  return r.rows[0].id as string;
}

export class Client {
  cookie = '';
  today: string | null = null;
  constructor(private app: FastifyInstance) {}

  async req<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { 'x-requested-with': 'residencia-planner' };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.today) headers['x-debug-today'] = this.today;
    const res = await this.app.inject({ method, url, headers, payload: body as any });
    const set = res.headers['set-cookie'];
    if (set) {
      const first = (Array.isArray(set) ? set : [set])[0];
      this.cookie = first.split(';')[0];
    }
    let parsed: any = res.body;
    try { parsed = JSON.parse(res.body); } catch { /* texto */ }
    return { status: res.statusCode, body: parsed };
  }

  async ok<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, url, body);
    if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export function importFile(name: string) {
  const path = join(process.cwd(), 'data', 'import', name);
  return { filename: name, content: readFileSync(path).toString('base64') };
}

/** Decide "criar" para todos os itens desconhecidos (simula a confirmação do admin). */
export function createAll(preview: { unknown: { key: string }[] }) {
  return Object.fromEntries(preview.unknown.map((u) => [u.key, { action: 'create' as const }]));
}
