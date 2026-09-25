import pg from 'pg';

// Datas (DATE) voltam como string YYYY-MM-DD, sem conversão de fuso.
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC → number (os valores do domínio cabem com folga em double)
pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v == null ? null : Number(v)));

export type Db = pg.PoolClient;

let pool: pg.Pool | null = null;

export function initPool(connectionString: string): pg.Pool {
  pool = new pg.Pool({ connectionString, max: 10 });
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('pool não inicializado');
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = null;
}

/**
 * Executa `fn` numa transação com o papel restrito `rp_app` e o contexto da
 * sessão. As policies de RLS decidem o que pode ser lido/escrito.
 */
export async function tx<T>(sessionHash: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('set local role rp_app');
    await client.query("select set_config('app.session', $1, true)", [sessionHash ?? '']);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
