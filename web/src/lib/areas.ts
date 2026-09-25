/** Cor pastel de cada grande área (detalhe visual, nunca informação obrigatória). */
export type Tint = 'rose' | 'lilac' | 'butter' | 'mint' | 'sky' | 'peach';

const KNOWN: [RegExp, Tint][] = [
  [/cl[ií]nica/i, 'lilac'],
  [/cirurg/i, 'sky'],
  [/pediatr/i, 'butter'],
  [/ginec|obstet/i, 'rose'],
  [/prevent|coletiva|social/i, 'mint'],
];

export function tintFor(area?: string | null): Tint {
  if (!area) return 'peach';
  for (const [re, t] of KNOWN) if (re.test(area)) return t;
  return 'peach';
}

/** Rótulo curto da área para o planner: "Clínica Médica" → "Clínica". */
export function areaShort(area?: string | null) {
  if (!area) return '';
  if (/prevent|coletiva/i.test(area)) return 'Preventiva';
  if (/ginec|obstet/i.test(area)) return 'GO';
  if (/cl[ií]nica/i.test(area)) return 'Clínica';
  return area;
}
