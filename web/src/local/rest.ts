/**
 * PostgREST local: atende as requisições que o supabase-js faria ao servidor,
 * traduzindo-as para SQL no PGlite (PostgreSQL em WebAssembly, dentro do app).
 *
 * Cobre o que a camada de dados (src/backend) usa: select com filtros, order,
 * limit/offset, count, um nível de recurso embutido (ex.: subjects(name)),
 * insert, upsert, update, delete e rpc. O usuário local vai nas "claims" da
 * requisição, como no Supabase, então app.current_user_id() funciona igual.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';

type Tx = Pick<Transaction, 'query'>;
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function ident(name: string) {
  if (!IDENT.test(name)) throw restError(400, 'PGRST100', `Nome inválido: ${name}`);
  return `"${name}"`;
}

class RestError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.message)); }
}
const restError = (status: number, code: string, message: string, details: string | null = null) =>
  new RestError(status, { code, message, details, hint: null });

// ---------------------------------------------------------------- select=...
interface Embed { name: string; cols: string[] }
function parseSelect(raw: string | null): { cols: string[]; embeds: Embed[] } {
  const s = (raw ?? '*').replace(/\s+/g, '');
  const cols: string[] = [];
  const embeds: Embed[] = [];
  let depth = 0, cur = '';
  const push = (part: string) => {
    if (!part) return;
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
    if (m) embeds.push({ name: m[1], cols: m[2] ? m[2].split(',') : ['*'] });
    else cols.push(part);
  };
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { push(cur); cur = ''; } else cur += ch;
  }
  push(cur);
  return { cols: cols.length ? cols : embeds.length ? [] : ['*'], embeds };
}

const colList = (cols: string[], alias?: string) =>
  cols.map((c) => (c === '*' ? (alias ? `${alias}.*` : '*') : `${alias ? alias + '.' : ''}${ident(c)}`)).join(', ');

// ---------------------------------------------------------------- filtros
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

/** Lista "(a,b,"c,d")" do PostgREST. */
function parseList(v: string): string[] {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === '\\' && quoted) { cur += inner[++i] ?? ''; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (inner.length) out.push(cur);
  return out;
}

