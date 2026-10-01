import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlannerPdf, clean, type PdfDay, type PdfInput } from '../../web/src/lib/plannerPdf';
import { addDays } from '../../shared/dates';

const AREAS = ['Clínica Médica', 'Cirurgia Geral', 'Pediatria', 'Ginecologia e Obstetrícia', 'Medicina Preventiva'];
const NAMES = ['Insuficiência cardíaca', 'Abdome agudo inflamatório', 'Icterícia neonatal', 'Pré-eclâmpsia e eclâmpsia', 'Vigilância epidemiológica',
  'Diabetes mellitus: diagnóstico, classificação e tratamento farmacológico', 'Trauma torácico', 'Bronquiolite', 'Sangramento da segunda metade', 'SUS: princípios e diretrizes'];

function sample(from: string, n: number): PdfInput {
  const days: PdfDay[] = Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i);
    const weekend = i % 7 >= 5;
    return {
      date,
      subjects: weekend ? [] : Array.from({ length: 2 + (i % 4) }, (_, j) => ({
        name: NAMES[(i + j) % NAMES.length], area: AREAS[(i + j) % AREAS.length], methods: ['Videoaula', 'Flashcards', 'Questões'], done: i < 3,
      })),
      reviews: Array.from({ length: i % 5 }, (_, j) => ({ name: NAMES[(i * 3 + j) % NAMES.length], done: i < 2, overdue: i === 2 })),
      tasks: i % 3 === 0 ? [{ title: 'Pagar a inscrição — “FAMEMA” 🎯', time: '14:30', kind: 'day', priority: 3, done: false, note: 'Boleto no e-mail', checklist: [{ text: 'Separar documentos', done: true }] }] : [],
      exams: i === n - 1 ? ['FAMEMA'] : [],
      events: i === 10 ? [{ residency: 'UNITAU', label: 'fim da inscrição', type: 'inscricao', done: false }] : [],
      note: i === 4 ? 'Semana puxada: dormir cedo na quinta.' : undefined,
    };
  });
  return {
    title: 'Cronograma de estudos', subtitle: 'FAMEMA · R1 Acesso Direto', owner: 'Ana', today: from, from, to: addDays(from, n - 1),
    exams: [{ name: 'FAMEMA', date: addDays(from, n - 1) }, { name: 'UNITAU', date: addDays(from, n + 20) }],
    days, general: [{ title: 'Comprar caderno', time: null, kind: 'general', priority: null, done: false, checklist: [] }], withAgenda: true, withReviews: true,
  };
}

describe('planner em PDF', () => {
  it('troca o que as fontes do PDF não têm', () => {
    expect(clean('Prova — “UNITAU” … 🎯 ação')).toBe('Prova - "UNITAU" ... ação');
  });

  it('monta capa, meses e o dia a dia com a agenda', () => {
    const input = sample('2026-10-01', 75);
    const doc = buildPlannerPdf(input);
    const pages = doc.getNumberOfPages();
    // capa + 3 meses (out, nov, dez) + dia a dia em várias folhas
    expect(pages).toBeGreaterThan(6);
    const bytes = doc.output('arraybuffer');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, Buffer.from(bytes));
  });

  it('funciona sem provas, sem agenda e com dias vazios', () => {
    const input = { ...sample('2026-12-28', 10), exams: [], withAgenda: false, withReviews: false, general: [] };
    input.days = input.days.map((d) => ({ ...d, reviews: [], tasks: [], subjects: d.subjects.slice(0, 1) }));
    expect(buildPlannerPdf(input).getNumberOfPages()).toBeGreaterThan(2);
  });
});
