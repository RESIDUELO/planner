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
for (const f of ['famerp_r1', 'uel_r1', 'unoeste_r1', 'famema_r1', 'santa_casa_aracatuba_r1', 'sus_sp_r1', 'cronograma_medcof_unoeste_v3']) await c.query(readFileSync(`supabase/data/${f}.sql`, 'utf8'));
// Catálogo de residências (cadastrado pela administração), com datas relativas a hoje
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));
const catalogSteps = [
  { id: 'inscricao', key: 'inscricao', label: 'Inscrição', type: 'inscricao', date: day(-2), end: day(9), done: false },
  { id: 'prova', key: 'prova', label: 'Prova', type: 'prova', date: day(50), end: null, done: false },
  { id: 'final', key: 'final', label: 'Resultado final', type: 'resultado', date: null, end: null, done: false },
];
await c.query(`insert into residency_catalog (name, city, fee, specialties, steps) values ('HC Botucatu', 'Botucatu', 450, $1, $2)`,
  [JSON.stringify([{ name: 'Pediatria', vacancies: 6, cutoff: '' }]), JSON.stringify(catalogSteps)]);
// Códigos de acesso para as contas criadas nos testes (tests/e2e/access.ts)
await c.query(`insert into access_tokens (code, note)
  select 'E2E' || g || lpad(n::text, 4, '0'), 'e2e' from unnest(array['APP', 'GES', 'VIE']) g, generate_series(1, 100) n`);
// Administração (gera códigos na tela de Configurações)
const signup = await fetch(`${sb.url}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: sb.anonKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@e2e.test', password: 'senha-admin-123', data: { name: 'Administração' } }),
});
if (!signup.ok) throw new Error(`cadastro do admin E2E: ${signup.status} ${await signup.text()}`);
await c.query(`select public.make_admin('admin@e2e.test')`);
await c.end();
console.log(`E2E pronto em ${sb.url}/planner/`);
process.on('SIGTERM', async () => { await sb.stop(); process.exit(0); });
process.on('SIGINT', async () => { await sb.stop(); process.exit(0); });
