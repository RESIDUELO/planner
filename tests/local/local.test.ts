/**
 * App off-line (APK): o mesmo backend do site rodando contra o PGlite, sem
 * Supabase, sem login, com o usuário local administrador.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, orderDataFiles } from '../../web/src/local/bootstrap';
import { createLocalSupabase } from '../../web/src/local/client';
import { createCtx } from '../../web/src/backend/core';
import { handle } from '../../web/src/backend/routes';
import { buildWidgetData } from '../../web/src/local/widget';

let today = '2026-09-28';
let ctx: ReturnType<typeof createCtx>;
const ok = (method: string, url: string, body?: unknown) => handle(ctx, method, url, body) as Promise<any>;

beforeAll(async () => {
  const db = new PGlite();
  const files = orderDataFiles(readdirSync('supabase/data').filter((f) => f.endsWith('.sql')));
  await bootstrap(db, readFileSync('supabase/schema.sql', 'utf8'), files.map((f) => readFileSync(`supabase/data/${f}`, 'utf8')));
  ctx = createCtx(createLocalSupabase(db), () => today);
}, 120_000);

describe('app off-line', () => {
  it('já entra logado como administrador local', async () => {
    const me = await ok('GET', '/api/auth/me');
    expect(me.user).toMatchObject({ role: 'admin', isGuest: false });
  });

  it('tem as 4 provas e o cronograma privado', async () => {
    const exams = await ok('GET', '/api/exams');
    expect(exams.map((e: any) => e.institution).sort()).toEqual(['FAMEMA', 'FAMERP', 'HU-UEL', 'UNOESTE/HRPP']);
    const tpl = await ok('GET', '/api/templates');
    expect(tpl).toHaveLength(1);
    expect(tpl[0]).toMatchObject({ lessons: 45, studied: 27, examDate: '2026-12-05' });
  });

  it('planner público: gerar, concluir, revisar, praticar, anotar, ocultar e mover', async () => {
    const exams = await ok('GET', '/api/exams');
    const famerp = exams.find((e: any) => e.institution === 'FAMERP');
    // Como a tela de configuração faz: salva o tempo de estudo antes de gerar
    const st = await ok('GET', '/api/me/study-settings');
    await ok('PUT', '/api/me/study-settings', {
      profile: { ...st.profile, preferred_start_time: null, preferred_end_time: null },
      methods: st.methods.map((m: any) => ({ id: m.id, enabled: ['video', 'flashcards'].includes(m.code), minutes: m.estimated_minutes })),
    });
    await ok('POST', '/api/planner/generate', { editionIds: [famerp.edition_id], primaryEditionId: famerp.edition_id, startDate: today });
    const p = await ok('GET', '/api/planner');
    expect(p.subjects.length).toBeGreaterThan(50);
    const t = await ok('GET', '/api/planner/today');
    const first = t.newSubjects[0];
    expect(first).toBeTruthy();
    await ok('POST', `/api/planner/subjects/${first.subjectId}/complete`, { done: true });
    await ok('POST', `/api/planner/subjects/${first.subjectId}/practice`, { questions: 10, correct: 7 });
    const detail = await ok('GET', `/api/planner/subjects/${first.subjectId}`);
    expect(detail.subject.status ?? detail.status).toBeDefined();

    today = '2026-09-30';
    const cal = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-20');
    const reviewDay = cal.days.find((d: any) => d.reviews.some((r: any) => r.subjectId === first.subjectId));
    expect(reviewDay).toBeTruthy();
    await ok('POST', `/api/reviews/${first.subjectId}`, { rating: 'good' });

    await ok('PUT', '/api/notes/2026-09-28', { content: 'Revisar cardio.' });
    expect((await ok('GET', '/api/notes/2026-09-28')).content).toBe('Revisar cardio.');

    const next = (await ok('GET', '/api/planner')).subjects.find((s: any) => s.status !== 'studied' && s.nextScheduledDate > today);
    await ok('POST', `/api/planner/subjects/${next.subjectId}/move`, { from: next.nextScheduledDate, to: today });
    expect((await ok('GET', '/api/planner/today')).newSubjects.some((s: any) => s.subjectId === next.subjectId)).toBe(true);
    await ok('PUT', `/api/planner/subjects/${next.subjectId}/hidden`, { hidden: true });
    expect((await ok('GET', '/api/planner')).subjects.find((s: any) => s.subjectId === next.subjectId).hidden).toBe(true);

    const perf = await ok('GET', '/api/performance');
    expect(perf.hasPlan).toBe(true);

    // Widget "Hoje": próximos dias com assuntos (área e cor) e revisões
    const w = buildWidgetData(await ok('GET', '/api/planner'), await ok('GET', `/api/reviews/calendar?from=${today}&to=2026-10-13`));
    expect(w.exam).toEqual({ name: 'FAMERP', date: '2026-11-24' });
    expect(Object.keys(w.days)).toHaveLength(14);
    const item = Object.values(w.days).flatMap((d) => d.s)[0];
    expect(item).toMatchObject({ n: expect.any(String), a: expect.any(String), c: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect(w.days[today].s.some((x) => x.n === next.name)).toBe(false); // oculto não aparece
  });

  it('cronograma privado e zerar o perfil', async () => {
    const [tpl] = await ok('GET', '/api/templates');
    await ok('POST', '/api/planner/generate-template', { templateId: tpl.id });
    const p = await ok('GET', '/api/planner');
    expect(p.subjects).toHaveLength(107);
    expect(p.subjects.filter((x: any) => x.status === 'studied')).toHaveLength(27);
    await ok('POST', '/api/me/reset');
    expect((await ok('GET', '/api/planner')).plan ?? null).toBeNull();
  });
  it('agenda: tarefas do dia, lembretes, gerais, anotação e "Mostrar no Planner"', async () => {
    const day = await ok('POST', '/api/agenda/tasks', { kind: 'day', title: 'Enviar documento', date: '2026-09-29' });
    expect(day).toMatchObject({ kind: 'day', done: false, showInPlanner: false, checklist: [] });
    await ok('POST', '/api/agenda/tasks', { kind: 'reminder', title: 'Dentista', date: '2026-09-29', time: '14:30' });
    const gen = await ok('POST', '/api/agenda/tasks', { kind: 'general', title: 'Inscrição FAMERP', date: '2026-10-15', priority: 3,
      checklist: [{ text: 'Separar documentos', done: false }, { text: 'Conferir edital', done: false }] });
    await ok('POST', '/api/agenda/tasks', { kind: 'general', title: 'Comprar jaleco' });
    await expect(ok('POST', '/api/agenda/tasks', { kind: 'day', title: 'Sem dia' })).rejects.toThrow(/dia/);
    await ok('PUT', '/api/agenda/notes/2026-09-29', { content: 'Antes do internato.' });

    let a = await ok('GET', '/api/agenda?from=2026-09-28&to=2026-10-04');
    expect(a.tasks.map((t: any) => t.title)).toEqual(['Dentista', 'Enviar documento']);
    expect(a.tasks[0].time).toBe('14:30');
    expect(a.general.map((t: any) => t.title).sort()).toEqual(['Comprar jaleco', 'Inscrição FAMERP']);
    expect(a.notes).toEqual({ '2026-09-29': 'Antes do internato.' });

    // Não entra no planner até a pessoa pedir; depois é a mesma tarefa nos dois lugares
    expect(await ok('GET', '/api/agenda/planner?from=2026-09-28&to=2026-10-04')).toEqual([]);
    await ok('PATCH', `/api/agenda/tasks/${day.id}`, { showInPlanner: true });
    await ok('PATCH', `/api/agenda/tasks/${gen.id}`, { showInPlanner: true, checklist: [{ text: 'Separar documentos', done: true }, { text: 'Conferir edital', done: false }] });
    let p = await ok('GET', '/api/agenda/planner?from=2026-09-28&to=2026-10-04');
    expect(p.map((t: any) => t.id)).toEqual([day.id]);
    await ok('PATCH', `/api/agenda/tasks/${day.id}`, { done: true });
    p = await ok('GET', '/api/agenda/planner?from=2026-09-28&to=2026-10-04');
    a = await ok('GET', '/api/agenda?from=2026-09-28&to=2026-10-04');
    expect(p[0]).toMatchObject({ id: day.id, done: true });
    expect(a.tasks.find((t: any) => t.id === day.id).done).toBe(true);
    // Prazo da tarefa geral aparece no dia do prazo (na agenda e, se pedido, no planner)
    p = await ok('GET', '/api/agenda/planner?from=2026-10-12&to=2026-10-18');
    expect(p[0]).toMatchObject({ id: gen.id, kind: 'general', priority: 3 });
    expect(p[0].checklist[0].done).toBe(true);

    // O planner de estudos não muda: nenhuma tarefa vira assunto ou revisão
    const week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    const names = (week?.days ?? []).flatMap((d: any) => [...d.newSubjects, ...d.reviews].map((x: any) => x.name));
    expect(names).not.toContain('Enviar documento');

    await ok('PUT', '/api/agenda/notes/2026-09-29', { content: '  ' });
    await ok('DELETE', `/api/agenda/tasks/${gen.id}`);
    a = await ok('GET', '/api/agenda?from=2026-09-28&to=2026-10-31');
    expect(a.notes).toEqual({});
    expect(a.general.map((t: any) => t.title)).toEqual(['Comprar jaleco']);
  });
});
