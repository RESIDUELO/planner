const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x * 100)}%`;
export const num1 = (x: number | null | undefined) => (x == null ? '—' : nf1.format(x));
export const int = (x: number | null | undefined) => (x == null ? '—' : nf0.format(x));
export const money = (x: number | null | undefined) =>
  x == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(x);

export function dateBR(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!d) return '—';
  const iso = d.length === 10 ? `${d}T12:00:00Z` : d;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts }).format(new Date(iso));
}
export const dateTimeBR = (d: string | null | undefined) => dateBR(d, { dateStyle: 'short', timeStyle: 'short' });
export const weekdayShort = (d: string) => dateBR(d, { weekday: 'short' }).replace('.', '');

export function minutes(m: number) {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

export function relativeDays(days: number | null | undefined) {
  if (days == null) return '—';
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export const REG_STATUS: Record<string, string> = {
  not_interested: 'Não tenho interesse',
  want_to: 'Quero fazer',
  pending: 'Inscrição pendente',
  registered: 'Inscrito',
  closed: 'Inscrição encerrada',
  taken: 'Prova realizada',
};

export const WINDOW_LABEL: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Inscrições abertas', tone: 'ok' },
  upcoming: { label: 'Inscrições em breve', tone: 'info' },
  closed: { label: 'Inscrições encerradas', tone: 'neutral' },
  exam_done: { label: 'Prova realizada', tone: 'neutral' },
  unknown: { label: 'Inscrição não informada', tone: 'neutral' },
};

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'late' | 'brand';

export const LEVEL_TONE: Record<string, Tone> = { muito_alta: 'brand', alta: 'info', media: 'neutral', baixa: 'neutral' };

/** Timestamp → dia (YYYY-MM-DD) no fuso de Brasília. */
export const isoBR = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts));
