import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../../shared/dates';
import { adjustDueDate, projectReviews, retrievability, review, targetRetention } from '../../shared/memory';

describe('fsrs_v1', () => {
  it('R = 90% quando o tempo decorrido é igual à estabilidade', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9);
    expect(retrievability(0, 10)).toBe(1);
  });

  it('intervalos crescem com revisões bem-sucedidas', () => {
    const exam = '2027-06-01';
    let r = review(null, 'good', '2026-10-01', exam);
    const intervals = [r.intervalDays];
    for (let i = 0; i < 4; i++) {
      r = review(r.state, 'good', r.nextReview!, exam);
      intervals.push(r.intervalDays);
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
  });

  it('"Again" encurta o intervalo e aumenta a dificuldade', () => {
    const exam = '2027-06-01';
    const a = review(null, 'good', '2026-10-01', exam);
    const b = review(a.state, 'good', a.nextReview!, exam);
    const good = review(b.state, 'good', b.nextReview!, exam);
    const again = review(b.state, 'again', b.nextReview!, exam);
    expect(again.intervalDays).toBeLessThan(good.intervalDays);
    expect(again.intervalDays).toBeLessThanOrEqual(2);
    expect(again.state.difficulty).toBeGreaterThan(b.state.difficulty);
    expect(again.state.lapses).toBe(1);
  });

  it('revisões ficam mais frequentes perto da prova', () => {
    const start = '2026-10-01';
    const far = review(null, 'good', start, addDays(start, 180));
    const near = review(null, 'good', start, addDays(start, 30));
    // mesma estabilidade, mas intervalo menor com prova próxima
    const f2 = review(far.state, 'good', addDays(start, 10), addDays(start, 180));
    const n2 = review(near.state, 'good', addDays(start, 10), addDays(start, 30));
    expect(n2.intervalDays).toBeLessThan(f2.intervalDays);
    expect(targetRetention(5)).toBeGreaterThan(targetRetention(200));
  });

  it('nunca agenda revisão no dia da prova ou depois', () => {
    const exam = '2026-11-12';
    let r = review(null, 'easy', '2026-09-01', exam);
    for (let i = 0; i < 20 && r.nextReview; i++) {
      expect(r.nextReview < exam).toBe(true);
      r = review(r.state, 'easy', r.nextReview, exam);
    }
    const last = review(r.state, 'good', addDays(exam, -1), exam);
    expect(last.nextReview).toBeNull();
  });

  it('nenhum intervalo passa da metade do tempo restante', () => {
    const exam = '2026-12-01';
    let r = review(null, 'easy', '2026-09-01', exam);
    while (r.nextReview) {
      const remaining = diffDays(exam, r.state.lastReview);
      expect(r.intervalDays).toBeLessThanOrEqual(Math.max(1, Math.floor(remaining / 2)));
      r = review(r.state, 'easy', r.nextReview, exam);
    }
  });

  it('reajusta revisões já agendadas quando a prova se aproxima', () => {
    expect(adjustDueDate('2026-12-30', '2026-11-01', '2026-11-20')).toBe('2026-11-10');
    expect(adjustDueDate('2026-11-05', '2026-11-01', '2026-11-20')).toBe('2026-11-05');
    expect(adjustDueDate('2026-11-05', '2026-11-01', null)).toBe('2026-11-05');
  });

  it('projeta revisões dentro do período', () => {
    const r = review(null, 'good', '2026-09-01', '2026-12-01');
    const dates = projectReviews(r.state, r.nextReview, '2026-12-01', '2026-12-01');
    expect(dates.length).toBeGreaterThan(3);
    expect(dates.every((d) => d < '2026-12-01')).toBe(true);
  });
});
