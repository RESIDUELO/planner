// Junta supabase/parts/*.sql em supabase/schema.sql (o arquivo que vai no SQL Editor).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const parts = readdirSync(join(dir, 'parts')).filter((f) => f.endsWith('.sql')).sort();
const header = `-- =====================================================================
-- Residência Planner — schema completo para o Supabase
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo → Run.
-- Rode UMA vez num projeto novo. Gerado por supabase/build-schema.mjs a
-- partir de supabase/parts/ (não edite este arquivo à mão).
-- =====================================================================

`;
const body = parts.map((f) => `-- >>> ${f}\n` + readFileSync(join(dir, 'parts', f), 'utf8')).join('\n\n');
writeFileSync(join(dir, 'schema.sql'), header + body);
console.log(`supabase/schema.sql gerado (${parts.join(', ')})`);
