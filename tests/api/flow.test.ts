/**
 * Fluxo completo (seção 58) contra um PostgreSQL real, com RLS ativo.
 * Os testes rodam em sequência e compartilham o estado do banco.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { Client, createAdmin, createAll, importFile, OWNER_URL, ownerQuery, resetDatabase, startApp, stopApp } from './helpers';

let app: FastifyInstance;
const admin = () => new Client(app);
let adm: Client;
let student: Client;
let other: Client;
const ids: Record<string, string> = {};
const TODAY = '2026-09-25';

beforeAll(async () => {
  await resetDatabase();
  app = await startApp();
  await createAdmin('admin@teste.com', 'senha-admin-123');
  adm = admin();
  adm.today = TODAY;
  await adm.ok('POST', '/api/auth/login', { email: 'admin@teste.com', password: 'senha-admin-123' });
});
afterAll(async () => stopApp(app));

describe('Base vazia', () => {
  it('sem cadastro do administrador, o sistema não conhece nenhuma prova', async () => {
    const guest = new Client(app);
    await guest.ok('POST', '/api/auth/guest');
    expect(await guest.ok('GET', '/api/exams')).toEqual([]);
  });
});

describe('Administração (testes 21–25)', () => {
  it('cria instituição, banca, prova e edição como rascunho', async () => {
    const inst = await adm.ok('POST', '/api/admin/institutions', { name: 'Faculdade de Medicina de São José do Rio Preto', abbreviation: 'FAMERP', state: 'SP', city: 'São José do Rio Preto' });
    const board = await adm.ok('POST', '/api/admin/boards', { name: 'Banca Própria FAMERP', abbreviation: 'FAMERP-B' });
    const exam = await adm.ok('POST', '/api/admin/exams', { institution_id: inst.id, board_id: board.id, name: 'R1 Acesso Direto', total_questions: 80 });
    const ed = await adm.ok('POST', '/api/admin/editions', {
      exam_id: exam.id, year: 2027, exam_date: '2026-11-12', registration_start: '2026-09-01', registration_end: '2026-10-10',
      registration_fee: 400, number_of_vacancies: 60, edital_url: 'https://exemplo.org/edital.pdf', source_name: 'Edital oficial',
      source_url: 'https://exemplo.org/edital.pdf', source_checked_at: TODAY,
    });
    expect(ed.status).toBe('draft');
    Object.assign(ids, { famerpInst: inst.id, famerpExam: exam.id, famerp2027: ed.id });
  });

  it('rascunho não aparece para usuários (teste 23)', async () => {
    student = new Client(app);
    student.today = TODAY;
    await student.ok('POST', '/api/auth/register', { name: 'Aluna Teste', email: 'aluna@teste.com', password: 'senha-aluna-123' });
    expect(await student.ok('GET', '/api/exams')).toEqual([]);
    // Nem por consulta direta à API de histórico
    expect((await student.req('GET', `/api/exams/${ids.famerpExam}/history`)).status).toBe(404);
  });

  it('importação: prévia mostra válidas, duplicadas e assuntos não encontrados, sem gravar nada', async () => {
    const f = importFile('famerp_r1_2021-2026.json');
    const preview = await adm.ok('POST', '/api/admin/import/preview', { examId: ids.famerpExam, ...f });
    expect(preview.total).toBe(480);
    expect(preview.valid).toBe(480);
    expect(preview.annulled).toBe(23);
    expect(preview.unknown.length).toBeGreaterThan(100);
    expect(preview.unknown.some((u: any) => u.kind === 'area')).toBe(true);
    const n = await ownerQuery('select count(*)::int as n from public.questions');
    expect(n.rows[0].n).toBe(0);
    const s = await ownerQuery('select count(*)::int as n from public.subjects');
    expect(s.rows[0].n).toBe(0);
  });

  it('commit exige decisão para cada item desconhecido', async () => {
    const f = importFile('famerp_r1_2021-2026.json');
    const r = await adm.req('POST', '/api/admin/import/commit', { examId: ids.famerpExam, ...f, resolutions: {} });
    expect(r.status).toBe(400);
  });

  it('importa após confirmação e cria as edições como rascunho', async () => {
    const f = importFile('famerp_r1_2021-2026.json');
    const preview = await adm.ok('POST', '/api/admin/import/preview', { examId: ids.famerpExam, ...f });
    const res = await adm.ok('POST', '/api/admin/import/commit', { examId: ids.famerpExam, ...f, resolutions: createAll(preview) });
    expect(res.inserted).toBe(480);
    expect(res.classified).toBe(480);
    expect(res.editionsCreated).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    // Reimportar: tudo duplicado
    const again = await adm.ok('POST', '/api/admin/import/preview', { examId: ids.famerpExam, ...f });
    expect(again.duplicates.length).toBe(480);
    expect(again.valid).toBe(0);
  });

  it('estatísticas vêm exclusivamente do banco', async () => {
    const st = await adm.ok('GET', `/api/admin/exams/${ids.famerpExam}/stats`);
    expect(st.editionsAnalyzed).toBe(6);
    expect(st.totalQuestions).toBe(480);
    expect(st.subjects[0].name).toBe('Saúde do Trabalhador');
    expect(st.subjects[0].questions).toBe(30);
    expect(st.subjects[0].percentage).toBeCloseTo(30 / 480);
    expect(st.subjects[1].name).toBe('Trauma');
    expect(st.subjects[1].editionsPresent).toBe(6);
  });

  it('publicar torna a prova visível (teste 24)', async () => {
    const eds = await adm.ok('GET', `/api/admin/editions?examId=${ids.famerpExam}`);
    for (const e of eds) await adm.ok('POST', `/api/admin/editions/${e.id}/status`, { status: 'published' });
    const list = await student.ok('GET', '/api/exams');
    expect(list.length).toBe(7);
    const next = list.find((e: any) => e.year === 2027);
    expect(next.history.editionsAnalyzed).toBe(6);
    expect(next.history.message).toBe('Análise baseada em 6 edições cadastradas.');
    expect(next.registration_window).toBe('open');
  });

  it('registra auditoria com valor anterior e novo', async () => {
    await adm.ok('PUT', `/api/admin/editions/${ids.famerp2027}`, { registration_fee: 450 });
    const logs = await adm.ok('GET', '/api/admin/logs?entity=exam_editions');
    const fee = logs.rows.find((l: any) => l.action === 'update' && l.new_values?.registration_fee != null);
    expect(fee.old_values.registration_fee).toBe(400);
    expect(fee.new_values.registration_fee).toBe(450);
    expect(fee.actor_name).toBe('Admin Teste');
    expect(fee.entity_label).toContain('FAMERP 2027');
  });
});

describe('Segurança (teste 20 e RLS)', () => {
  it('usuário comum é bloqueado em /api/admin', async () => {
    expect((await student.req('GET', '/api/admin/dashboard')).status).toBe(403);
    expect((await student.req('POST', '/api/admin/institutions', { name: 'Hack', abbreviation: 'HK' })).status).toBe(403);
  });

  it('o banco recusa escrita global de não-admin mesmo sem passar pela rota', async () => {
    // Simula uma requisição forjada: sessão válida de aluno, acesso direto ao banco com o papel da API.
    const token = student.cookie.split('=')[1];
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    const c = new pg.Client({ connectionString: OWNER_URL });
    await c.connect();
    const attempt = async (sql: string, params: unknown[] = []) => {
      await c.query('begin');
      await c.query('set local role rp_app');
      await c.query(`select set_config('app.session', $1, true)`, [hash]);
      try {
        const r = await c.query(sql, params);
        await c.query('rollback');
        return { ok: true, rowCount: r.rowCount };
      } catch (e: any) {
        await c.query('rollback');
        return { ok: false, code: e.code };
      }
    };
    expect(await attempt(`insert into public.institutions(name, abbreviation) values ('X', 'XX')`)).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(`update public.exam_editions set registration_fee = 1`)).toMatchObject({ ok: true, rowCount: 0 });
    expect(await attempt(`delete from public.institutions`)).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(`delete from public.questions`)).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(`update public.user_profiles set role = 'admin'`)).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(`select * from auth.users`)).toMatchObject({ ok: false, code: '42501' });
    expect(await attempt(`insert into public.admin_audit_logs(entity, action) values ('x', 'y')`)).toMatchObject({ ok: false, code: '42501' });
    // Rascunhos invisíveis
    await ownerQuery(`insert into public.exam_editions(exam_id, year, status) values ($1, 2030, 'draft')`, [ids.famerpExam]);
    const drafts = await attempt(`select 1 from public.exam_editions where status = 'draft'`);
    expect(drafts).toMatchObject({ ok: true, rowCount: 0 });
    await c.end();
  });
});

describe('Aluno (testes 1–19)', () => {
  let methods: any[];

  it('seleciona uma prova e define como principal (teste 3)', async () => {
    await student.ok('PUT', `/api/me/editions/${ids.famerp2027}`, { selected: true, isPrimary: true, status: 'registered', registrationNumber: '12345' });
    const list = await student.ok('GET', '/api/exams');
    const e = list.find((x: any) => x.edition_id === ids.famerp2027);
    expect(e.selected).toBe(true);
    expect(e.is_primary).toBe(true);
    expect(e.registration_status).toBe('registered');
  });

  it('não gera planner sem configurar o estudo', async () => {
    const r = await student.req('POST', '/api/planner/generate', { editionIds: [ids.famerp2027], primaryEditionId: ids.famerp2027, startDate: TODAY });
    expect(r.status).toBe(400);
  });

  it('configura métodos de estudo (teste 5)', async () => {
    const s = await student.ok('GET', '/api/me/study-settings');
    methods = s.methods;
    const chosen = new Set(['video', 'flashcards', 'questions']);
    await student.ok('PUT', '/api/me/study-settings', {
      profile: { start_date: TODAY, daily_hours: 4, study_days_per_week: 6, questions_per_day: 20, study_saturday: true, study_sunday: false },
      methods: methods.map((m) => ({ id: m.id, enabled: chosen.has(m.code), minutes: m.default_minutes })),
    });
    const after = await student.ok('GET', '/api/me/study-settings');
    expect(after.methods.filter((m: any) => m.enabled).map((m: any) => m.code).sort()).toEqual(['flashcards', 'questions', 'video']);
    expect(after.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gera o planner ordenado pela frequência histórica (teste 6)', async () => {
    await student.ok('POST', '/api/planner/generate', { editionIds: [ids.famerp2027], primaryEditionId: ids.famerp2027, startDate: TODAY });
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.end_date).toBe('2026-11-12');
    expect(p.subjects[0].name).toBe('Saúde do Trabalhador');
    expect(p.subjects[0].rank).toBe(1);
    expect(p.subjects[0].levelLabel).toBe('Muito alta');
    expect(p.subjects[1].name).toBe('Trauma');
    // Somente os métodos escolhidos aparecem no checklist
    expect(p.subjects[0].checklist.map((c: any) => c.code)).toEqual(['video', 'flashcards', 'questions']);
    // Nunca agenda mais que as horas disponíveis
    const load = await ownerQuery(`select scheduled_date, sum(estimated_minutes)::int as m from public.study_schedule group by 1`);
    for (const r of load.rows) expect(r.m).toBeLessThanOrEqual(240);
    ids.subject1 = p.subjects[0].subjectId;
    ids.subject2 = p.subjects[1].subjectId;
  });

  it('explica a posição do assunto', async () => {
    const d = await student.ok('GET', `/api/planner/subjects/${ids.subject1}`);
    expect(d.explanation).toMatch(/Saúde do Trabalhador está em #1 porque representou 6,3% das questões das 6 edições cadastradas/);
    expect(d.subject.yearsPresent).toBe(6);
  });

  it('"O que estudar hoje" respeita a carga', async () => {
    const t = await student.ok('GET', '/api/planner/today');
    expect(t.newSubjects[0].name).toBe('Saúde do Trabalhador');
    expect(t.plannedMinutes).toBeLessThanOrEqual(t.capacityMinutes);
  });

  it('marca aula e flashcards (testes 7 e 8)', async () => {
    const v = methods.find((m) => m.code === 'video');
    const f = methods.find((m) => m.code === 'flashcards');
    const r1 = await student.ok('POST', `/api/planner/subjects/${ids.subject1}/methods/${v.id}`, { done: true });
    expect(r1.studied).toBe(false);
    await student.ok('POST', `/api/planner/subjects/${ids.subject1}/methods/${f.id}`, { done: true });
    const p = await student.ok('GET', '/api/planner');
    const s = p.subjects[0];
    expect(s.status).toBe('in_progress');
    expect(s.progress).toBeCloseTo(2 / 3);
  });

  it('registra 20 questões com 17 acertos e atualiza o domínio (testes 9–12)', async () => {
    const before = (await student.ok('GET', '/api/dashboard')).dominated[0].dominated;
    const r = await student.ok('POST', `/api/planner/subjects/${ids.subject1}/practice`, { questions: 20, correct: 17 });
    expect(r.performance.questions_answered).toBe(20);
    expect(r.performance.accuracy).toBeCloseTo(0.85);
    // "Questões" concluído → assunto estudado → primeira revisão gerada (teste 12)
    expect(r.studied).toBe(true);
    const p = await student.ok('GET', '/api/planner');
    const s = p.subjects[0];
    expect(s.status).toBe('studied');
    expect(s.card).not.toBeNull();
    expect(s.card.nextReview > TODAY).toBe(true);
    expect(s.mastery.mastery).toBeCloseTo(18 / 22, 2);
    const dash = await student.ok('GET', '/api/dashboard');
    expect(dash.dominated[0].dominated).toBeGreaterThan(before);
    expect(dash.questions.accuracy).toBeCloseTo(0.85);
    expect(dash.subjects.studied).toBe(1);
    ids.firstReview = s.card.nextReview;
  });

  it('"Again" antecipa a revisão (testes 13 e 14)', async () => {
    student.today = ids.firstReview;
    const good = await student.ok('POST', `/api/reviews/${ids.subject1}`, { rating: 'good' });
    const intervalGood = good.next.interval;
    student.today = good.next.nextReview;
    const again = await student.ok('POST', `/api/reviews/${ids.subject1}`, { rating: 'again' });
    expect(again.next.interval).toBeLessThan(intervalGood);
    expect(again.next.interval).toBeLessThanOrEqual(2);
    expect(again.next.nextReview < good.next.nextReview || again.next.interval < intervalGood).toBe(true);
    ids.afterAgain = again.next.nextReview;
    ids.afterAgainDay = student.today!;
  });

  it('calendário mostra revisões e novos assuntos (teste 15)', async () => {
    student.today = TODAY;
    const cal = await student.ok('GET', '/api/reviews/calendar?from=2026-09-25&to=2026-10-31');
    const withNew = cal.days.filter((d: any) => d.newSubjects.length);
    expect(withNew.length).toBeGreaterThan(10);
    const reviewDay = cal.days.find((d: any) => d.date === ids.afterAgain);
    expect(reviewDay.reviews.some((r: any) => r.subjectId === ids.subject1)).toBe(true);
    // Nenhuma revisão prevista no dia da prova ou depois
    const late = await student.ok('GET', '/api/reviews/calendar?from=2026-11-12&to=2026-11-30');
    expect(late.days.every((d: any) => d.reviews.filter((r: any) => r.status !== 'done').length === 0)).toBe(true);
    expect(late.days.find((d: any) => d.date === '2026-11-12').exams).toEqual(['FAMERP 2027']);
  });

  it('revisões atrasadas aparecem como atrasadas (teste 16)', async () => {
    student.today = '2026-10-25';
    const t = await student.ok('GET', '/api/planner/today');
    const r = t.reviews.find((x: any) => x.subjectId === ids.subject1);
    expect(r).toBeTruthy();
    expect(r.overdueDays).toBeGreaterThan(0);
    const dash = await student.ok('GET', '/api/dashboard');
    expect(dash.reviews.overdue).toBe(1);
    const p = await student.ok('GET', '/api/planner');
    expect(p.overdueActivities).toBeGreaterThan(0);
    student.today = TODAY;
  });

  it('replanejar mantém o progresso e reorganiza a partir de hoje', async () => {
    student.today = '2026-10-25';
    await student.ok('POST', '/api/planner/replan');
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.start_date).toBe('2026-10-25');
    expect(p.subjects.find((s: any) => s.subjectId === ids.subject1).status).toBe('studied');
    const past = await ownerQuery(`select count(*)::int as n from public.study_schedule s join public.study_plans p on p.id = s.study_plan_id
                                    where p.status = 'active' and s.scheduled_date < '2026-10-25'`);
    expect(past.rows[0].n).toBe(0);
    student.today = TODAY;
  });

  it('persistência: nova sessão encontra tudo (testes 17–19)', async () => {
    const again = new Client(app);
    again.today = TODAY;
    await again.ok('POST', '/api/auth/login', { email: 'aluna@teste.com', password: 'senha-aluna-123' });
    const p = await again.ok('GET', '/api/planner');
    expect(p.subjects.find((s: any) => s.subjectId === ids.subject1).status).toBe('studied');
    const perf = await again.ok('GET', '/api/performance');
    expect(perf.subjects.find((s: any) => s.subjectId === ids.subject1).answered).toBe(20);
  });

  it('um usuário não vê os dados de outro', async () => {
    other = new Client(app);
    await other.ok('POST', '/api/auth/register', { name: 'Outro', email: 'outro@teste.com', password: 'senha-outro-123' });
    expect((await other.ok('GET', '/api/planner')).plan).toBeNull();
    expect((await other.ok('GET', '/api/performance')).logs).toEqual([]);
    const r = await other.req('POST', `/api/reviews/${ids.subject1}`, { rating: 'good' });
    expect(r.status).toBe(400);
  });
});

describe('Visitante (teste 2)', () => {
  it('usa o planner e pode converter em conta mantendo o progresso', async () => {
    const g = new Client(app);
    g.today = TODAY;
    await g.ok('POST', '/api/auth/guest');
    const me = await g.ok('GET', '/api/auth/me');
    expect(me.user.role).toBe('visitor');
    expect((await g.req('GET', '/api/admin/dashboard')).status).toBe(403);
    const s = await g.ok('GET', '/api/me/study-settings');
    await g.ok('PUT', '/api/me/study-settings', {
      profile: { start_date: TODAY, daily_hours: 2, study_days_per_week: 5, questions_per_day: 10, study_saturday: false, study_sunday: false },
      methods: s.methods.map((m: any) => ({ id: m.id, enabled: m.code === 'summary', minutes: 30 })),
    });
    await g.ok('POST', '/api/planner/generate', { editionIds: [ids.famerp2027], primaryEditionId: ids.famerp2027, startDate: TODAY });
    await g.ok('POST', '/api/auth/upgrade', { name: 'Ex-visitante', email: 'exvisitante@teste.com', password: 'senha-exvis-123' });
    const g2 = new Client(app);
    await g2.ok('POST', '/api/auth/login', { email: 'exvisitante@teste.com', password: 'senha-exvis-123' });
    expect((await g2.ok('GET', '/api/auth/me')).user.role).toBe('user');
    const p = await g2.ok('GET', '/api/planner');
    expect(p.subjects[0].checklist.map((c: any) => c.code)).toEqual(['summary']);
  });
});

describe('Multiprova (teste 4) e atualização de estatísticas (teste 25)', () => {
  it('cadastra e publica mais duas provas', async () => {
    const uel = await adm.ok('POST', '/api/admin/institutions', { name: 'Hospital Universitário da UEL', abbreviation: 'HU-UEL', state: 'PR' });
    const uelExam = await adm.ok('POST', '/api/admin/exams', { institution_id: uel.id, name: 'R1 Acesso Direto', total_questions: 100 });
    const f = importFile('uel_r1_2021-2026.json');
    const preview = await adm.ok('POST', '/api/admin/import/preview', { examId: uelExam.id, ...f });
    // Grandes áreas já existem (criadas na importação FAMERP) → não aparecem como desconhecidas
    expect(preview.unknown.some((u: any) => u.kind === 'area')).toBe(false);
    await adm.ok('POST', '/api/admin/import/commit', { examId: uelExam.id, ...f, resolutions: createAll(preview) });
    const uelNext = await adm.ok('POST', '/api/admin/editions', { exam_id: uelExam.id, year: 2027, exam_date: '2026-11-20' });

    const un = await adm.ok('POST', '/api/admin/institutions', { name: 'UNOESTE / HRPP', abbreviation: 'UNOESTE', state: 'SP' });
    const unExam = await adm.ok('POST', '/api/admin/exams', { institution_id: un.id, name: 'R1 Acesso Direto', total_questions: 100 });
    const f2 = importFile('unoeste_hrpp_r1_acesso_direto_2022-2026.json');
    const p2 = await adm.ok('POST', '/api/admin/import/preview', { examId: unExam.id, ...f2 });
    await adm.ok('POST', '/api/admin/import/commit', { examId: unExam.id, ...f2, resolutions: createAll(p2) });
    const unNext = await adm.ok('POST', '/api/admin/editions', { exam_id: unExam.id, year: 2027, exam_date: '2026-11-27' });

    for (const examId of [uelExam.id, unExam.id]) {
      const eds = await adm.ok('GET', `/api/admin/editions?examId=${examId}`);
      for (const e of eds) await adm.ok('POST', `/api/admin/editions/${e.id}/status`, { status: 'published' });
    }
    Object.assign(ids, { uelExam: uelExam.id, uel2027: uelNext.id, un2027: unNext.id });
  });

  it('gera planner combinado com três provas', async () => {
    await student.ok('POST', '/api/planner/generate', {
      editionIds: [ids.famerp2027, ids.uel2027, ids.un2027], primaryEditionId: ids.famerp2027, startDate: TODAY,
    });
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.mode).toBe('multi');
    expect(p.exams).toHaveLength(3);
    expect(p.plan.end_date).toBe('2026-11-27');
    expect(p.subjects[0].perExam).toHaveLength(3);
    // A prova mais próxima (e principal) pesa mais
    const w = p.plan.summary.weights;
    expect(w[0].weight).toBeGreaterThan(w[2].weight);
    // Progresso preservado entre planners
    const s1 = p.subjects.find((s: any) => s.subjectId === ids.subject1);
    expect(s1.status).toBe('studied');
  });

  it('adicionar questões atualiza as estatísticas', async () => {
    const before = await adm.ok('GET', `/api/admin/exams/${ids.uelExam}/stats`);
    const eds = await adm.ok('GET', `/api/admin/editions?examId=${ids.uelExam}`);
    const e2026 = eds.find((e: any) => e.year === 2026);
    const q = await adm.ok('POST', '/api/admin/questions', { exam_edition_id: e2026.id, question_number: 101, summary: 'Questão extra de teste', correct_answer: 'A' });
    const top = before.subjects[0];
    await adm.ok('PUT', `/api/admin/questions/${q.id}/subjects`, [{ subjectId: top.subjectId, weight: 1, isPrimary: true }]);
    const after = await adm.ok('GET', `/api/admin/exams/${ids.uelExam}/stats`);
    expect(after.totalQuestions).toBe(before.totalQuestions + 1);
    expect(after.subjects.find((s: any) => s.subjectId === top.subjectId).questions).toBe(top.questions + 1);
  });
});
