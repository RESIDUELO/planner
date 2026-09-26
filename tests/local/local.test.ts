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
  it('planner sem prova: vazio, montado à mão, e assuntos próprios sobrevivem ao cronograma automático', async () => {
    today = '2026-09-28';
    await ok('POST', '/api/me/reset');
    expect((await ok('GET', '/api/planner')).plan ?? null).toBeNull();
    const areas = await ok('GET', '/api/areas');
    const outros = areas.find((a: any) => a.other);
    const cardio = areas.find((a: any) => /Clínica/.test(a.name));
    expect(outros && cardio).toBeTruthy();

    // Primeiro "+": cria o planner vazio e o assunto do próprio aluno
    const { subjectId: brugada } = await ok('POST', '/api/planner/days/2026-09-30/subjects', { name: 'Síndrome de Brugada', areaId: cardio.id });
    const { subjectId: ecg } = await ok('POST', '/api/planner/days/2026-09-29/subjects', { name: 'Revisar ECG' });
    await expect(ok('POST', '/api/planner/days/2026-09-27/subjects', { name: 'Ontem' })).rejects.toThrow(/hoje ou um dia futuro/);
    let p = await ok('GET', '/api/planner');
    expect(p.plan.settings_snapshot.manual).toBe(true);
    expect(p.exams).toEqual([]);
    expect(p.subjects.map((x: any) => [x.name, x.own, x.area])).toEqual([['Síndrome de Brugada', true, 'Clínica Médica'], ['Revisar ECG', true, 'Outros']]);
    let week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    const on = (w: any, d: string) => w.days.find((x: any) => x.date === d).newSubjects.map((n: any) => n.name);
    expect(on(week, '2026-09-30')).toEqual(['Síndrome de Brugada']);
    expect(on(week, '2026-09-29')).toEqual(['Revisar ECG']);

    // Funciona como qualquer assunto: mover, concluir, revisar, editar
    await ok('POST', `/api/planner/subjects/${brugada}/move`, { from: '2026-09-30', to: '2026-10-01' });
    week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    expect(on(week, '2026-10-01')).toEqual(['Síndrome de Brugada']);
    const done = await ok('POST', `/api/planner/subjects/${ecg}/complete`, { done: true });
    expect(done).toMatchObject({ studied: true, cardCreated: true });
    const detail = await ok('GET', `/api/planner/subjects/${ecg}`);
    expect(detail.subject.card.nextReview).toBeTruthy();
    expect(detail.explanation).toMatch(/criado por você/);
    await ok('PATCH', `/api/subjects/${ecg}`, { name: 'ECG — revisão' });
    // Não entra na base global de assuntos da prova
    const exams = await ok('GET', '/api/exams');
    const famerp = exams.find((e: any) => e.institution === 'FAMERP');

    // Escolhe uma prova depois: o cronograma automático é gerado e os assuntos próprios continuam nos mesmos dias
    const st = await ok('GET', '/api/me/study-settings');
    await ok('PUT', '/api/me/study-settings', {
      profile: { ...st.profile, preferred_start_time: null, preferred_end_time: null },
      methods: st.methods.map((m: any) => ({ id: m.id, enabled: m.enabled, minutes: m.estimated_minutes })),
    });
    await ok('POST', '/api/planner/generate', { editionIds: [famerp.edition_id], primaryEditionId: famerp.edition_id, startDate: today });
    p = await ok('GET', '/api/planner');
    expect(p.plan.settings_snapshot.manual).toBeUndefined();
    const own = p.subjects.filter((x: any) => x.own);
    expect(own.map((x: any) => x.name).sort()).toEqual(['ECG — revisão', 'Síndrome de Brugada']);
    expect(p.subjects.filter((x: any) => !x.own).length).toBeGreaterThan(50);
    week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    const before = on(week, '2026-10-02');
    expect(before.length).toBeGreaterThan(0);
    expect(on(week, '2026-10-01')).toContain('Síndrome de Brugada');

    // "+" com assunto da prova e com assunto novo no mesmo dia: o que já estava planejado continua lá
    const examSubject = p.subjects.find((x: any) => !x.own && !before.includes(x.name) && x.status === 'pending');
    await ok('POST', '/api/planner/days/2026-10-02/subjects', { subjectId: examSubject.subjectId });
    await ok('POST', '/api/planner/days/2026-10-02/subjects', { name: 'Arritmias — meu resumo' });
    week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    expect(on(week, '2026-10-02')).toEqual(expect.arrayContaining([...before, examSubject.name, 'Arritmias — meu resumo']));

    // Concluir um assunto reorganiza a fila automática, mas não mexe nos assuntos próprios
    const firstAuto = p.subjects.find((x: any) => x.name === before[0]);
    await ok('POST', `/api/planner/subjects/${firstAuto.subjectId}/complete`, { done: true });
    await ok('POST', '/api/planner/replan');
    week = await ok('GET', '/api/reviews/calendar?from=2026-09-28&to=2026-10-04');
    expect(on(week, '2026-10-01')).toContain('Síndrome de Brugada');
    expect(on(week, '2026-10-02')).toContain('Arritmias — meu resumo');

    // Excluir o assunto próprio apaga só ele
    await ok('DELETE', `/api/subjects/${brugada}`);
    p = await ok('GET', '/api/planner');
    expect(p.subjects.some((x: any) => x.subjectId === brugada)).toBe(false);
    await expect(ok('DELETE', `/api/subjects/${examSubject.subjectId}`)).rejects.toThrow(/não encontrado/);
  });
});
