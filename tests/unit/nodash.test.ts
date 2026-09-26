import { describe, expect, it } from 'vitest';
import { noDash } from '../../web/src/lib/api';

describe('noDash', () => {
  it('troca o travessão por hífen em qualquer texto da resposta', () => {
    expect(noDash({ name: 'Meu cronograma MEDCOF — UNOESTE/HRPP', list: ['a—b', 3, null], nested: { x: '—' } }))
      .toEqual({ name: 'Meu cronograma MEDCOF - UNOESTE/HRPP', list: ['a-b', 3, null], nested: { x: '-' } });
  });
});
