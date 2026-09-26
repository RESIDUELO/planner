/**
 * Residências: etapas padrão, situação de cada uma ("inscrições abertas ·
 * fecham em 5 dias"...), próximo prazo e as datas que vão para a Agenda.
 * Funções puras, usadas pelo backend e pelas telas.
 */
import { diffDays, type ISODate } from './dates';

export type StepType = 'inscricao' | 'prova' | 'resultado';
export type StepKey = 'edital' | 'reducao' | 'inscricao' | 'boleto' | 'local' | 'prova' | 'gabarito' | 'recurso' | 'resultado1' | 'fase2' | 'final' | 'custom';

export interface Step {
  id: string;
  key: StepKey;
  label: string;
  type: StepType;
  /** Dia da etapa (início, quando é um período). Vazio = "a divulgar". */
  date: ISODate | null;
  /** Fim do período (inscrição, pedido de redução). */
  end: ISODate | null;
  done: boolean;
}

export interface Specialty { name: string; vacancies: number | null; cutoff: string }
export interface Institution { name: string; city: string; specialties: Specialty[] }

export interface Residency {
  id: string;
  name: string;
  city: string;
  editalUrl: string;
  specialties: Specialty[];
  institutions: Institution[];
  fee: number | null;
  reductionRequested: boolean;
  reductionGranted: boolean | null;
  paid: boolean;
  decision: 'yes' | 'maybe' | 'no';
  enrolled: boolean;
  notes: string;
  steps: Step[];
  examEditionId: string | null;
  createdAt: string;
}

export const STEP_TYPES: Record<StepType, string> = { inscricao: 'Inscrição', prova: 'Prova', resultado: 'Resultado' };

/** Etapas que são um período (início e fim). */
export const RANGE_KEYS: StepKey[] = ['reducao', 'inscricao'];

export const DEFAULT_STEPS: { key: StepKey; label: string; type: StepType }[] = [
  { key: 'edital', label: 'Edital publicado', type: 'inscricao' },
  { key: 'reducao', label: 'Pedido de redução da taxa', type: 'inscricao' },
  { key: 'inscricao', label: 'Inscrição', type: 'inscricao' },
  { key: 'boleto', label: 'Pagamento do boleto', type: 'inscricao' },
  { key: 'local', label: 'Local de prova divulgado', type: 'prova' },
  { key: 'prova', label: 'Prova', type: 'prova' },
  { key: 'gabarito', label: 'Gabarito', type: 'prova' },
  { key: 'recurso', label: 'Prazo de recurso', type: 'prova' },
  { key: 'resultado1', label: 'Resultado da 1ª fase', type: 'resultado' },
  { key: 'fase2', label: '2ª fase (currículo/entrevista)', type: 'resultado' },
  { key: 'final', label: 'Resultado final', type: 'resultado' },
];

export function defaultSteps(): Step[] {
  return DEFAULT_STEPS.map((s) => ({ ...s, id: s.key, date: null, end: null, done: false }));
}

export const stepOf = (r: Pick<Residency, 'steps'>, key: StepKey) => r.steps.find((s) => s.key === key);

