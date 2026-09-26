import { describe, expect, it } from 'vitest';
import { deadlineText, defaultSteps, nextEvent, residencyEvents, residencyStatus, sortResidencies, type Residency, type Step } from '../../shared/residency';

const today = '2026-09-26';
function res(p: Partial<Residency> & { dates?: Partial<Record<Step['key'], (string | null)[]>> } = {}): Residency {
  const steps = defaultSteps().map((s) => {
    const d = p.dates?.[s.key];
    return d ? { ...s, date: d[0], end: d[1] ?? null } : s;
  });
  return {
    id: p.name ?? 'x', name: 'FAMEMA', city: '', editalUrl: '', specialties: [], institutions: [], fee: null, reductionRequested: false,
    reductionGranted: null, paid: false, decision: 'yes', enrolled: false, notes: '', steps, examEditionId: null, createdAt: '', ...p,
  };
}

describe('residências', () => {
  it('etapas padrão: 11, a divulgar', () => {
    const s = defaultSteps();
    expect(s).toHaveLength(11);
    expect(s.every((x) => x.date === null && !x.done)).toBe(true);
  });

  it('período vira duas datas na agenda', () => {
    const r = res({ dates: { inscricao: ['2026-09-10', '2026-10-27'], prova: ['2026-12-08'] } });
    expect(residencyEvents(r).map((e) => `${e.date} ${e.label}`)).toEqual([
      '2026-09-10 início da inscrição', '2026-10-27 fim da inscrição', '2026-12-08 prova',
    ]);
  });

  it('próximo prazo ignora o que passou e o que está feito', () => {
    const r = res({ dates: { inscricao: ['2026-09-10', '2026-09-29'], prova: ['2026-12-08'] } });
    const e = nextEvent(r, today)!;
    expect(e.label).toBe('fim da inscrição');
    expect(deadlineText(e, today)).toBe('Inscrição FAMEMA termina em 3 dias');
    r.steps = r.steps.map((s) => (s.key === 'inscricao' ? { ...s, done: true } : s));
    expect(nextEvent(r, today)!.key).toBe('prova');
    expect(deadlineText(nextEvent(r, '2026-12-07')!, '2026-12-07')).toBe('Prova FAMEMA amanhã');
  });

  it('selo de situação', () => {
    expect(residencyStatus(res(), today).label).toBe('aguardando edital');
    expect(residencyStatus(res({ dates: { inscricao: ['2026-09-10', '2026-10-01'] } }), today).label).toBe('inscrições abertas · fecham em 5 dias');
    expect(residencyStatus(res({ dates: { inscricao: ['2026-09-10', '2026-09-26'] } }), today).label).toBe('inscrições abertas · fecham hoje');
    expect(residencyStatus(res({ dates: { inscricao: ['2026-10-07', '2026-10-26'] } }), today).label).toBe('inscrições abrem em 11 dias');
    expect(residencyStatus(res({ enrolled: true, dates: { prova: ['2026-12-08'] } }), today).label).toBe('inscrito');
    expect(residencyStatus(res({ enrolled: true, dates: { prova: ['2026-10-06'] } }), today).label).toBe('prova em 10 dias');
    expect(residencyStatus(res({ dates: { prova: ['2026-09-01'] } }), today).label).toBe('aguardando resultado');
    const done = res();
    done.steps = done.steps.map((s) => (s.key === 'final' ? { ...s, done: true } : s));
    expect(residencyStatus(done, today).label).toBe('resultado saiu');
    expect(residencyStatus(res({ decision: 'no' }), today).label).toBe('não vou');
  });

  it('ordem: próximo prazo primeiro, "não vou" no fim', () => {
    const a = res({ id: 'a', name: 'A', dates: { prova: ['2026-12-14'] } });
    const b = res({ id: 'b', name: 'B', dates: { prova: ['2026-12-05'] } });
    const c = res({ id: 'c', name: 'C', decision: 'no', dates: { prova: ['2026-10-01'] } });
    const d = res({ id: 'd', name: 'D' });
    expect(sortResidencies([a, c, d, b], today).map((r) => r.name)).toEqual(['B', 'A', 'D', 'C']);
  });
});
