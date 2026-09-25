import { describe, expect, it } from 'vitest';
import { assignReviews } from '../../shared/reviewQueue';

const ALL = [0, 1, 2, 3, 4, 5, 6];
const item = (id: string, due: string, score = 0, examDate: string | null = null) => ({ id, due, score, examDate });

describe('reviewqueue_v1', () => {
  it('respeita o limite diário e distribui na ordem de vencimento', () => {
    const r = assignReviews([item('A', '2026-09-28'), item('B', '2026-09-28'), item('C', '2026-09-28'), item('D', '2026-09-28')],
      { today: '2026-09-28', perDay: 2, studyWeekdays: ALL });
    expect([...r.entries()]).toEqual([['A', '2026-09-28'], ['B', '2026-09-28'], ['C', '2026-09-29'], ['D', '2026-09-29']]);
  });

  it('o limite é escolha do aluno', () => {
    const items = ['A', 'B', 'C', 'D'].map((id) => item(id, '2026-09-28'));
    const r = assignReviews(items, { today: '2026-09-28', perDay: 4, studyWeekdays: ALL });
    expect(new Set(r.values())).toEqual(new Set(['2026-09-28']));
  });

  it('revisões feitas hoje ocupam o limite de hoje (adiantadas não duplicam)', () => {
    const r = assignReviews([item('E', '2026-09-29'), item('F', '2026-09-29')], { today: '2026-09-28', perDay: 2, studyWeekdays: ALL, doneToday: 4 });
    expect(r.get('E')).toBe('2026-09-29');
    expect(r.get('F')).toBe('2026-09-29');
  });

  it('atrasadas vêm primeiro; no empate, maior prioridade', () => {
    const r = assignReviews([item('novo', '2026-09-28', 99), item('velho', '2026-09-20', 1), item('mais', '2026-09-28', 50)],
      { today: '2026-09-28', perDay: 2, studyWeekdays: ALL });
    expect(r.get('velho')).toBe('2026-09-28');
    expect(r.get('novo')).toBe('2026-09-28');
    expect(r.get('mais')).toBe('2026-09-29');
  });

  it('pula dias sem estudo e nunca cai no dia da prova', () => {
    // 2026-10-04 é domingo
    const r = assignReviews([item('A', '2026-10-04')], { today: '2026-10-01', perDay: 2, studyWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(r.get('A')).toBe('2026-10-05');
    const items = ['A', 'B', 'C'].map((id) => item(id, '2026-11-23', 0, '2026-11-24'));
    const e = assignReviews(items, { today: '2026-11-20', perDay: 1, studyWeekdays: ALL });
    for (const d of e.values()) expect(d < '2026-11-24').toBe(true);
  });
});
