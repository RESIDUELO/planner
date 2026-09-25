#!/usr/bin/env node
/**
 * Sobe o ambiente dos testes E2E: build do site em /planner/ (como no GitHub
 * Pages) + Supabase local vazio com um administrador.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { startLocalSupabase } from './local-supabase.mjs';

const port = Number(process.env.E2E_PORT ?? 54500);
execFileSync('npx', ['vite', 'build'], { env: { ...process.env, VITE_BASE: '/planner/' }, stdio: 'ignore' });
const sb = await startLocalSupabase({ db: 'rp_e2e', port, staticDir: 'dist' });
writeFileSync('dist/config.json', JSON.stringify({ supabaseUrl: sb.url, supabaseAnonKey: sb.anonKey }));

const r = await fetch(`${sb.url}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: sb.anonKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@e2e.test', password: 'admin-e2e-123', data: { name: 'Admin E2E' } }),
});
if (!r.ok) throw new Error(await r.text());
const c = new pg.Client({ connectionString: sb.dbUrl });
await c.connect();
await c.query(`select public.make_admin('admin@e2e.test')`);
await c.end();
console.log(`E2E pronto em ${sb.url}/planner/`);
process.on('SIGTERM', async () => { await sb.stop(); process.exit(0); });
process.on('SIGINT', async () => { await sb.stop(); process.exit(0); });
