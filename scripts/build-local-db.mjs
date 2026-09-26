/**
 * Gera o banco pronto do app off-line: schema + provas + cronograma + usuário
 * local, compactado (tar.gz) em <outDir>/local-db.pgdata (carregado na 1ª abertura;
 * extensão neutra porque o Android renomeia arquivos .gz dentro do APK).
 *
 * Uso: node scripts/build-local-db.mjs dist-app
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = process.argv[2] ?? 'dist-app';
// Node 22.18+ executa TypeScript simples direto (sem tipos em tempo de execução)
const { bootstrap, orderDataFiles } = await import('../web/src/local/bootstrap.ts');

const db = new PGlite();
const files = orderDataFiles(readdirSync('supabase/data').filter((f) => f.endsWith('.sql')));
await bootstrap(db, readFileSync('supabase/schema.sql', 'utf8'), files.map((f) => readFileSync(`supabase/data/${f}`, 'utf8')));
await db.exec('vacuum full');
await db.exec('checkpoint');
const dump = await db.dumpDataDir('gzip');
const buf = Buffer.from(await dump.arrayBuffer());
writeFileSync(resolve(outDir, 'local-db.pgdata'), buf);
console.log(`local-db.pgdata: ${(buf.length / 1024 / 1024).toFixed(1)} MB (${files.join(', ')})`);
await db.close();
