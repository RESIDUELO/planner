#!/usr/bin/env node
/**
 * "Supabase local" para desenvolvimento e testes, sem Docker:
 *   PostgreSQL (existente) + Supabase Auth (GoTrue) + PostgREST + proxy
 *   no mesmo formato de URL do Supabase (/auth/v1, /rest/v1).
 *
 * Uso:
 *   node scripts/local-supabase.mjs            # recria o banco e sobe tudo na porta 54321
 *   PG_ADMIN_URL=postgres://user:pass@localhost:5432/postgres  (padrão: rp_owner local)
 *   LOCAL_SB_DB=rp_local  LOCAL_SB_PORT=54321  LOCAL_SB_STATIC=dist (serve o site em /planner/)
 *
 * Não é usado em produção: lá o projeto Supabase real faz esse papel.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.local-supabase');
const GOTRUE_VERSION = 'v2.180.0';
const POSTGREST_VERSION = 'v12.2.3';
export const JWT_SECRET = 'local-dev-secret-with-at-least-32-characters!!';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export const ANON_KEY = signJwt({ role: 'anon', iss: 'supabase', iat: 1700000000, exp: 4102444800 });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'supabase', iat: 1700000000, exp: 4102444800 });

function ensureBinaries() {
  mkdirSync(cache, { recursive: true });
  const gotrue = join(cache, 'gotrue', 'auth');
  if (!existsSync(gotrue)) {
    mkdirSync(join(cache, 'gotrue'), { recursive: true });
    execFileSync('bash', ['-c', `curl -sSL https://github.com/supabase/auth/releases/download/${GOTRUE_VERSION}/auth-${GOTRUE_VERSION}-x86.tar.gz | tar xz -C "${join(cache, 'gotrue')}"`]);
  }
  const postgrest = join(cache, 'postgrest');
  if (!existsSync(postgrest)) {
    execFileSync('bash', ['-c', `curl -sSL https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz | tar xJ -C "${cache}"`]);
  }
  return { gotrue, postgrest, migrations: join(cache, 'gotrue', 'migrations') };
}

async function sql(url, text) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query(text); } finally { await c.end(); }
}

function waitFor(url, ms = 30000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (r) => { r.resume(); resolve(); }).on('error', () => {
        if (Date.now() > until) reject(new Error(`timeout: ${url}`));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function startLocalSupabase(opts = {}) {
  const adminUrl = opts.adminUrl ?? process.env.PG_ADMIN_URL ?? 'postgres://rp_owner:rp_owner@localhost:5432/postgres';
  const db = opts.db ?? process.env.LOCAL_SB_DB ?? 'rp_local';
  const port = Number(opts.port ?? process.env.LOCAL_SB_PORT ?? 54321);
  const staticDir = opts.staticDir ?? process.env.LOCAL_SB_STATIC ?? null;
  const gotruePort = port + 1, postgrestPort = port + 2;
  const bins = ensureBinaries();

  // 1) Banco novo com os papéis do Supabase
  const u = new URL(adminUrl);
  await sql(adminUrl, `drop database if exists ${db} with (force)`);
  await sql(adminUrl, `create database ${db}`);
  u.pathname = `/${db}`;
  const dbUrl = u.toString();
  await sql(dbUrl, readFileSync(join(root, 'supabase/local/bootstrap.sql'), 'utf8'));
  const host = `${u.hostname}:${u.port || 5432}`;

  // 2) Supabase Auth: migrações + servidor
  const gotrueEnv = {
    ...process.env,
    GOTRUE_DB_DRIVER: 'postgres',
    DATABASE_URL: `postgres://supabase_auth_admin:auth_admin@${host}/${db}`,
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:auth_admin@${host}/${db}`,
    GOTRUE_DB_MIGRATIONS_PATH: bins.migrations,
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: String(gotruePort),
    API_EXTERNAL_URL: `http://localhost:${port}/auth/v1`,
    GOTRUE_SITE_URL: `http://localhost:${port}`,
    GOTRUE_JWT_SECRET: JWT_SECRET,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'true',
    GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS: '10000',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '10000',
    GOTRUE_RATE_LIMIT_VERIFY: '10000',
    GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS: '10000',
    GOTRUE_LOG_LEVEL: 'error',
  };
  execFileSync(bins.gotrue, ['migrate'], { env: gotrueEnv, stdio: 'pipe', cwd: cache });

  // 3) Schema do app (o mesmo arquivo que vai para o SQL Editor)
  execFileSync(process.execPath, [join(root, 'supabase/build-schema.mjs')], { stdio: 'pipe' });
  await sql(dbUrl, readFileSync(join(root, 'supabase/schema.sql'), 'utf8'));

  const procs = [];
  const run = (bin, args, env) => {
    const p = spawn(bin, args, { env, cwd: cache, stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => process.env.LOCAL_SB_DEBUG && process.stderr.write(d));
    procs.push(p);
    return p;
  };
  run(bins.gotrue, ['serve'], gotrueEnv);
  run(bins.postgrest, [], {
    ...process.env,
    PGRST_DB_URI: `postgres://authenticator:authenticator@${host}/${db}`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(postgrestPort),
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_DB_MAX_ROWS: '1000', // mesmo limite padrão do Supabase
    PGRST_LOG_LEVEL: 'crit',
  });

  // 4) Proxy no formato do Supabase (+ site estático opcional em /planner/)
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Supabase-Api-Version');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const target = req.url.startsWith('/auth/v1') ? { port: gotruePort, path: req.url.slice(8) || '/' }
      : req.url.startsWith('/rest/v1') ? { port: postgrestPort, path: req.url.slice(8) || '/' } : null;
    if (target) {
      const up = http.request({ host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target.port}` } }, (r) => {
        const headers = { ...r.headers };
        delete headers['access-control-allow-origin'];
        res.writeHead(r.statusCode ?? 502, headers);
        r.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      return req.pipe(up);
    }
    if (staticDir && req.url.startsWith('/planner')) {
      const rel = normalize(decodeURIComponent(req.url.split('?')[0]).slice('/planner'.length)).replace(/^([/\\])+/, '');
      let file = join(root, staticDir, rel);
      if (!file.startsWith(join(root, staticDir)) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, staticDir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      return createReadStream(file).pipe(res);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  await waitFor(`http://127.0.0.1:${gotruePort}/health`);
  await waitFor(`http://127.0.0.1:${postgrestPort}/`);

  const url = `http://localhost:${port}`;
  const env = { url, anonKey: ANON_KEY, serviceKey: SERVICE_KEY, dbUrl };
  writeFileSync(join(cache, 'env.json'), JSON.stringify(env, null, 2));
  const stop = async () => {
    for (const p of procs) p.kill('SIGTERM');
    await new Promise((r) => server.close(r));
  };
  return { ...env, stop };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sb = await startLocalSupabase();
  console.log(`Supabase local em ${sb.url}\n  anon key: ${sb.anonKey}\n  banco: ${sb.dbUrl}`);
  const bye = async () => { await sb.stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
