/**
 * Cria (ou promove) um administrador. Roda com o papel dono do banco, fora da API.
 *   npm run admin:create -- --email admin@exemplo.com --name "Admin" --password "senha-forte"
 */
import pg from 'pg';
import { loadEnv } from '../server/env';

loadEnv();
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => {
  const [k, ...v] = s.trim().split(' ');
  return [k, v.join(' ').replace(/^"|"$/g, '')];
}));
if (!args.email) {
  console.error('Uso: npm run admin:create -- --email EMAIL --name NOME --password SENHA');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  const existing = await client.query('select id from auth.users where email = $1', [args.email]);
  let id: string;
  if (existing.rowCount) {
    id = existing.rows[0].id;
    console.log('Usuário existente — promovendo a administrador.');
  } else {
    if (!args.password || args.password.length < 8) throw new Error('Informe --password com pelo menos 8 caracteres.');
    id = (await client.query('select auth.register($1, $2, $3) as id', [args.email, args.password, args.name || 'Administrador'])).rows[0].id;
  }
  await client.query("select set_config('app.bypass_profile_guard', 'on', true)");
  await client.query(`update public.user_profiles set role = 'admin', active = true where user_id = $1`, [id]);
  await client.query('commit');
  console.log(`Administrador pronto: ${args.email}`);
} catch (e) {
  await client.query('rollback');
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
