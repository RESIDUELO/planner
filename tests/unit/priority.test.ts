import { describe, expect, it } from 'vitest';
import { dynamicPriority, examWeights, rankSubjects, type ExamInput } from '../../shared/priority';
import { computeExamStats } from '../../shared/stats';
import { dominatedQuestions, estimateMastery } from '../../shared/mastery';

function exam(id: string, date: string | null, primary: boolean, counts: Record<string, number>, total = 100): ExamInput {
  const links: { questionId: string; editionId: string; subjectId: string; weight: number }[] = [];
  let q = 0;
  for (const [s, n] of Object.entries(counts)) for (let i = 0; i < n; i++) links.push({ questionId: `${id}-${q++}`, editionId: `${id}-2025`, subjectId: s, weight: 1 });
  return {
    editionId: id, label: id, examDate: date, isPrimary: primary, expectedTotalQuestions: total,
    stats: computeExamStats([{ id: `${id}-2025`, year: 2025, questionCount: total }], links),
  };
}

describe('priority_v2', () => {
  it('em prova única, o assunto mais frequente é o #1', () => {
    const r = rankSubjects([exam('famerp', '2026-11-12', true, { vacinas: 5, arritmias: 9, diabetes: 3 })], '2026-09-25');
    expect(r.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'vacinas', 'diabetes']);
    expect(r.subjects[0].estimatedQuestions).toBeCloseTo(9);
    expect(r.subjects[0].level).toBe('muito_alta');
  });

  it('multiprova combina frequências e dá mais peso à prova mais próxima', () => {
    const a = exam('A', '2026-10-10', false, { x: 10, y: 2 });
    const b = exam('B', '2027-03-01', false, { x: 2, y: 10 });
    const w = examWeights([a, b], '2026-09-25');
    expect(w[0].weight).toBeGreaterThan(w[1].weight);
    const r = rankSubjects([a, b], '2026-09-25');
    expect(r.subjects[0].subjectId).toBe('x');
    expect(r.subjects[0].perExam).toHaveLength(2);
  });

  it('prova principal tem mais influência', () => {
    const a = exam('A', '2026-11-10', false, { x: 10, y: 2 });
    const b = exam('B', '2026-11-10', true, { x: 2, y: 10 });
    expect(rankSubjects([a, b], '2026-09-25').subjects[0].subjectId).toBe('y');
  });

  it('provas sem dados não influenciam', () => {
    const a = exam('A', '2026-11-10', false, {});
    const b = exam('B', '2026-11-10', true, { y: 3 });
    const w = examWeights([a, b], '2026-09-25');
    expect(w[0].weight).toBe(0);
    expect(w[0].excludedReason).toBe('no_data');
  });

  it('score dinâmico: esquecimento e desempenho ruim aumentam a prioridade', () => {
    const base = { historicalScore: 0.8, proximity: 0.5, questionsAnswered: 20, questionsCorrect: 17 };
    const fresh = dynamicPriority({ ...base, retrievability: 0.98 });
    const forgotten = dynamicPriority({ ...base, retrievability: 0.6 });
    const bad = dynamicPriority({ ...base, retrievability: 0.98, questionsCorrect: 8 });
    expect(forgotten.score).toBeGreaterThan(fresh.score);
    expect(bad.score).toBeGreaterThan(fresh.score);
  });
});

describe('questões potencialmente dominadas', () => {
  it('multiplica questões esperadas pelo domínio estimado', () => {
    const m = estimateMastery({ studied: true, questionsAnswered: 20, questionsCorrect: 17, retrievability: 1 });
    expect(m.accuracy).toBeCloseTo(0.85);
    expect(m.mastery).toBeCloseTo(18 / 22);
    expect(dominatedQuestions([{ estimatedQuestions: 4, mastery: 0.85 }])).toBeCloseTo(3.4);
  });

  it('assunto não estudado e sem questões conta zero', () => {
    expect(estimateMastery({ studied: false, questionsAnswered: 0, questionsCorrect: 0, retrievability: null }).mastery).toBe(0);
  });
});
