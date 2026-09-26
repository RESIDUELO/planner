/**
 * Início do app off-line: abre o banco salvo no aparelho (IndexedDB) ou, na
 * primeira vez, carrega o banco pronto que vem dentro do app (local-db.pgdata, um tar.gz,
 * gerado por scripts/build-local-db.mjs com o schema, as provas e o cronograma).
 */
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLocalSupabase } from './client';
// Migrações: partes do schema criadas depois do banco pronto de versões anteriores do app
import agendaSql from '../../../supabase/parts/13_agenda.sql?raw';
import ownSubjectsSql from '../../../supabase/parts/14_own_subjects.sql?raw';
// Fontes dentro do app (sem internet não há Google Fonts)
import '@fontsource/tinos/latin-400.css';
import '@fontsource/tinos/latin-400-italic.css';
import '@fontsource/arimo/latin-400.css';
import '@fontsource/arimo/latin-500.css';
import '@fontsource/arimo/latin-600.css';
import '@fontsource/patrick-hand/latin-400.css';

const DATA_DIR = 'idb://residencia-planner';
const READY_KEY = 'rp-local-db';
/** Versão do schema local; quem instalou uma versão anterior recebe as migrações que faltam. */
export const LOCAL_DB_VERSION = '3';
const MIGRATIONS: Record<string, string> = { '2': agendaSql, '3': ownSubjectsSql };

/** Cliente local e `flush` (grava no disco o que mudou; o app chama uma vez ao fim de cada ação). */
export async function initLocal(): Promise<{ client: SupabaseClient; flush: () => Promise<void> }> {
  let stored: string | null = null;
  try { stored = localStorage.getItem(READY_KEY); } catch { /* sem armazenamento */ }
  const ready = stored != null;
  let db: PGlite;
  // Grava no IndexedDB em segundo plano, sem esperar a cada consulta (bem mais rápido no celular)
  const opts = { relaxedDurability: true };
  if (ready) {
    db = await PGlite.create(DATA_DIR, opts);
    const pending = Object.keys(MIGRATIONS).filter((v) => Number(v) > Number(stored)).sort((a, b) => Number(a) - Number(b));
    for (const v of pending) await db.exec(MIGRATIONS[v]);
    if (pending.length) {
      await (db as any).fs?.syncToFs?.(false);
      try { localStorage.setItem(READY_KEY, LOCAL_DB_VERSION); } catch { /* ignore */ }
    }
  }
  else {
    // Extensão neutra: o Android renomeia arquivos .gz dentro do APK
    const res = await fetch(`${import.meta.env.BASE_URL}local-db.pgdata`);
    if (!res.ok) throw new Error('Banco inicial não encontrado no app.');
    const tarball = new Blob([await res.arrayBuffer()], { type: 'application/x-gzip' });
    db = await PGlite.create(DATA_DIR, { ...opts, loadDataDir: tarball });
    try { localStorage.setItem(READY_KEY, LOCAL_DB_VERSION); } catch { /* ignore */ }
  }
  // O banco roda na memória e é gravado no disco (IndexedDB) ao fim de cada ação (lib/api.ts),
  // numa gravação só mesmo com várias ações seguidas, e sempre ao sair do app.
  const syncFs = () => ((db as any).fs?.syncToFs?.(false) as Promise<void> | undefined) ?? Promise.resolve();
  let running: Promise<void> | null = null;
  let dirty = false;
  const flush = (): Promise<void> => {
    if (running) { dirty = true; return running; }
    running = syncFs().catch(() => {}).then(() => {
      running = null;
      if (dirty) { dirty = false; return flush(); }
    });
    return running;
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', () => { flush(); });
  return { client: createLocalSupabase(db), flush };
}
