/**
 * Fluxo completo (seção 58) contra um Supabase local (PostgreSQL + Auth +
 * PostgREST) com RLS ativo, usando a mesma camada de dados do navegador.
 *
 * Os dados das provas entram como em produção: pelos arquivos
 * supabase/data/*.sql (o administrador os roda no SQL Editor). O aluno só
 * escolhe entre essas provas e informa data, inscrição e valor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client, dbQuery, rest, setStack, startStack, type LocalSupabase } from './helpers';

let stack: LocalSupabase;
let student: Client;
let other: Client;
const ids: Record<string, string> = {};
const TODAY = '2026-09-25';

const runDataFile = (name: string) => dbQuery(readFileSync(`supabase/data/${name}.sql`, 'utf8'));
const editionOf = async (abbr: string) =>
  (await dbQuery(`select ed.id from exam_editions ed join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
                   where i.abbreviation = $1 and ed.year = 2027`, [abbr])).rows[0].id as string;

beforeAll(async () => {
  stack = await startStack();
  setStack(stack);
}, 120_000);
afterAll(async () => stack?.stop());

describe('Base de provas (somente pelo administrador)', () => {
  it('sem cadastro, o sistema não conhece nenhuma prova', async () => {
    const guest = new Client();
    await guest.ok('POST', '/api/auth/guest');
    expect(await guest.ok('GET', '/api/exams')).toEqual([]);
  });

  it('os arquivos de dados cadastram as 3 provas e podem ser rodados de novo sem duplicar', async () => {
    for (const f of ['famerp_r1', 'uel_r1', 'unoeste_r1', 'famerp_r1']) await runDataFile(f);
    const r = await dbQuery(`select i.abbreviation, count(q.id)::int as n from questions q join exam_editions ed on ed.id = q.exam_edition_id
                              join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id group by 1 order by 1`);
    expect(r.rows).toEqual([{ abbreviation: 'FAMERP', n: 480 }, { abbreviation: 'HU-UEL', n: 550 }, { abbreviation: 'UNOESTE/HRPP', n: 500 }]);
    const unclassified = await dbQuery(`select count(*)::int as n from questions q where not exists (select 1 from question_subjects s where s.question_id = q.id)`);
    expect(unclassified.rows[0].n).toBe(0);
    Object.assign(ids, { famerp: await editionOf('FAMERP'), uel: await editionOf('HU-UEL'), unoeste: await editionOf('UNOESTE/HRPP') });
  });

  it('o aluno vê apenas as provas cadastradas, sem as edições históricas', async () => {
    student = new Client();
    student.today = TODAY;
    await student.ok('POST', '/api/auth/register', { name: 'Aluna Teste', email: 'aluna@teste.com', password: 'senha-aluna-123' });
    const list = await student.ok('GET', '/api/exams');
    expect(list.map((e: any) => e.institution).sort()).toEqual(['FAMERP', 'HU-UEL', 'UNOESTE/HRPP']);
    const f = list.find((e: any) => e.institution === 'FAMERP');
    // Datas oficiais cadastradas (fixas); sem data oficial, cada aluno informa a sua
    expect(f).toMatchObject({ exam_date: '2026-11-24', date_official: true, days_left: 60 });
    expect(list.find((e: any) => e.institution === 'UNOESTE/HRPP')).toMatchObject({ exam_date: '2026-12-05', date_official: true });
    expect(list.find((e: any) => e.institution === 'HU-UEL')).toMatchObject({ exam_date: '2026-11-08', date_official: true });
    expect(f.registration_fee).toBeNull();
    expect(f.history.editionsAnalyzed).toBe(6);
    expect(f.history.message).toBe('Análise baseada em 6 edições cadastradas.');
  });

  it('estatísticas vêm exclusivamente do banco', async () => {
    const examId = (await student.ok('GET', '/api/exams')).find((e: any) => e.institution === 'FAMERP').exam_id;
    const h = await student.ok('GET', `/api/exams/${examId}/history`);
    expect(h.totalQuestions).toBe(480);
    expect(h.subjects[0].name).toBe('Saúde do Trabalhador');
    expect(h.subjects[0].questions).toBe(30);
    expect(h.subjects[0].percentage).toBeCloseTo(30 / 480);
    expect(h.subjects[1].name).toBe('Trauma');
    expect(h.subjects[1].editionsPresent).toBe(6);
    ids.famerpExam = examId;
  });

  it('rascunhos não aparecem e alterações são auditadas', async () => {
    await dbQuery(`insert into exam_editions(exam_id, year, status) values ($1, 2030, 'draft')`, [ids.famerpExam]);
    expect((await student.ok('GET', '/api/exams')).length).toBe(3);
    await dbQuery(`update exams set total_questions = 90 where id = $1`, [ids.famerpExam]);
    await dbQuery(`update exams set total_questions = 80 where id = $1`, [ids.famerpExam]);
    const log = await dbQuery(`select * from admin_audit_logs where entity = 'exams' and action = 'update' order by id desc limit 1`);
    expect(log.rows[0].old_values.total_questions).toBe(90);
    expect(log.rows[0].new_values.total_questions).toBe(80);
    expect(log.rows[0].entity_label).toContain('FAMERP');
  });
});

describe('Segurança (RLS contra requisições forjadas)', () => {
  it('o banco recusa escrita global de alunos mesmo sem passar pelo site', async () => {
    const token = await student.accessToken();
    const me = (await student.sb.auth.getUser()).data.user!.id;
    const denied = (r: { status: number; body: any }) => r.status >= 400 && r.body?.code === '42501';
    expect(denied(await rest(token, 'POST', '/institutions', { name: 'X', abbreviation: 'XX' }))).toBe(true);
    expect((await rest(token, 'PATCH', '/exam_editions?id=not.is.null', { registration_fee: 1 })).body).toEqual([]);
    expect(denied(await rest(token, 'DELETE', '/institutions?id=not.is.null'))).toBe(true);
    expect(denied(await rest(token, 'DELETE', '/questions?id=not.is.null'))).toBe(true);
    expect(denied(await rest(token, 'POST', '/question_subjects', { question_id: me, subject_id: me }))).toBe(true);
    expect(denied(await rest(token, 'PATCH', `/user_profiles?user_id=eq.${me}`, { role: 'admin' }))).toBe(true);
    expect(denied(await rest(token, 'POST', '/admin_audit_logs', { entity: 'x', action: 'y' }))).toBe(true);
    expect(denied(await rest(token, 'POST', '/rpc/make_admin', { p_email: 'aluna@teste.com' }))).toBe(true);
    expect(denied(await rest(token, 'POST', '/rpc/import_questions', { p_exam: ids.famerpExam, p_rows: [], p_filename: 'x', p_format: 'json', p_source: null, p_total_rows: 0 }))).toBe(true);
    expect((await rest(token, 'GET', '/users')).status).toBe(404);
    expect((await rest(token, 'GET', '/exam_editions?status=eq.draft')).body).toEqual([]);
    const anon = await fetch(`${stack.url}/rest/v1/institutions`, { headers: { apikey: stack.anonKey } });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  it('dados da prova informados por um aluno não aparecem para outro', async () => {
    await student.ok('PUT', `/api/me/editions/${ids.uel}`, { registrationFee: 450 });
    other = new Client();
    other.today = TODAY;
    await other.ok('POST', '/api/auth/register', { name: 'Outro', email: 'outro@teste.com', password: 'senha-outro-123' });
    const f = (await other.ok('GET', '/api/exams')).find((e: any) => e.institution === 'HU-UEL');
    expect(f.exam_date).toBe('2026-11-08');
    expect(f.registration_fee).toBeNull();
    const token = await other.accessToken();
    expect((await rest(token, 'GET', '/user_exam_editions')).body).toEqual([]);
  });
});

describe('Aluno (testes 1–19)', () => {
  let methods: any[];

  it('informa data, inscrição e valor e seleciona a prova principal (teste 3)', async () => {
    await student.ok('PUT', `/api/me/editions/${ids.famerp}`, {
      selected: true, isPrimary: true, status: 'registered', registrationNumber: '12345',
      registrationStart: '2026-09-01', registrationEnd: '2026-10-10', registrationFee: 450,
    });
    const e = (await student.ok('GET', '/api/exams')).find((x: any) => x.edition_id === ids.famerp);
    expect(e).toMatchObject({ selected: true, is_primary: true, registration_status: 'registered', exam_date: '2026-11-24', registration_fee: 450, days_left: 60, registration_window: 'open' });
    // A data oficial não pode ser alterada pelo aluno
    expect((await student.req('PUT', `/api/me/editions/${ids.famerp}`, { examDate: '2026-11-12' })).status).toBe(400);
    const bad = await student.req('PUT', `/api/me/editions/${ids.famerp}`, { registrationStart: '2026-10-20' });
    expect(bad.status).toBe(400);
  });

  it('não gera planner sem configurar o estudo', async () => {
    const r = await student.req('POST', '/api/planner/generate', { editionIds: [ids.famerp], primaryEditionId: ids.famerp, startDate: TODAY });
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
  });

  it('gera o planner até a data informada, ordenado pela frequência histórica (teste 6)', async () => {
    await student.ok('POST', '/api/planner/generate', { editionIds: [ids.famerp], primaryEditionId: ids.famerp, startDate: TODAY });
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.end_date).toBe('2026-11-24');
    expect(p.subjects[0].name).toBe('Saúde do Trabalhador');
    expect(p.subjects[0].levelLabel).toBe('Muito alta');
    expect(p.subjects[1].name).toBe('Trauma');
    expect(p.subjects[0].checklist.map((c: any) => c.code)).toEqual(['video', 'flashcards', 'questions']);
    const load = await dbQuery(`select scheduled_date, sum(estimated_minutes)::int as m from study_schedule group by 1`);
    for (const r of load.rows) expect(r.m).toBeLessThanOrEqual(240);
    ids.subject1 = p.subjects[0].subjectId;
  });

  it('explica a posição do assunto', async () => {
    const d = await student.ok('GET', `/api/planner/subjects/${ids.subject1}`);
    expect(d.explanation).toMatch(/Saúde do Trabalhador está em #1 porque representou 6,3% das questões das 6 edições cadastradas de FAMERP/);
  });

  it('"O que estudar hoje" respeita a carga', async () => {
    const t = await student.ok('GET', '/api/planner/today');
    expect(t.newSubjects[0].name).toBe('Saúde do Trabalhador');
    expect(t.plannedMinutes).toBeLessThanOrEqual(t.capacityMinutes);
  });

  it('marca aula e flashcards (testes 7 e 8)', async () => {
    const v = methods.find((m) => m.code === 'video');
    const f = methods.find((m) => m.code === 'flashcards');
    expect((await student.ok('POST', `/api/planner/subjects/${ids.subject1}/methods/${v.id}`, { done: true })).studied).toBe(false);
    await student.ok('POST', `/api/planner/subjects/${ids.subject1}/methods/${f.id}`, { done: true });
    const s = (await student.ok('GET', '/api/planner')).subjects[0];
    expect(s.status).toBe('in_progress');
    expect(s.progress).toBeCloseTo(2 / 3);
  });

  it('assunto é concluído com as atividades escolhidas, sem exigir questões', async () => {
    const p = await student.ok('GET', '/api/planner');
    const subj = p.subjects[2];
    const video = methods.find((m) => m.code === 'video');
    const flash = methods.find((m) => m.code === 'flashcards');
    // Só Aula + Flashcards para este assunto
    await student.ok('PUT', `/api/planner/subjects/${subj.subjectId}/activities`, { methodIds: [video.id, flash.id] });
    let s = (await student.ok('GET', '/api/planner')).subjects.find((x: any) => x.subjectId === subj.subjectId);
    expect(s.checklist.map((c: any) => c.code)).toEqual(['video', 'flashcards']);
    expect(s.customActivities).toBe(true);
    await student.ok('POST', `/api/planner/subjects/${subj.subjectId}/methods/${video.id}`, { done: true });
    const r = await student.ok('POST', `/api/planner/subjects/${subj.subjectId}/methods/${flash.id}`, { done: true });
    expect(r.studied).toBe(true);
    expect(r.cardCreated).toBe(true);
    s = (await student.ok('GET', '/api/planner')).subjects.find((x: any) => x.subjectId === subj.subjectId);
    expect(s.status).toBe('studied');
    expect(s.performance.answered).toBe(0);
    // Concluir de uma vez (marca todas as atividades escolhidas) e desfazer
    const other = (await student.ok('GET', '/api/planner')).subjects[3];
    expect((await student.ok('POST', `/api/planner/subjects/${other.subjectId}/complete`, { done: true })).studied).toBe(true);
    expect((await student.ok('POST', `/api/planner/subjects/${other.subjectId}/complete`, { done: false })).studied).toBe(false);
    ids.customSubject = subj.subjectId;
  });

  it('registra 20 questões com 17 acertos e atualiza o domínio (testes 9–12)', async () => {
    const before = (await student.ok('GET', '/api/dashboard')).dominated[0].dominated;
    const r = await student.ok('POST', `/api/planner/subjects/${ids.subject1}/practice`, { questions: 20, correct: 17 });
    expect(r.performance.questions_answered).toBe(20);
    expect(r.performance.accuracy).toBeCloseTo(0.85);
    expect(r.studied).toBe(true);
    const s = (await student.ok('GET', '/api/planner')).subjects[0];
    expect(s.status).toBe('studied');
    expect(s.card.nextReview > TODAY).toBe(true);
    expect(s.mastery.mastery).toBeCloseTo(18 / 22, 2);
    const dash = await student.ok('GET', '/api/dashboard');
    expect(dash.dominated[0].dominated).toBeGreaterThan(before);
    expect(dash.nextExam).toMatchObject({ date: '2026-11-24', daysLeft: 60 });
    expect(dash.subjects.studied).toBe(2);
    ids.firstReview = s.card.nextReview;
  });

  it('"Again" antecipa a revisão (testes 13 e 14)', async () => {
    student.today = ids.firstReview;
    const good = await student.ok('POST', `/api/reviews/${ids.subject1}`, { rating: 'good' });
    student.today = good.next.nextReview;
    const again = await student.ok('POST', `/api/reviews/${ids.subject1}`, { rating: 'again' });
    expect(again.next.interval).toBeLessThan(good.next.interval);
    expect(again.next.interval).toBeLessThanOrEqual(2);
    ids.afterAgain = again.next.nextReview;
    student.today = TODAY;
  });

  it('calendário mostra revisões, novos assuntos e o dia da prova (teste 15)', async () => {
    const cal = await student.ok('GET', '/api/reviews/calendar?from=2026-09-25&to=2026-10-31');
    expect(cal.days.filter((d: any) => d.newSubjects.length).length).toBeGreaterThan(10);
    expect(cal.days.find((d: any) => d.date === ids.afterAgain).reviews.some((r: any) => r.subjectId === ids.subject1)).toBe(true);
    const late = await student.ok('GET', '/api/reviews/calendar?from=2026-11-24&to=2026-11-30');
    expect(late.days.every((d: any) => d.reviews.filter((r: any) => r.status !== 'done').length === 0)).toBe(true);
    expect(late.days.find((d: any) => d.date === '2026-11-24').exams).toEqual(['FAMERP']);
  });

  it('revisões atrasadas aparecem como atrasadas (teste 16)', async () => {
    student.today = '2026-10-26';
    const t = await student.ok('GET', '/api/planner/today');
    expect(t.reviews.some((x: any) => x.overdueDays > 0)).toBe(true);
    expect((await student.ok('GET', '/api/dashboard')).reviews.overdue).toBeGreaterThanOrEqual(1);
    expect((await student.ok('GET', '/api/planner')).overdueActivities).toBeGreaterThan(0);
  });

  it('replanejar mantém o progresso e reorganiza a partir de hoje', async () => {
    await student.ok('POST', '/api/planner/replan');
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.start_date).toBe('2026-10-26');
    expect(p.subjects.find((s: any) => s.subjectId === ids.subject1).status).toBe('studied');
    student.today = TODAY;
  });

  it('a data oficial se mantém mesmo ao replanejar', async () => {
    expect((await student.req('PUT', `/api/me/editions/${ids.famerp}`, { examDate: '2026-11-30' })).status).toBe(400);
    await student.ok('POST', '/api/planner/replan');
    expect((await student.ok('GET', '/api/planner')).plan.end_date).toBe('2026-11-24');
  });

  it('persistência: nova sessão encontra tudo (testes 17–19)', async () => {
    const again = new Client();
    again.today = TODAY;
    await again.ok('POST', '/api/auth/login', { email: 'aluna@teste.com', password: 'senha-aluna-123' });
    expect((await again.ok('GET', '/api/planner')).subjects.find((s: any) => s.subjectId === ids.subject1).status).toBe('studied');
    expect((await again.ok('GET', '/api/performance')).subjects.find((s: any) => s.subjectId === ids.subject1).answered).toBe(20);
  });

  it('um usuário não vê nem altera os dados de outro', async () => {
    expect((await other.ok('GET', '/api/planner')).plan).toBeNull();
    expect((await other.ok('GET', '/api/performance')).logs).toEqual([]);
    expect((await other.req('POST', `/api/reviews/${ids.subject1}`, { rating: 'good' })).status).toBe(400);
  });
});

describe('Visitante (teste 2)', () => {
  it('usa o planner e pode criar conta mantendo o progresso', async () => {
    const g = new Client();
    g.today = TODAY;
    await g.ok('POST', '/api/auth/guest');
    expect((await g.ok('GET', '/api/auth/me')).user.role).toBe('visitor');
    const s = await g.ok('GET', '/api/me/study-settings');
    await g.ok('PUT', '/api/me/study-settings', {
      profile: { start_date: TODAY, daily_hours: 2, study_days_per_week: 5, questions_per_day: 10, study_saturday: false, study_sunday: false },
      methods: s.methods.map((m: any) => ({ id: m.id, enabled: m.code === 'summary', minutes: 30 })),
    });
    await g.ok('POST', '/api/planner/generate', { editionIds: [ids.uel], primaryEditionId: ids.uel, startDate: TODAY });
    await g.ok('POST', '/api/auth/upgrade', { name: 'Ex-visitante', email: 'exvisitante@teste.com', password: 'senha-exvis-123' });
    const g2 = new Client();
    await g2.ok('POST', '/api/auth/login', { email: 'exvisitante@teste.com', password: 'senha-exvis-123' });
    expect((await g2.ok('GET', '/api/auth/me')).user.role).toBe('user');
    expect((await g2.ok('GET', '/api/planner')).subjects[0].checklist.map((c: any) => c.code)).toEqual(['summary']);
  });
});

describe('Multiprova (teste 4) e atualização de estatísticas (teste 25)', () => {
  it('gera planner combinado com as três provas, cada uma com a data do aluno', async () => {
    await student.ok('POST', '/api/planner/generate', {
      editionIds: [ids.famerp, ids.uel, ids.unoeste], primaryEditionId: ids.famerp, startDate: TODAY,
    });
    const p = await student.ok('GET', '/api/planner');
    expect(p.plan.mode).toBe('multi');
    expect(p.exams).toHaveLength(3);
    expect(p.plan.end_date).toBe('2026-12-05');
    expect(p.subjects[0].perExam).toHaveLength(3);
    expect(p.subjects.find((s: any) => s.subjectId === ids.subject1).status).toBe('studied');
  });

  it('adicionar questões (pelo administrador, via SQL) atualiza as estatísticas', async () => {
    const before = await student.ok('GET', `/api/exams/${ids.famerpExam}/history`);
    const top = before.subjects[0];
    await dbQuery(`insert into questions(exam_edition_id, question_number, summary, correct_answer)
                   select id, 81, 'Questão extra de teste', 'A' from exam_editions where exam_id = $1 and year = 2026`, [ids.famerpExam]);
    await dbQuery(`insert into question_subjects(question_id, subject_id) select q.id, $2 from questions q
                   join exam_editions ed on ed.id = q.exam_edition_id where ed.exam_id = $1 and ed.year = 2026 and q.question_number = 81`,
      [ids.famerpExam, top.subjectId]);
    const after = await student.ok('GET', `/api/exams/${ids.famerpExam}/history`);
    expect(after.totalQuestions).toBe(481);
    expect(after.subjects[0].questions).toBe(31);
  });
});

describe('Planner dinâmico: fila de estudo, fila de revisões e observações', () => {
  const pendingByDate = (cal: any) => {
    const m = new Map<string, string>();
    for (const d of cal.days) for (const n of d.newSubjects) if (!n.done && !m.has(n.subjectId)) m.set(n.subjectId, d.date);
    return m;
  };

  it('tarefa adiantada fica no dia em que foi feita e as seguintes sobem', async () => {
    student.today = TODAY;
    const from = TODAY, to = '2026-10-20';
    const before = await student.ok('GET', `/api/reviews/calendar?from=${from}&to=${to}`);
    const old = pendingByDate(before);
    // Primeiro assunto planejado para depois de hoje
    const future = [...old.entries()].filter(([, d]) => d > TODAY).sort((a, b) => a[1].localeCompare(b[1]));
    const [x, xDate] = future[0];
    const [y, yDate] = future.find(([, d]) => d > xDate)!;
    await student.ok('POST', `/api/planner/subjects/${x}/complete`, { done: true });
    const after = await student.ok('GET', `/api/reviews/calendar?from=${from}&to=${to}`);
    // Registrada hoje, concluída; não continua no dia original
    const today = after.days.find((d: any) => d.date === TODAY);
    expect(today.newSubjects.find((n: any) => n.subjectId === x)).toMatchObject({ done: true });
    expect(after.days.find((d: any) => d.date === xDate).newSubjects.some((n: any) => n.subjectId === x)).toBe(false);
    // O próximo da fila não fica para depois (ocupa o espaço liberado)
    expect(pendingByDate(after).get(y)! <= yDate).toBe(true);
    // O que estava planejado para hoje continua hoje
    for (const [id, d] of old) if (d === TODAY && id !== x) expect(pendingByDate(after).get(id)).toBe(TODAY);
  });

  it('revisões por dia seguem a escolha do aluno e adiantar revisões reorganiza a fila', async () => {
    const s = await student.ok('GET', '/api/me/study-settings');
    await student.ok('PUT', '/api/me/study-settings', {
      profile: { ...s.profile, reviews_per_day: 1, preferred_start_time: null, preferred_end_time: null },
      methods: s.methods.map((m: any) => ({ id: m.id, enabled: m.enabled, minutes: m.estimated_minutes })),
    });
    expect((await student.ok('GET', '/api/me/study-settings')).profile.reviews_per_day).toBe(1);
    // Vários assuntos concluídos → vários cartões
    const p = await student.ok('GET', '/api/planner');
    for (const subj of p.subjects.filter((x: any) => x.status !== 'studied').slice(0, 3)) {
      await student.ok('POST', `/api/planner/subjects/${subj.subjectId}/complete`, { done: true });
    }
    student.today = '2026-11-16';
    const cal = await student.ok('GET', '/api/reviews/calendar?from=2026-11-16&to=2026-11-23');
    for (const d of cal.days) expect(d.reviews.filter((r: any) => r.status !== 'done').length).toBeLessThanOrEqual(1);
    const t = await student.ok('GET', '/api/planner/today');
    expect(t.reviews).toHaveLength(1);
    expect(t.nextReviews.length).toBeGreaterThan(0);
    // Faz a de hoje e adianta a próxima
    const first = t.reviews[0].subjectId, early = t.nextReviews[0].subjectId;
    await student.ok('POST', `/api/reviews/${first}`, { rating: 'good' });
    await student.ok('POST', `/api/reviews/${early}`, { rating: 'good' });
    const after = await student.ok('GET', '/api/reviews/calendar?from=2026-11-16&to=2026-11-23');
    const today = after.days.find((d: any) => d.date === '2026-11-16');
    expect(today.reviews.filter((r: any) => r.status === 'done').map((r: any) => r.subjectId).sort()).toEqual([first, early].sort());
    // Nada duplicado: as revisões feitas não reaparecem como pendentes nos próximos dias
    const pendingLater = after.days.slice(1).flatMap((d: any) => d.reviews.filter((r: any) => r.status !== 'done').map((r: any) => r.subjectId));
    expect(pendingLater.filter((id: string) => id === early && id !== first).length).toBeLessThanOrEqual(1);
    expect((await student.ok('GET', '/api/planner/today')).reviews).toHaveLength(0);
    student.today = TODAY;
  });

  it('observações da semana são do próprio aluno', async () => {
    await student.ok('PUT', '/api/notes/2026-09-21', { content: 'Focar mais em cardiologia.' });
    expect((await student.ok('GET', '/api/notes/2026-09-21')).content).toBe('Focar mais em cardiologia.');
    expect((await other.ok('GET', '/api/notes/2026-09-21')).content).toBe('');
  });
});

describe('FAMEMA (relatório sem anexo questão a questão)', () => {
  it('entra com 600 questões, data oficial e só as classificações que o relatório dá', async () => {
    await runDataFile('famema_r1');
    await runDataFile('famema_r1');
    const r = await dbQuery(`select count(distinct q.id)::int as n, count(distinct qs.question_id)::int as c from questions q
      join exam_editions ed on ed.id = q.exam_edition_id join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
      left join question_subjects qs on qs.question_id = q.id where i.abbreviation = 'FAMEMA'`);
    expect(r.rows[0]).toEqual({ n: 600, c: 433 });
    const list = await student.ok('GET', '/api/exams');
    const f = list.find((e: any) => e.institution === 'FAMEMA');
    expect(f).toMatchObject({ exam_date: '2026-12-08', date_official: true });
    const h = await student.ok('GET', `/api/exams/${f.exam_id}/history`);
    expect(h.totalQuestions).toBe(600);
    expect(h.editionsAnalyzed).toBe(6);
    expect(h.subjects[0].name).toBe('Perioperatório e princípios cirúrgicos');
    expect(h.subjects[0].questions).toBe(24);
    expect(h.subjects[0].percentage).toBeCloseTo(24 / 600);
    const cirrose = h.subjects.find((s: any) => s.name === 'Cirrose e complicações');
    expect(cirrose).toMatchObject({ questions: 6, editionsPresent: 6 });
    // Questão contada em dois assuntos (HPV: imunização + prevenção do colo) divide o peso
    const hpv = await dbQuery(`select count(*)::int as n from question_subjects qs join questions q on q.id = qs.question_id
      join exam_editions ed on ed.id = q.exam_edition_id join exams e on e.id = ed.exam_id join institutions i on i.id = e.institution_id
      where i.abbreviation = 'FAMEMA' and ed.year = 2022 and q.question_number = 2`);
    expect(hpv.rows[0].n).toBe(2);
  });
});
