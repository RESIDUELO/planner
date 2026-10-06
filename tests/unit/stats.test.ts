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

  it('ordena pela porcentagem e, no empate, pela regularidade', () => {
    expect(st.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'vacinas', 'diabetes']);
    // 7 questões em 3 de 4 provas vêm antes de 1 questão em cada prova (4/4)
    const extra = [...links];
    for (const ed of ['e22', 'e23', 'e24', 'e25']) extra.push({ questionId: `c-${ed}`, editionId: ed, subjectId: 'cirrose', weight: 1 });
    // Mesma quantidade (7): quem caiu em todas as provas vem antes
    for (const ed of ['e22', 'e23', 'e24', 'e25']) extra.push({ questionId: `h-${ed}`, editionId: ed, subjectId: 'hepatites', weight: 1 });
    for (const ed of ['e22', 'e23', 'e25']) extra.push({ questionId: `h2-${ed}`, editionId: ed, subjectId: 'hepatites', weight: 1 });
    const s2 = computeExamStats(eds, extra);
    expect(s2.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'hepatites', 'vacinas', 'diabetes', 'cirrose']);
  });

  it('regularidade conta a partir da primeira aparição (tema que passou a cair todo ano)', () => {
    const extra = [...links];
    // Saúde mental: só a partir de 2023, e em todas desde então → 3/3
    for (const ed of ['e23', 'e24', 'e25']) extra.push({ questionId: `sm-${ed}`, editionId: ed, subjectId: 'saude-mental', weight: 1 });
    // Tema de uma prova só, recente → não vira "todo ano" (mínimo das 3 últimas)
    extra.push({ questionId: 'x25a', editionId: 'e25', subjectId: 'novo', weight: 1 });
    extra.push({ questionId: 'x25b', editionId: 'e25', subjectId: 'novo', weight: 1 });
    const s2 = computeExamStats(eds, extra);
    const sm = s2.subjects.find((s) => s.subjectId === 'saude-mental')!;
    expect(sm.regularity).toBe(1);
    expect(sm.presenceRate).toBe(0.75);
    expect(sm.activePercentage).toBeCloseTo(3 / 150);
    expect(s2.subjects.find((s) => s.subjectId === 'novo')!.regularity).toBeCloseTo(1 / 3);
    // A ordem é pela quantidade; a regularidade só desempata
    expect(s2.subjects.map((s) => s.subjectId)).toEqual(['arritmias', 'vacinas', 'diabetes', 'saude-mental', 'novo']);
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

describe('troca de banca', () => {
  // 2021-2025 banca antiga, 2026 e a próxima (2027) com a banca nova
  const eds = [2021, 2022, 2023, 2024, 2025, 2026].map((y) => ({ id: `e${y}`, year: y, questionCount: 100, board: y === 2026 ? 'VUNESP' : null }));
  const links = [] as { questionId: string; editionId: string; subjectId: string; weight: number }[];
  let n = 0;
  const add = (subject: string, perYear: number[]) => perYear.forEach((c, i) => {
    for (let k = 0; k < c; k++) links.push({ questionId: `q${n++}`, editionId: `e${2021 + i}`, subjectId: subject, weight: 1 });
  });
  add('nucleo', [1, 1, 1, 0, 0, 1]);   // banca nova + 3 antigas
  add('uti', [0, 0, 0, 0, 0, 3]);      // só a banca nova
  add('parto', [2, 6, 5, 2, 8, 0]);    // muito na antiga, nada na nova
  add('scA', [0, 1, 1, 1, 1, 0]);      // 4 antigas
  add('raro', [1, 0, 0, 0, 0, 0]);

  it('sem a banca da próxima prova, nada muda', () => {
    const st = computeExamStats(eds.map((e) => ({ ...e, board: null })), links);
    expect(st.boardChange).toBeNull();
    expect(st.subjects.every((s) => s.tier === 0)).toBe(true);
    expect(st.subjects[0].subjectId).toBe('parto');
  });

  it('pesa mais a banca atual e ordena por nível', () => {
    const st = computeExamStats([...eds, { id: 'e2027', year: 2027, questionCount: 0, board: 'VUNESP' }], links);
    expect(st.boardChange).toEqual({ board: 'VUNESP', currentYears: [2026], previousYears: [2021, 2022, 2023, 2024, 2025] });
    expect(st.subjects.map((s) => [s.subjectId, s.tier])).toEqual([['nucleo', 1], ['uti', 2], ['parto', 3], ['scA', 3], ['raro', 4]]);
    const uti = st.subjects.find((s) => s.subjectId === 'uti')!;
    const parto = st.subjects.find((s) => s.subjectId === 'parto')!;
    // Cada prova antiga pesa 0,25: total ponderado = 5 × 100 × 0,25 + 100 = 225
    expect(uti.percentage).toBeCloseTo(3 / 225);
    expect(parto.percentage).toBeCloseTo((23 * 0.25) / 225);
    expect(uti.board).toEqual({ currentQuestions: 3, currentEditions: 1, previousEditions: 0 });
    expect(parto.questions).toBe(23);
  });
});
