/**
 * Aplica as migrações SQL em ordem. Deve rodar com um papel dono do banco
 * (MIGRATION_DATABASE_URL, ou DATABASE_URL se ausente).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(connectionString: string, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`create table if not exists public.schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into public.schema_migrations(name) values ($1)', [f]);
        await client.query('commit');
        log(`migração aplicada: ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`falha em ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina MIGRATION_DATABASE_URL ou DATABASE_URL');
    process.exit(1);
  }
  migrate(url).then(() => console.log('ok'), (e) => { console.error(e.message); process.exit(1); });
}
