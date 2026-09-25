#!/usr/bin/env node
/**
 * Sobe o ambiente dos testes E2E: build do site em /planner/ (como no GitHub
 * Pages) + Supabase local com as provas de supabase/data/.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { startLocalSupabase } from './local-supabase.mjs';

const port = Number(process.env.E2E_PORT ?? 54500);
execFileSync('npx', ['vite', 'build'], { env: { ...process.env, VITE_BASE: '/planner/' }, stdio: 'ignore' });
const sb = await startLocalSupabase({ db: 'rp_e2e', port, staticDir: 'dist' });
writeFileSync('dist/config.json', JSON.stringify({ supabaseUrl: sb.url, supabaseAnonKey: sb.anonKey }));

// Provas cadastradas como em produção: arquivos SQL gerados em supabase/data/
const c = new pg.Client({ connectionString: sb.dbUrl });
await c.connect();
for (const f of ['famerp_r1', 'uel_r1', 'unoeste_r1']) await c.query(readFileSync(`supabase/data/${f}.sql`, 'utf8'));
await c.end();
console.log(`E2E pronto em ${sb.url}/planner/`);
process.on('SIGTERM', async () => { await sb.stop(); process.exit(0); });
process.on('SIGINT', async () => { await sb.stop(); process.exit(0); });
