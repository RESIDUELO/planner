import { describe, expect, it } from 'vitest';
import { computeExamStats, sufficiencyMessage } from '../../shared/stats';

const eds = [
  { id: 'e22', year: 2022, questionCount: 50 },
  { id: 'e23', year: 2023, questionCount: 50 },
  { id: 'e24', year: 2024, questionCount: 50 },
  { id: 'e25', year: 2025, questionCount: 50 },
];
// Arritmias: 3,4,5,4 = 16 ; Vacinas: 2,2,0,3 = 7 ; Diabetes 5 só em 2022
const links = [] as { questionId: string; editionId: string; subjectId: string; weight: number }[];
let q = 0;
const add = (ed: string, subject: string, n: number) => {
  for (let i = 0; i < n; i++) links.push({ questionId: `q${q++}`, editionId: ed, subjectId: subject, weight: 1 });
};
add('e22', 'arritmias', 3); add('e23', 'arritmias', 4); add('e24', 'arritmias', 5); add('e25', 'arritmias', 4);
add('e22', 'vacinas', 2); add('e23', 'vacinas', 2); add('e25', 'vacinas', 3);
add('e22', 'diabetes', 5);

describe('computeExamStats', () => {
  const st = computeExamStats(eds, links);

  it('separa contagem absoluta, percentual, presença e média', () => {
    const a = st.subjects.find((s) => s.subjectId === 'arritmias')!;
    expect(a.questions).toBe(16);
    expect(a.percentage).toBeCloseTo(16 / 200);
    expect(a.editionsPresent).toBe(4);
    expect(a.presenceRate).toBe(1);
    expect(a.annualAverage).toBe(4);
    expect(a.byYear.map((y) => y.questions)).toEqual([3, 4, 5, 4]);
    expect(a.recentPercentage).toBeCloseTo(9 / 100);
  });

  it('ordena pela regularidade e depois pela quantidade', () => {
    expect(st.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'vacinas', 'diabetes']);
    // 1 questão em cada prova (4/4) vem antes de 7 questões em 3 de 4 provas
    const extra = [...links];
    for (const ed of ['e22', 'e23', 'e24', 'e25']) extra.push({ questionId: `c-${ed}`, editionId: ed, subjectId: 'cirrose', weight: 1 });
    const s2 = computeExamStats(eds, extra);
    expect(s2.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'cirrose', 'vacinas', 'diabetes']);
  });

  it('não conta edições sem questões classificadas', () => {
    const s2 = computeExamStats([...eds, { id: 'e26', year: 2026, questionCount: 0 }], links);
    expect(s2.editionsAnalyzed).toBe(4);
    expect(s2.years).toEqual([2022, 2023, 2024, 2025]);
  });

  it('distribui questões com mais de um assunto pelo peso de relevância', () => {
    const s = computeExamStats([{ id: 'x', year: 2024, questionCount: 1 }], [
      { questionId: 'q', editionId: 'x', subjectId: 'a', weight: 1 },
      { questionId: 'q', editionId: 'x', subjectId: 'b', weight: 0.5 },
    ]);
    const a = s.subjects.find((x) => x.subjectId === 'a')!;
    const b = s.subjects.find((x) => x.subjectId === 'b')!;
    expect(a.questions).toBe(1);
    expect(b.questions).toBe(1);
    expect(a.percentage + b.percentage).toBeCloseTo(1);
    expect(a.percentage).toBeCloseTo(2 / 3);
  });

  it('informa honestamente a quantidade de edições', () => {
    expect(sufficiencyMessage(0)).toMatch(/Nenhuma/);
    expect(sufficiencyMessage(1)).toBe('Dados insuficientes para uma análise histórica confiável.');
    expect(sufficiencyMessage(2)).toBe('Análise baseada em 2 edições cadastradas.');
  });
});