/** "hoje", "amanhã", "em 5 dias". */
export function inDays(n: number) {
  return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`;
}

/** Um dia marcado de uma etapa (um período vira dois: início e fim). */
export interface ResidencyEvent {
  residencyId: string;
  residency: string;
  stepId: string;
  key: StepKey;
  type: StepType;
  date: ISODate;
  edge: 'start' | 'end' | null;
  /** "fim da inscrição" */
  label: string;
  done: boolean;
}

function eventLabel(s: Step, edge: 'start' | 'end' | null) {
  if (s.key === 'inscricao') return edge === 'end' ? 'fim da inscrição' : 'início da inscrição';
  if (s.key === 'reducao') return edge === 'end' ? 'fim do pedido de redução' : 'início do pedido de redução';
  return s.label.charAt(0).toLowerCase() + s.label.slice(1);
}

export function residencyEvents(r: Pick<Residency, 'id' | 'name' | 'steps'>): ResidencyEvent[] {
  const out: ResidencyEvent[] = [];
  for (const s of r.steps) {
    const base = { residencyId: r.id, residency: r.name, stepId: s.id, key: s.key, type: s.type, done: s.done };
    const range = RANGE_KEYS.includes(s.key);
    if (s.date) out.push({ ...base, date: s.date, edge: range ? 'start' : null, label: eventLabel(s, range ? 'start' : null) });
    if (range && s.end) out.push({ ...base, date: s.end, edge: 'end', label: eventLabel(s, 'end') });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Próximo prazo em aberto (de hoje em diante, etapa não marcada como feita). */
export function nextEvent(r: Pick<Residency, 'id' | 'name' | 'steps'>, today: ISODate): ResidencyEvent | null {
  return residencyEvents(r).find((e) => !e.done && e.date >= today) ?? null;
}

/** "Inscrição FAMEMA termina em 3 dias". */
export function deadlineText(e: ResidencyEvent, today: ISODate) {
  const n = e.residency;
  const when = inDays(diffDays(e.date, today));
  const phrase: Partial<Record<StepKey, string>> = {
    inscricao: e.edge === 'end' ? `Inscrição ${n} termina` : `Inscrição ${n} abre`,
    reducao: e.edge === 'end' ? `Pedido de redução ${n} termina` : `Pedido de redução ${n} abre`,
    edital: `Edital ${n} sai`,
    boleto: `Boleto ${n} vence`,
    local: `Local de prova ${n} sai`,
    prova: `Prova ${n}`,
    gabarito: `Gabarito ${n} sai`,
    recurso: `Prazo de recurso ${n} termina`,
    resultado1: `Resultado da 1ª fase ${n} sai`,
    fase2: `2ª fase ${n}`,
    final: `Resultado final ${n} sai`,
  };
  return `${phrase[e.key] ?? `${n} - ${e.label}`} ${when}`;
}

export type StatusTone = 'open' | 'enrolled' | 'exam' | 'result' | 'muted';

/** Selo de situação do cartão. */
export function residencyStatus(r: Pick<Residency, 'decision' | 'enrolled' | 'steps'>, today: ISODate): { label: string; tone: StatusTone } {
  if (r.decision === 'no') return { label: 'não vou', tone: 'muted' };
  if (r.steps.some((s) => s.type === 'resultado' && s.key !== 'fase2' && s.done)) return { label: 'resultado saiu', tone: 'result' };
  const prova = stepOf(r, 'prova')?.date ?? null;
  if (prova && prova < today) return { label: 'aguardando resultado', tone: 'muted' };
  if (r.enrolled) {
    if (prova && diffDays(prova, today) <= 30) return { label: diffDays(prova, today) === 0 ? 'prova hoje' : `prova ${inDays(diffDays(prova, today))}`, tone: 'exam' };
    return { label: 'inscrito', tone: 'enrolled' };
  }
  const insc = stepOf(r, 'inscricao');
  if (insc?.date && insc.date > today) return { label: `inscrições abrem ${inDays(diffDays(insc.date, today))}`, tone: 'muted' };
  if (insc?.end && insc.end < today) return { label: 'inscrições encerradas', tone: 'muted' };
  if (insc?.date || insc?.end) {
    if (!insc.end) return { label: 'inscrições abertas', tone: 'open' };
    const n = diffDays(insc.end, today);
    return { label: `inscrições abertas · ${n === 0 ? 'fecham hoje' : `fecham ${inDays(n)}`}`, tone: 'open' };
  }
  if (stepOf(r, 'edital')?.done) return { label: 'edital publicado', tone: 'muted' };
  return { label: 'aguardando edital', tone: 'muted' };
}

/** Ordem da lista: pelo próximo prazo; as de "não vou" no fim. */
export function sortResidencies<T extends Residency>(list: T[], today: ISODate): T[] {
  const key = (r: T) => nextEvent(r, today)?.date ?? '9999-12-31';
  return [...list].sort((a, b) => Number(a.decision === 'no') - Number(b.decision === 'no') || key(a).localeCompare(key(b)) || a.name.localeCompare(b.name, 'pt-BR'));
}