function buildWhere(params: URLSearchParams, values: unknown[], types: Record<string, string>, alias = ''): string {
  const parts: string[] = [];
  const col = (c: string) => {
    if (!types[c]) throw restError(400, '42703', `Coluna não existe: ${c}`);
    return `${alias}${ident(c)}`;
  };
  // Parâmetros sempre como texto, convertidos para o tipo da coluna
  const param = (c: string, v: unknown) => { values.push(v); return `($${values.length}::text)::${types[c]}`; };
  for (const [key, raw] of params) {
    if (RESERVED.has(key) || key.includes('.')) continue;
    let expr = raw, not = false;
    if (expr.startsWith('not.')) { not = true; expr = expr.slice(4); }
    const dot = expr.indexOf('.');
    const op = expr.slice(0, dot), val = expr.slice(dot + 1);
    let sql: string;
    if (op === 'is') {
      const v = val.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(v)) throw restError(400, 'PGRST100', `is.${val} inválido`);
      sql = `${col(key)} is ${v}`;
    } else if (op === 'in') {
      values.push(parseList(val));
      sql = `${col(key)} = any(($${values.length}::text[])::${types[key]}[])`;
    } else if (OPS[op]) {
      const like = op === 'like' || op === 'ilike';
      if (like) { values.push(val.replace(/\*/g, '%')); sql = `${col(key)}::text ${OPS[op]} $${values.length}::text`; }
      else sql = `${col(key)} ${OPS[op]} ${param(key, val)}`;
    } else throw restError(400, 'PGRST100', `Operador não suportado: ${op}`);
    parts.push(not ? `not (${sql})` : sql);
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

function buildOrder(order: string | null, alias = '') {
  if (!order) return '';
  return 'order by ' + order.split(',').map((term) => {
    const [c, ...mods] = term.split('.');
    const dir = mods.includes('desc') ? 'desc' : 'asc';
    const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
    return `${alias}${ident(c)} ${dir}${nulls}`;
  }).join(', ');
}

// ---------------------------------------------------------------- metadados
const fkCache = new Map<string, { col: string; refCol: string } | null>();
/** Chave estrangeira de `table` para `target` (para o recurso embutido). */
async function foreignKey(tx: Tx, table: string, target: string) {
  const k = `${table}>${target}`;
  if (!fkCache.has(k)) {
    const r = await tx.query<{ col: string; refcol: string }>(`
      select a.attname as col, af.attname as refcol
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
       where c.contype = 'f' and c.conrelid = ('public.' || $1)::regclass and c.confrelid = ('public.' || $2)::regclass
       limit 1`, [table, target]);
    fkCache.set(k, r.rows[0] ? { col: r.rows[0].col, refCol: r.rows[0].refcol } : null);
  }
  const fk = fkCache.get(k);
  if (!fk) throw restError(400, 'PGRST200', `Sem relação entre ${table} e ${target}`);
  return fk;
}

const typeCache = new Map<string, Record<string, string>>();
/** Tipos das colunas de uma tabela ou view. */
async function columnTypes(tx: Tx, table: string) {
  if (!typeCache.has(table)) {
    const r = await tx.query<{ col: string; type: string }>(`
      select attname as col, format_type(atttypid, atttypmod) as type from pg_attribute
       where attrelid = ('public.' || $1)::regclass and attnum > 0 and not attisdropped`, [table]);
    if (!r.rows.length) throw restError(404, '42P01', `Tabela não encontrada: ${table}`);
    typeCache.set(table, Object.fromEntries(r.rows.map((x) => [x.col, x.type])));
  }
  return typeCache.get(table)!;
}

const pkCache = new Map<string, string[]>();
async function primaryKey(tx: Tx, table: string) {
  if (!pkCache.has(table)) {
    const r = await tx.query<{ col: string }>(`
      select a.attname as col from pg_index i
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [table]);
    pkCache.set(table, r.rows.map((x) => x.col));
  }
  return pkCache.get(table)!;
}

interface FnArg { name: string; type: string; array: boolean }
const fnCache = new Map<string, { args: FnArg[]; set: boolean; scalar: boolean }>();
async function fnInfo(tx: Tx, fn: string) {
  if (!fnCache.has(fn)) {
    const r = await tx.query<{ names: string[] | null; types: string[]; retset: boolean; rettype: string }>(`
      select p.proargnames as names,
             array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
             p.proretset as retset, format_type(p.prorettype, null) as rettype
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
    const row = r.rows[0];
    if (!row) throw restError(404, 'PGRST202', `Função não encontrada: ${fn}`);
    const args = row.types.map((type, i) => ({ name: row.names?.[i] ?? `$${i + 1}`, type, array: type.endsWith('[]') }));
    const composite = !/^(void|text|boolean|integer|bigint|numeric|uuid|jsonb|json|date|timestamp with time zone|double precision|real|smallint)$/.test(row.rettype);
    fnCache.set(fn, { args, set: row.retset, scalar: !row.retset && !composite });
  }
  return fnCache.get(fn)!;
}

// ---------------------------------------------------------------- execução
function jsonRows(rows: { j: any }[]) {
  return rows[0]?.j ?? [];
}

async function doSelect(tx: Tx, table: string, url: URL, head: boolean, wantCount: boolean) {
  const p = url.searchParams;
  const { cols, embeds } = parseSelect(p.get('select'));
  const values: unknown[] = [];
  const where = buildWhere(p, values, await columnTypes(tx, table), 't.');
  const embedSql: string[] = [];
  for (const e of embeds) {
    const fk = await foreignKey(tx, table, e.name);
    embedSql.push(`(select row_to_json(e) from (select ${colList(e.cols)} from public.${ident(e.name)} x where x.${ident(fk.refCol)} = t.${ident(fk.col)}) e) as ${ident(e.name)}`);
  }
  const selectList = [cols.length ? colList(cols, 't') : '', ...embedSql].filter(Boolean).join(', ');
  const limit = p.get('limit'), offset = p.get('offset');
  const page = `${limit ? `limit ${Number(limit) | 0}` : ''} ${offset ? `offset ${Number(offset) | 0}` : ''}`;
  let count: number | null = null;
  if (wantCount) {
    const c = await tx.query<{ n: number }>(`select count(*)::int as n from public.${ident(table)} t ${where}`, values);
    count = c.rows[0].n;
  }
  if (head) return { data: null, count };
  const r = await tx.query<{ j: any }>(
    `select coalesce(json_agg(q), '[]'::json) as j from (select ${selectList} from public.${ident(table)} t ${where} ${buildOrder(p.get('order'), 't.')} ${page}) q`, values);
  return { data: jsonRows(r.rows), count };
}

async function doInsert(tx: Tx, table: string, url: URL, body: any, prefer: string) {
  const rows: any[] = Array.isArray(body) ? body : [body];
  if (!rows.length) return [];
  const p = url.searchParams;
  const keys = p.get('columns') ? parseList(`(${p.get('columns')})`) : [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cols = keys.map(ident).join(', ');
  let conflict = '';
  if (prefer.includes('resolution=')) {
    const target = p.get('on_conflict')?.split(',') ?? await primaryKey(tx, table);
    const updates = keys.filter((k) => !target.includes(k));
    conflict = `on conflict (${target.map(ident).join(', ')}) ` + (prefer.includes('ignore-duplicates') || !updates.length
      ? 'do nothing'
      : `do update set ${updates.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`);
  }
  const r = await tx.query<{ j: any }>(
    `with w as (insert into public.${ident(table)} (${cols})
                select ${cols} from json_populate_recordset(null::public.${ident(table)}, $1::json) ${conflict} returning *)
     select coalesce(json_agg(w), '[]'::json) as j from w`, [JSON.stringify(rows)]);
  return jsonRows(r.rows);
}

async function doUpdate(tx: Tx, table: string, url: URL, body: any) {
  const keys = Object.keys(body ?? {});
  if (!keys.length) return [];
  const values: unknown[] = [JSON.stringify(body)];
  const where = buildWhere(url.searchParams, values, await columnTypes(tx, table), 't.');
  const set = keys.map((k) => `${ident(k)} = src.${ident(k)}`).join(', ');
  const r = await tx.query<{ j: any }>(
    `with w as (update public.${ident(table)} as t set ${set}
                from (select * from json_populate_record(null::public.${ident(table)}, $1::json)) src ${where}
                returning t.*)
     select coalesce(json_agg(w), '[]'::json) as j from w`, values);
  return jsonRows(r.rows);
}

async function doDelete(tx: Tx, table: string, url: URL) {
  const values: unknown[] = [];
  const where = buildWhere(url.searchParams, values, await columnTypes(tx, table), 't.');
  const r = await tx.query<{ j: any }>(
    `with w as (delete from public.${ident(table)} as t ${where} returning t.*) select coalesce(json_agg(w), '[]'::json) as j from w`, values);
  return jsonRows(r.rows);
}

async function doRpc(tx: Tx, fn: string, body: any) {
  const info = await fnInfo(tx, fn);
  const args = body ?? {};
  const parts: string[] = [];
  for (const a of info.args) {
    if (!(a.name in args)) continue;
    const v = `($1::json -> '${a.name.replace(/'/g, "''")}')`;
    parts.push(`${ident(a.name)} => ${a.array
      ? `(select array(select json_array_elements_text(${v})))::${a.type}`
      : a.type === 'json' || a.type === 'jsonb' ? `${v}::${a.type}` : `(${v} #>> '{}')::${a.type}`}`);
  }
  const call = `public.${ident(fn)}(${parts.join(', ')})`;
  const sql = info.set
    ? `select coalesce(json_agg(r), '[]'::json) as j from ${call} r`
    : info.scalar ? `select to_json(${call}) as j` : `select to_json(r) as j from ${call} r`;
  const r = await tx.query<{ j: any }>(sql, parts.length ? [JSON.stringify(args)] : []);
  return r.rows[0]?.j ?? null;
}

function claimsFrom(headers: Headers) {
  const token = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  try {
    const payload = token.split('.')[1];
    return JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))));
  } catch { return { role: 'anon' }; }
}

const HTTP_BY_CODE: Record<string, number> = { '23505': 409, '23503': 409, '42501': 403, P0002: 404, '22P02': 400, '23514': 400, '23502': 400 };

/** Atende uma requisição do supabase-js a /rest/v1/... */
export async function handleRest(db: PGlite, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/rest\/v1\//, '');
  const method = req.method.toUpperCase();
  const prefer = req.headers.get('prefer') ?? '';
  const accept = req.headers.get('accept') ?? '';
  const text = method === 'GET' || method === 'HEAD' ? '' : await req.text();
  const body = text ? JSON.parse(text) : undefined;
  const claims = claimsFrom(req.headers);
  try {
    const out = await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify(claims), claims.sub ?? '']);
      if (path.startsWith('rpc/')) return { data: await doRpc(tx, path.slice(4), body), count: null, rpc: true };
      const table = path;
      ident(table);
      if (method === 'GET' || method === 'HEAD') return { ...(await doSelect(tx, table, url, method === 'HEAD', /count=exact/.test(prefer))), rpc: false };
      let data: any;
      if (method === 'POST') data = await doInsert(tx, table, url, body, prefer);
      else if (method === 'PATCH') data = await doUpdate(tx, table, url, body);
      else if (method === 'DELETE') data = await doDelete(tx, table, url);
      else throw restError(405, 'PGRST000', `Método ${method} não suportado`);
      return { data: /return=representation/.test(prefer) ? data : undefined, count: /count=exact/.test(prefer) ? data.length : null, rpc: false };
    });
    const headers = new Headers({ 'content-type': 'application/json' });
    if (out.count != null) headers.set('content-range', `0-${Math.max(0, out.count - 1)}/${out.count}`);
    let data = out.data;
    if (accept.includes('vnd.pgrst.object+json') && Array.isArray(data)) {
      if (data.length !== 1) throw restError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${data.length} rows`);
      data = data[0];
    }
    if (data === undefined || method === 'HEAD') return new Response(null, { status: method === 'POST' ? 201 : 204, headers });
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (e: any) {
    if (e instanceof RestError) return new Response(JSON.stringify(e.body), { status: e.status, headers: { 'content-type': 'application/json' } });
    const code = String(e?.code ?? '');
    return new Response(JSON.stringify({ code, message: e?.message ?? 'Erro no banco local', details: e?.detail ?? null, hint: e?.hint ?? null }),
      { status: HTTP_BY_CODE[code] ?? (code.startsWith('P0') ? 400 : 400), headers: { 'content-type': 'application/json' } });
  }
}
