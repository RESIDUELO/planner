/**
 * Início do app off-line: abre o banco salvo no aparelho (IndexedDB) ou, na
 * primeira vez, carrega o banco pronto que vem dentro do app (local-db.tar.gz,
 * gerado por scripts/build-local-db.mjs com o schema, as provas e o cronograma).
 */
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLocalSupabase } from './client';
// Fontes dentro do app (sem internet não há Google Fonts)
import '@fontsource/tinos/latin-400.css';
import '@fontsource/tinos/latin-400-italic.css';
import '@fontsource/arimo/latin-400.css';
import '@fontsource/arimo/latin-500.css';
import '@fontsource/arimo/latin-600.css';
import '@fontsource/patrick-hand/latin-400.css';

const DATA_DIR = 'idb://residencia-planner';
const READY_KEY = 'rp-local-db';
/** Versão do banco pronto; ao mudar o schema, o app precisará migrar os dados. */
export const LOCAL_DB_VERSION = '1';

export async function initLocal(): Promise<SupabaseClient> {
  let ready = false;
  try { ready = localStorage.getItem(READY_KEY) != null; } catch { /* sem armazenamento */ }
  let db: PGlite;
  if (ready) db = await PGlite.create(DATA_DIR);
  else {
    const res = await fetch(`${import.meta.env.BASE_URL}local-db.tar.gz`);
    if (!res.ok) throw new Error('Banco inicial não encontrado no app.');
    db = await PGlite.create(DATA_DIR, { loadDataDir: await res.blob() });
    try { localStorage.setItem(READY_KEY, LOCAL_DB_VERSION); } catch { /* ignore */ }
  }
  return createLocalSupabase(db);
}
