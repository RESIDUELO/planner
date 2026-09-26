/**
 * Widget "Hoje" do Android: o app manda para a tela inicial os assuntos e as
 * revisões das próximas duas semanas. O widget escolhe o dia pela data do
 * aparelho, então vira o dia sozinho mesmo sem abrir o app.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from '../lib/api';
import { areaShort, tintFor } from '../lib/areas';
import { todayBR } from '../lib/format';
import { addDays } from '../../../shared/dates';

interface TodayWidgetPlugin { update(opts: { data: string }): Promise<void> }
const TodayWidget = registerPlugin<TodayWidgetPlugin>('TodayWidget');

/** Mesmas cores das bolinhas das áreas no app. */
const DOT: Record<string, string> = { rose: '#e79aaa', lilac: '#a797e6', butter: '#e3cf3c', mint: '#5fcf92', sky: '#7fb3e6', peach: '#eba37d' };
const DAYS = 14;

export interface WidgetData {
  v: 1;
  exam: { name: string; date: string } | null;
  days: Record<string, { s: { n: string; a: string; c: string; d: boolean }[]; r: { n: string; d: boolean }[] }>;
}

export function buildWidgetData(planner: any, calendar: any): WidgetData {
  const exam = planner?.exams?.find((e: any) => e.is_primary) ?? planner?.exams?.[0];
  const days: WidgetData['days'] = {};
  for (const d of calendar?.days ?? []) {
    const reviews = (d.reviews as any[]).filter((r, i, a) => a.findIndex((x) => x.subjectId === r.subjectId) === i);
    days[d.date] = {
      s: d.newSubjects.map((n: any) => ({ n: n.name, a: (n.specialty || areaShort(n.area) || '').toUpperCase(), c: DOT[tintFor(n.area)], d: !!n.done })),
      r: reviews.map((r: any) => ({ n: r.name, d: r.status === 'done' })),
    };
  }
  const name = planner?.plan?.summary?.template ? `${planner.plan.name}` : exam?.institution ?? '';
  return { v: 1, exam: planner?.plan && exam?.exam_date ? { name: name.replace(/^Meu cronograma /, ''), date: exam.exam_date } : null, days };
}

/** Mantém o widget em dia: roda sempre que o planner ou a agenda mudam. */
export function WidgetSync() {
  const today = todayBR();
  const planner = useQuery({ queryKey: ['planner'], queryFn: () => api.get('/api/planner') });
  const to = addDays(today, DAYS - 1);
  const calendar = useQuery({
    queryKey: ['calendar', 'widget', today],
    queryFn: () => api.get(`/api/reviews/calendar?from=${today}&to=${to}`),
    enabled: !!planner.data?.plan,
  });
  const data = planner.data && (!planner.data.plan || calendar.data) ? JSON.stringify(buildWidgetData(planner.data, calendar.data)) : null;
  useEffect(() => {
    if (!data || !Capacitor.isNativePlatform()) return;
    TodayWidget.update({ data }).catch(() => { /* sem widget */ });
  }, [data]);
  return null;
}
