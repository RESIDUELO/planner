/**
 * Núcleo da camada de dados que roda no navegador e fala direto com o
 * Supabase. As regras de acesso ficam no banco (RLS + funções); aqui só há
 * cálculo (algoritmos de shared/) e orquestração.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import { todayISO, type ISODate } from '../../../shared/dates';

export interface Ctx {
  sb: SupabaseClient;
  /** "Hoje" no fuso de Brasília (injetável nos testes). */
  today: () => ISODate;
}

export function createCtx(sb: SupabaseClient, today: () => ISODate = () => todayISO()): Ctx {
  return { sb, today };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new ApiError(404, `${what} não encontrado.`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, details);
export const forbidden = (msg = 'Acesso negado.') => new ApiError(403, msg);

/** Converte erros do PostgREST/PostgreSQL em mensagens para o usuário. */
export function toApiError(e: any): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) {
    return new ApiError(400, 'Dados inválidos.', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const code: string | undefined = e?.code;
  const msg: string = e?.message ?? 'Erro inesperado.';
  if (code === '42501') {
    const custom = /row-level security|permission denied/i.test(msg) ? 'Operação não permitida para o seu perfil.' : msg;
    return new ApiError(403, custom);
  }
  if (code === '23505') return new ApiError(409, 'Registro duplicado.', e.details);
  if (code === '23503') return new ApiError(409, 'Registro relacionado inexistente ou em uso.', e.details);
  if (code === 'P0002') return new ApiError(404, msg);
  if (code && ['23514', '22023', '22P02', '22007', '22008', '23502'].includes(code)) return new ApiError(400, code === '22023' ? msg : 'Valor inválido.', e.details ?? msg);
  if (code === 'P0001') return new ApiError(400, msg);
  if (code === 'PGRST116') return new ApiError(404, 'Registro não encontrado.');
  // Tabela que ainda não existe no banco (falta rodar a parte nova do schema no Supabase)
  if (code === 'PGRST205' || code === '42P01') return new ApiError(503, 'O banco do site está desatualizado: rode no Supabase o SQL mais recente de supabase/parts/.', msg);
  return new ApiError(e?.status ?? 500, msg);
}

/** Desembrulha {data, error} do supabase-js. */
export async function q<T = any>(p: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toApiError(error);
  return data;
}

export async function rpc<T = any>(ctx: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return q<T>(ctx.sb.rpc(fn, args) as any);
}

/** Lê todas as linhas, paginando (a API do Supabase limita cada resposta a 1000 linhas). */
export async function selectAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows: T[] = (await q<T[]>(build(from, from + page - 1))) ?? [];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

export async function currentUserId(ctx: Ctx): Promise<string> {
  const { data } = await ctx.sb.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ApiError(401, 'Faça login para continuar.');
  return id;
}
