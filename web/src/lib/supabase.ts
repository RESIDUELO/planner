import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCtx, type Ctx } from '../backend/core';
import { IS_LOCAL } from './platform';

export interface AppConfig { supabaseUrl: string; supabaseAnonKey: string }

let ctx: Ctx | null = null;

/** Lê config.json (publicado junto com o site) e cria o cliente do Supabase. */
export async function initSupabase(): Promise<AppConfig | null> {
  if (IS_LOCAL) {
    // App off-line: banco PostgreSQL dentro do aparelho (carregado só no build do app)
    const { initLocal } = await import('../local/app');
    ctx = createCtx(await initLocal());
    return { supabaseUrl: 'local', supabaseAnonKey: 'local' };
  }
  try {
    // config.local.json (fora do git) permite apontar o `npm run dev` para o Supabase local
    let res = await fetch(`${import.meta.env.BASE_URL}config.local.json`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok || !res.headers.get('content-type')?.includes('json')) res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = (await res.json()) as AppConfig;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('SEU-PROJETO')) return null;
    const sb: SupabaseClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'residencia-planner-auth' },
    });
    ctx = createCtx(sb);
    return cfg;
  } catch {
    return null;
  }
}

export function getCtx(): Ctx {
  if (!ctx) throw new Error('Supabase não configurado');
  return ctx;
}
