import { describe, expect, it } from 'vitest';
import { toApiError } from '../../web/src/backend/core';

describe('toApiError', () => {
  it('tabela ausente no banco vira 503 com instrução de rodar o SQL', () => {
    for (const code of ['PGRST205', '42P01']) {
      const e = toApiError({ code, message: "Could not find the table 'public.agenda_notes' in the schema cache" });
      expect(e.status).toBe(503);
      expect(e.message).toMatch(/supabase\/parts/);
    }
  });
});
