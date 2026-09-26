/**
 * As telas continuam chamando api.get('/api/...'). Esses caminhos são
 * atendidos no próprio navegador (src/backend/routes.ts), que fala direto com
 * o Supabase — não há servidor próprio.
 */
import { ApiError } from '../backend/core';
import { handle } from '../backend/routes';
import { afterMutation, getCtx } from './supabase';

export { ApiError };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = (await handle(getCtx(), method, url, body)) as T;
  // App off-line: a ação só termina depois de gravada no disco (a tela já marcou na hora)
  if (method !== 'GET') await afterMutation();
  return r;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as any;
    if (Array.isArray(d) && d[0]?.message) return `${e.message} ${d.map((x: any) => `${x.path ? x.path + ': ' : ''}${x.message}`).join('; ')}`;
    return e.message;
  }
  return (e as Error)?.message ?? 'Erro inesperado.';
}
