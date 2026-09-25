/**
 * Datas do domínio são "dias de calendário" no formato YYYY-MM-DD, sem fuso.
 * A aritmética é feita em UTC para evitar erros de horário de verão.
 */
export type ISODate = string;

const DAY = 86_400_000;

export function toDate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDate(new Date(toDate(d).getTime() + Math.round(n) * DAY));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY);
}

/** 0 = domingo … 6 = sábado */
export function weekday(d: ISODate): number {
  return toDate(d).getUTCDay();
}

export function minDate(...ds: (ISODate | null | undefined)[]): ISODate | null {
  const v = ds.filter(Boolean) as ISODate[];
  return v.length ? v.reduce((a, b) => (a < b ? a : b)) : null;
}

export function maxDate(...ds: (ISODate | null | undefined)[]): ISODate | null {
  const v = ds.filter(Boolean) as ISODate[];
  return v.length ? v.reduce((a, b) => (a > b ? a : b)) : null;
}

/** "Hoje" no fuso de Brasília, que é onde as provas acontecem. */
export function todayISO(now = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
