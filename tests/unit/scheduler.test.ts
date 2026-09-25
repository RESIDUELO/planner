import { describe, expect, it } from 'vitest';
import { buildSchedule, sizeFactors, type SchedulerInput } from '../../shared/scheduler';

const methods = [
  { id: 'video', code: 'video', activityType: 'video', minutes: 60 },
  { id: 'flash', code: 'flashcards', activityType: 'flashcards', minutes: 20 },
  { id: 'q', code: 'questions', activityType: 'questions', minutes: 40 },
];

function input(over: Partial<SchedulerInput> = {}): SchedulerInput {
  const pcts = Array.from({ length: 40 }, (_, i) => (40 - i) / 820);
  const f = sizeFactors(pcts);
  return {
    startDate: '2026-09-28',
    endDate: '2026-11-12',
    dailyMinutes: 240,
    studyWeekdays: [1, 2, 3, 4, 5, 6],
    questionsPerDay: 20,
    methods,
    subjects: pcts.map((p, i) => ({ subjectId: `s${i + 1}`, rank: i + 1, percentage: p, sizeFactor: f[i], examDate: '2026-11-12', completedMethodIds: [] })),
    examDates: ['2026-11-12'],
    ...over,
  };
}

describe('scheduler_v1', () => {
  it('nunca planeja mais do que as horas diárias informadas (conteúdo novo + questões)', () => {
    const out = buildSchedule(input());
    for (const d of out.days) expect(d.newStudy + d.questions).toBeLessThanOrEqual(d.capacity);
  });

  it('agenda na ordem do ranking e só em dias de estudo', () => {
    const out = buildSchedule(input());
    const firstDate = new Map<string, string>();
    for (const a of out.activities) if (!firstDate.has(a.subjectId)) firstDate.set(a.subjectId, a.date);
    const order = [...firstDate.entries()].sort((a, b) => a[1].localeCompare(b[1]) || Number(a[0].slice(1)) - Number(b[0].slice(1)));
    expect(order[0][0]).toBe('s1');
    for (const a of out.activities) expect(new Date(a.date + 'T00:00:00Z').getUTCDay()).not.toBe(0);
    for (const a of out.activities) expect(a.date < '2026-11-12').toBe(true);
  });

  it('com pouco tempo, prioriza os mais frequentes e avisa o que não coube', () => {
    const out = buildSchedule(input({ dailyMinutes: 60, endDate: '2026-10-20' }));
    expect(out.unscheduledSubjectIds.length).toBeGreaterThan(0);
    expect(out.scheduledSubjectIds).toContain('s1');
    const maxScheduled = Math.max(...out.scheduledSubjectIds.map((s) => Number(s.slice(1))));
    const minUnscheduled = Math.min(...out.unscheduledSubjectIds.map((s) => Number(s.slice(1))));
    expect(minUnscheduled).toBeLessThan(maxScheduled + 5);
    expect(out.summary.warnings.join(' ')).toMatch(/não couberam/);
    for (const d of out.days) expect(d.newStudy + d.questions).toBeLessThanOrEqual(60);
  });

  it('reserva a reta final para revisões', () => {
    const out = buildSchedule(input());
    expect(out.summary.finalPhaseDays).toBeGreaterThan(0);
    const finalDays = new Set(out.days.filter((d) => d.finalPhase).map((d) => d.date));
    expect(out.activities.some((a) => finalDays.has(a.date))).toBe(false);
  });

  it('usa somente os métodos selecionados', () => {
    const out = buildSchedule(input());
    expect(new Set(out.activities.map((a) => a.methodId))).toEqual(new Set(['video', 'flash', 'q']));
  });

  it('limita as questões do dia a uma fração da capacidade', () => {
    const out = buildSchedule(input({ dailyMinutes: 60, questionsPerDay: 100 }));
    expect(out.summary.questionsPerDayFitted).toBeLessThan(100);
    expect(out.summary.warnings.join(' ')).toMatch(/questões\/dia/);
  });
});
