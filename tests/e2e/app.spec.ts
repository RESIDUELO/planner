/**
 * Testes E2E no navegador (seção 58), com o site compilado em /planner/ como
 * no GitHub Pages e as provas carregadas pelos arquivos supabase/data/*.sql.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const student = { name: 'Aluna E2E', email: `aluna${Date.now()}@e2e.test`, password: 'senha-aluna-123' };
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));
const HOME = /\/planner\/planner$/;

/** Sem prova o planner abre vazio; o cronograma de uma prova é opcional. */
/** Tela das provas: aparece sozinha na primeira vez; num planner montado do zero, pelo link abaixo dos assuntos. */
async function openSetup(page: Page) {
  const first = page.getByTestId('scratch'), later = page.getByTestId('choose-exam');
  await expect(first.or(later)).toBeVisible();
  if (await later.isVisible()) await later.click();
}

async function login(page: Page, email: string, password: string) {
  await page.goto('login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(HOME);
}

test('tela de login mostra as três opções', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveURL(/\/planner\/login/);
  await expect(page.getByRole('heading', { name: 'Planner', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Criar conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar como visitante' })).toBeVisible();
  await expect(page).toHaveTitle('Planner Pablo e Samêla');
});

test('TESTE 1 — criar conta leva direto ao Planner, sem tela de passos', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(student.name);
  await page.getByLabel('E-mail').fill(student.email);
  await page.getByLabel('Senha').fill(student.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(HOME);
  // Primeira vez: as provas (cronograma automático) ou montar do zero
  await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
  await expect(page.getByTestId('scratch')).toBeVisible();
  await expect(page.getByText('Qual prova você vai fazer?')).toBeVisible();
  await expect(page.getByText('Receba seu planner')).toHaveCount(0);
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(4);
  for (const i of ['FAMERP', 'FAMEMA', 'HU-UEL', 'UNOESTE/HRPP']) await expect(page.getByTestId(`exam-${i}`)).toBeVisible();
  await page.getByTestId('exam-FAMERP').locator('button').first().click();
  await expect(page.getByTestId('exam-FAMERP')).toContainText('Análise baseada em 6 edições cadastradas.');
});

test('TESTE 20 — não existe área administrativa no site', async ({ page }) => {
  await login(page, student.email, student.password);
  await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
  await page.goto('admin');
  await expect(page).toHaveURL(HOME);
});

test('datas oficiais fixas; inscrição e valor são do aluno (teste 3)', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('provas');
  const card = page.getByTestId('exam-FAMERP');
  await expect(card).toContainText('24 nov 2026');
  await expect(page.getByTestId('exam-UNOESTE/HRPP')).toContainText('5 dez 2026');
  await card.locator('button').first().click();
  await card.getByRole('button', { name: 'Adicionar à minha preparação' }).click();
  await expect(card).toContainText('data oficial');
  await expect(card.getByLabel('Data da prova - FAMERP')).toHaveCount(0);
  await card.getByRole('button', { name: 'Inscrição, valor e mais' }).click();
  await card.getByLabel('Valor (R$) - FAMERP').fill('450');
  await card.getByLabel('Valor (R$) - FAMERP').blur();
  await expect(card.getByText('Salvo')).toBeVisible();
  await expect(card).toContainText('principal');
});

test('TESTES 3, 5–12 — planner em duas colunas, fila dinâmica, Pomodoro e checklist', async ({ page }) => {
  await login(page, student.email, student.password);
  await openSetup(page);
  await expect(page.getByLabel(/Selecionar FAMERP/)).toBeChecked();
  // Uma tela só: prova e (opcionalmente) como estuda; tempo fica em "Opções avançadas"
  await expect(page.getByText('Como você estuda?')).toBeVisible();
  await expect(page.getByLabel('Videoaula')).toBeChecked();
  await expect(page.getByText('Horas por dia')).toHaveCount(0);
  await page.getByRole('button', { name: 'Criar meu planner' }).click();

  const today = page.getByTestId(`day-${inDays(0)}`);
  await expect(today.getByTestId('col-subjects').getByTestId('task').first()).toBeVisible();
  await expect(today.getByTestId('col-reviews')).toContainText('Revisões');
  await expect(today.getByText('Saúde do Trabalhador')).toBeVisible();
  await expect(today).not.toContainText('min');

  // Adiantar: uma tarefa de outro dia concluída hoje aparece hoje, como feita
  // (procura nesta semana e, se não houver mais dias de aula nela, na próxima)
  let future = null as null | { name: string };
  for (let n = 1; n <= 9 && !future; n++) {
    if (!(await page.getByTestId(`day-${inDays(n)}`).count())) {
      await page.getByRole('button', { name: 'Próxima semana' }).click();
      await expect(page.getByTestId(`day-${inDays(n)}`)).toBeVisible();
    }
    const t = page.getByTestId(`day-${inDays(n)}`).getByTestId('task').first();
    if (await t.count()) {
      const name = (await t.getByTestId('task-name').textContent())!.trim();
      await t.getByRole('checkbox').click();
      await expect(t.getByRole('checkbox')).toHaveCount(0, { timeout: 5000 }).catch(() => {});
      future = { name };
    }
  }
  expect(future).not.toBeNull();
  if (await page.getByRole('button', { name: 'voltar para esta semana' }).count()) await page.getByRole('button', { name: 'voltar para esta semana' }).click();
  const moved = today.getByTestId('task').filter({ hasText: future!.name });
  await expect(moved.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  // Observações da semana: folha pautada, letra de forma, salva sozinha
  const notes = page.getByLabel('Observações da semana', { exact: true }).locator('textarea').or(page.getByRole('textbox', { name: 'Observações da semana' }));
  await notes.fill('Focar mais em cardiologia.');
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  expect(await notes.evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Patrick Hand');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Observações da semana' })).toHaveValue('Focar mais em cardiologia.');

  // Workspace: semana, assuntos, calendário e desempenho na mesma tela; sem barra de navegação
  await expect(page.getByRole('region', { name: 'Assuntos' })).toBeVisible();
  await expect(page.getByTestId('planner-calendar').getByRole('region', { name: 'Calendário' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Foco' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Provas' })).toHaveCount(0);

  // Pomodoro a partir da tarefa: abre o foco por cima, sem sair da página
  await page.getByTestId(`day-${inDays(0)}`).getByRole('button', { name: 'Iniciar Pomodoro - Saúde do Trabalhador' }).click();
  const focus = page.getByRole('dialog', { name: 'Foco' });
  await expect(focus).toBeVisible();
  await expect(page).toHaveURL(HOME);
  await expect(focus.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
  await expect(focus.getByRole('button', { name: 'Saúde do Trabalhador' })).toBeVisible();
  await focus.getByRole('button', { name: 'Pausar' }).click();
  await focus.getByRole('tab', { name: '50/10' }).click();
  await expect(focus.getByRole('timer')).toHaveText('50:00');
  await focus.getByRole('tab', { name: '25/5' }).click();
  await page.keyboard.press('Escape');
  await expect(focus).toHaveCount(0);

  // Lista completa de assuntos pelo menu da semana
  await page.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: 'Todos os assuntos' }).click();
  const card = page.getByTestId('subject-card').first();
  await expect(card).toContainText('Saúde do Trabalhador');
  await card.click();

  // Concluído = todas as atividades escolhidas, sem exigir questões
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('subject-status')).toHaveText('0 de 2 atividades');
  await dialog.getByRole('checkbox', { name: /Videoaula/ }).click();
  await expect(dialog.getByTestId('subject-status')).toHaveText('1 de 2 atividades');
  await dialog.getByRole('checkbox', { name: /Flashcards/ }).click();
  await expect(dialog.getByTestId('subject-status')).toHaveText('✓ Concluído');
  await expect(dialog.getByText(/Assunto concluído/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Opções avançadas' }).click();
  await dialog.getByRole('button', { name: 'Por que este assunto?' }).click();
  await expect(dialog).toContainText('representou 6,3% das questões das 6 edições cadastradas');
  await dialog.getByRole('spinbutton', { name: 'Questões feitas' }).fill('20');
  await dialog.getByRole('spinbutton', { name: 'Acertos' }).fill('17');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByText('Questões registradas.')).toBeVisible();
  // Registro errado pode ser desfeito na hora (ou excluído na lista)
  await expect(dialog.getByRole('button', { name: 'Desfazer' })).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Questões feitas' }).fill('100');
  await dialog.getByRole('spinbutton', { name: 'Acertos' }).fill('10');
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByRole('list', { name: 'Registros de questões' }).getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Desfazer' }).click();
  await expect(dialog.getByRole('list', { name: 'Registros de questões' }).getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByText('Registro de questões excluído.')).toBeVisible();
  await expect(dialog.getByText('85%')).toBeVisible();
  // Quanto da prova: assunto concluído garante a fatia dele (6,3% = ~5 de 80 questões)
  await dialog.getByRole('button', { name: 'Quanto da prova' }).click();
  await expect(dialog.getByText('Assunto concluído: a fatia dele na prova conta como garantida.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('6,3%').first()).toBeVisible();
  await expect(dialog.getByText('Próxima revisão')).toBeVisible();
});

test('TESTES 15, 17–19 — calendário e persistência após fechar o navegador', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, student.email, student.password);
  await page.goto('revisoes');
  await expect(page.getByText('Próximos dias')).toBeVisible();
  await page.getByRole('button', { name: 'Calendário' }).click();
  await expect(page.getByTestId(`day-${inDays(0)}`)).toBeVisible();
  await ctx.close();

  const again = await browser.newContext();
  const p2 = await again.newPage();
  await login(p2, student.email, student.password);
  await expect(p2.getByText(/FAMERP · 24 nov 2026/)).toBeVisible();
  await expect(p2.getByRole('textbox', { name: 'Observações da semana' })).toHaveValue('Focar mais em cardiologia.');
  await p2.goto('desempenho');
  await expect(p2.getByText('85%', { exact: true })).toBeVisible();
  await expect(p2.getByText('de acertos em 20 questões')).toBeVisible();
  await expect(p2.getByText('Você já garantiu')).toBeVisible();
  await again.close();
});

test('TESTE 2 — visitante escolhe prova e usa o sistema', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);
  await expect(page.getByText('Você está no modo visitante')).toBeVisible();
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(4);
  // A escolha da outra aluna não aparece para o visitante
  await expect(page.getByText('Você ainda não escolheu uma prova.')).toBeVisible();
  await expect(page.getByTestId('exam-FAMERP')).toContainText('Adicionar');

  // Sem configuração: prova → planner → marcar a primeira tarefa
  await page.goto('planner');
  await openSetup(page);
  await page.locator('label', { has: page.getByLabel(/Selecionar FAMERP/) }).click();
  await expect(page.getByLabel(/Selecionar FAMERP/)).toBeChecked();
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  const task = page.getByTestId(`day-${inDays(0)}`).getByTestId('task').first();
  const circle = task.getByRole('checkbox');
  await expect(circle).toHaveAttribute('aria-checked', 'false');
  await circle.click();
  await expect(circle).toHaveAttribute('aria-checked', 'true');

  // Arrastar: aula de segunda (próxima semana) para terça; aula não entra em Revisões
  const wd = new Date(`${inDays(0)}T12:00:00Z`).getUTCDay();
  const mon = ((8 - wd) % 7) || 7;
  await page.getByRole('button', { name: 'Próxima semana' }).click();
  const src = page.getByTestId(`day-${inDays(mon)}`).getByTestId('task').first();
  await expect(src).toBeVisible();
  const name = (await src.getByTestId('task-name').textContent())!.trim();
  await src.dragTo(page.getByTestId(`day-${inDays(mon + 1)}`).getByTestId('col-reviews'));
  await expect(page.getByTestId(`day-${inDays(mon)}`).getByTestId('col-subjects')).toContainText(name);
  const target = page.getByTestId(`day-${inDays(mon + 1)}`).getByTestId('col-subjects');
  // A aula muda de dia na hora, mesmo com a internet lenta (o servidor confirma depois)
  const slow = (r: any) => setTimeout(() => r.continue().catch(() => {}), 2500);
  await page.route('**/rest/v1/**', slow);
  await src.dragTo(target);
  await expect(target).toContainText(name, { timeout: 800 });
  await expect(page.getByTestId(`day-${inDays(mon)}`).getByTestId('col-subjects')).not.toContainText(name, { timeout: 800 });
  await page.unroute('**/rest/v1/**', slow);
  await expect(target).toContainText(name);
  await expect(page.getByTestId(`day-${inDays(mon)}`).getByTestId('col-subjects')).not.toContainText(name);

  // Arrastar da lista de Assuntos para um dia da semana
  const libItem = page.getByTestId('library-item').filter({ hasNotText: name }).nth(5);
  const libName = (await libItem.locator('button span').first().textContent())!.trim();
  const dropDay = page.getByTestId(`day-${inDays(mon)}`).getByTestId("col-subjects");
  await page.route('**/rest/v1/**', slow);
  await libItem.dragTo(dropDay);
  await expect(page.getByText(`✓ ${libName} adicionado a`, { exact: false })).toBeVisible({ timeout: 800 });
  await expect(dropDay).toContainText(libName, { timeout: 800 });
  await page.unroute('**/rest/v1/**', slow);
  await expect(dropDay).toContainText(libName);

  // Soltar no calendário ao lado: vai para aquele dia (o calendário só tem os números)
  const cal = page.getByTestId('planner-calendar');
  const calDay = inDays(mon + 9);
  if (!(await cal.locator(`[data-date="${calDay}"]`).count())) await cal.getByRole('button', { name: 'Próximo mês' }).click();
  const libItem2 = page.getByTestId('library-item').filter({ hasNotText: name }).filter({ hasNotText: libName }).nth(3);
  const libName2 = (await libItem2.locator('button span').first().textContent())!.trim();
  await libItem2.dragTo(cal.locator(`[data-date="${calDay}"]`));
  await expect(page.getByText(`✓ ${libName2} adicionado a`, { exact: false })).toBeVisible();
  await expect(cal).not.toContainText(libName2);
  // Na folha do assunto aparece o dia da aula, e dá para trocar ali
  await page.getByTestId('library-item').filter({ hasText: libName2 }).locator('button').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('subject-dates')).toContainText(`${Number(calDay.slice(8))}`);
  await sheet.getByLabel('Aula - dia').fill(inDays(mon + 1));
  await expect(sheet.getByText('Aula marcada para', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(target).toContainText(libName2);

  // Excluir do planner: some da semana, continua nos assuntos
  await target.getByTestId('task').filter({ hasText: name }).getByTestId('task-name').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir do planner' }).click();
  await expect(page.getByRole('dialog').getByText('Fora do planner:', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(target).not.toContainText(name);

  // Provas, Revisões e Configurações ficam no menu do perfil
  await page.getByRole('button', { name: 'Perfil' }).click();
  for (const item of ['Provas', 'Revisões', 'Configurações', 'Sair']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Revisões' }).click();
  await expect(page).toHaveURL(/\/revisoes$/);
  await page.getByRole('link', { name: 'Planner', exact: true }).click();
  await expect(page).toHaveURL(HOME);

  // Zerar o perfil: volta ao início, como uma conta nova
  await page.goto('configuracoes');
  await page.getByRole('button', { name: 'Zerar meu perfil' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zerar tudo' }).click();
  await expect(page).toHaveURL(HOME);
  await openSetup(page);
  await expect(page.getByText('Qual prova você vai fazer?')).toBeVisible();
  await expect(page.getByLabel(/Selecionar FAMERP/)).not.toBeChecked();
});

test('Agenda — tarefa com "Mostrar no Planner" é a mesma nos dois lugares; Planner tem Dia | Semana', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);
  await openSetup(page);
  await page.locator('label', { has: page.getByLabel(/Selecionar FAMERP/) }).click();
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  await expect(page.getByTestId(`day-${inDays(0)}`)).toBeVisible();

  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await page.getByTestId('add-day-task').click();
  await page.keyboard.type('Enviar documentação da residência');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByTestId('add-general').click();
  await page.keyboard.type('Comprar jaleco novo');
  await page.keyboard.press('Enter');
  const row = page.getByRole('group', { name: 'Tarefas do dia' }).getByTestId('agenda-task');
  await expect(row).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Tarefas a fazer' }).getByTestId('agenda-task')).toHaveCount(1);

  // Sem a opção, não aparece no Planner
  await page.getByRole('link', { name: 'Planner', exact: true }).click();
  await expect(page.getByTestId(`day-${inDays(0)}`)).toBeVisible();
  await expect(page.getByTestId('planner-agenda')).toHaveCount(0);

  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await row.getByRole('button', { name: 'Enviar documentação da residência' }).click();
  await page.locator('label', { hasText: 'Mostrar no Planner' }).click();
  await page.getByRole('button', { name: 'Salvar' }).click();

  await page.getByRole('link', { name: 'Planner', exact: true }).click();
  const inPlanner = page.getByTestId(`day-${inDays(0)}`).getByTestId('planner-agenda');
  await expect(inPlanner).toContainText('Enviar documentação da residência');
  await expect(page.getByTestId(`day-${inDays(0)}`).getByTestId('task-name')).not.toContainText(['Enviar documentação da residência']);
  await inPlanner.getByRole('checkbox').click();
  await expect(inPlanner.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  // Dia | Semana
  await page.getByRole('tab', { name: 'Dia' }).click();
  await expect(page.getByTestId(/^day-/)).toHaveCount(1);
  await page.getByRole('button', { name: 'Próximo dia' }).click();
  await expect(page.getByTestId(`day-${inDays(1)}`)).toBeVisible();
  await page.getByRole('button', { name: 'voltar para hoje' }).click();
  await expect(page.getByTestId(`day-${inDays(0)}`)).toBeVisible();
  await page.getByRole('tab', { name: 'Semana' }).click();
  await expect(page.getByTestId(/^day-/)).toHaveCount(7);

  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
});

test('Planner sem prova: montar à mão com "+", assunto próprio e da prova no mesmo dia', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);
  await expect(page.getByText('Qual prova você vai fazer?')).toBeVisible();
  await page.getByTestId('scratch').click();
  await expect(page.getByText('Meu planner')).toBeVisible();
  await expect(page.getByTestId('choose-exam')).toHaveText('Escolher prova para montar cronograma');

  // Planner vazio: "+" num dia → novo assunto
  // Hoje sempre está na semana aberta
  const tomorrow = page.getByTestId(`day-${inDays(0)}`);
  await tomorrow.getByTestId('add-subject').click();
  await page.getByLabel('Nome do assunto').fill('Síndrome de Brugada');
  await page.getByRole('button', { name: 'Clínica' }).click();
  await page.getByRole('button', { name: 'Adicionar ao Planner' }).click();
  await expect(tomorrow.getByTestId('task-name')).toHaveText(['Síndrome de Brugada']);
  await expect(page.getByTestId('library-item')).toHaveCount(1);

  // Funciona como os outros: concluir no dia
  await tomorrow.getByTestId('task').getByRole('checkbox').click();
  await expect(tomorrow.getByTestId('task').getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');

  // Depois escolhe uma prova: o assunto próprio continua no dia e dá para somar um da prova
  await openSetup(page);
  await page.locator('label', { has: page.getByLabel(/Selecionar FAMERP/) }).click();
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  const day2 = page.getByTestId(`day-${inDays(0)}`);
  await expect(day2).toBeVisible();
  const before = await day2.getByTestId('task-name').allTextContents();
  await day2.getByTestId('add-subject').click();
  await page.getByLabel('Pesquisar assunto').fill('pneumonia');
  await page.getByTestId('add-pick').first().click();
  await expect(day2.getByTestId('task-name')).toHaveCount(before.length + 1);
  for (const n of before) await expect(day2.getByTestId('task-name').filter({ hasText: n })).toHaveCount(1);
  await day2.getByTestId('add-subject').click();
  await page.getByTestId('add-create').click();
  await page.getByLabel('Nome do assunto').fill('Revisar ECG');
  await page.getByRole('button', { name: 'Adicionar ao Planner' }).click();
  await expect(day2.getByTestId('task-name').filter({ hasText: 'Revisar ECG' })).toHaveCount(1);

  // Editar e excluir o assunto próprio pela folha do assunto
  await day2.getByTestId('task-name').filter({ hasText: 'Revisar ECG' }).click();
  await page.getByRole('button', { name: 'Editar assunto' }).click();
  await page.getByLabel('Nome do assunto').fill('ECG - revisão');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'ECG - revisão' })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir assunto' }).click();
  await page.getByRole('button', { name: 'Excluir de vez' }).click();
  await expect(day2.getByTestId('task-name').filter({ hasText: 'ECG' })).toHaveCount(0);
});

test('Residências: cadastro, selo, prazos na Agenda e no Planner, "não vou" no fim', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);
  await page.getByTestId('scratch').click();
  await expect(page.getByTestId('choose-exam')).toBeVisible();

  await page.getByRole('link', { name: 'Residências', exact: true }).click();
  await expect(page.getByText('Nenhuma residência ainda.')).toBeVisible();

  // Nova residência: dados, especialidade, período de inscrição e ligação com a prova de Provas
  await page.getByTestId('new-residency').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Nome da residência').fill('FAMEMA');
  await sheet.getByLabel('Cidade', { exact: true }).fill('Marília');
  await sheet.getByRole('button', { name: 'Adicionar especialidade' }).click();
  await sheet.getByLabel('Especialidade', { exact: true }).fill('Radiologia');
  await sheet.getByLabel('Vagas', { exact: true }).fill('3');
  await sheet.getByLabel('Nota de corte', { exact: true }).fill('66/100');
  await expect(sheet.getByTestId('step')).toHaveCount(11);
  await expect(sheet.getByTestId('step').filter({ hasText: 'Gabarito' })).toContainText('a divulgar');
  await sheet.getByLabel('Inscrição - início', { exact: true }).fill(inDays(-5));
  await sheet.getByLabel('Inscrição - fim', { exact: true }).fill(inDays(3));
  // Etapa que não existe nesta residência sai; etapa nova entra
  await sheet.getByRole('button', { name: 'Remover etapa Gabarito' }).click();
  await sheet.getByLabel('Nova etapa').fill('Entrega de documentos');
  await sheet.getByRole('tab', { name: 'Resultado' }).click();
  await sheet.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(sheet.getByTestId('step')).toHaveCount(11);
  await sheet.getByLabel('Prova em Provas').selectOption({ label: 'FAMEMA · R1 Acesso Direto' });
  await expect(sheet.getByTestId('step').filter({ hasText: /^Prova/ })).toContainText('8 dez 2026');
  await sheet.getByRole('button', { name: 'Salvar' }).click();
  await expect(sheet).toBeHidden();

  const card = page.getByTestId('residency-FAMEMA');
  await expect(card).toContainText('Radiologia 3 vagas, corte 66/100');
  await expect(card.getByTestId('status').first()).toHaveText('inscrições abertas · fecham em 3 dias');
  await expect(card.getByTestId('next-deadline')).toContainText('fim da inscrição');
  await expect(card.getByRole('link', { name: 'ver em Provas' })).toBeVisible();
  await expect(page.getByTestId('upcoming').getByTestId('residency-event').first()).toContainText('FAMEMA - fim da inscrição');

  // Uma segunda, com várias instituições
  await page.getByTestId('new-residency').click();
  await sheet.getByLabel('Nome da residência').fill('ENARE');
  await sheet.getByText('Prova com várias instituições').click();
  await sheet.getByLabel('Instituição', { exact: true }).fill('Santa Casa de Votuporanga');
  await sheet.getByLabel('Prova - dia', { exact: true }).fill(inDays(40));
  await sheet.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByTestId('residency-ENARE')).toContainText('1 instituição');
  await expect(page.locator('article[data-testid^="residency-"]')).toHaveCount(2);

  // Agenda: marcador no dia e a lista do dia; Próximos prazos ao lado
  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Próximos prazos' })).toContainText('FAMEMA - fim da inscrição');
  const cal = page.getByRole('region', { name: 'Calendário' });
  const end = inDays(3);
  if (!(await cal.locator(`[data-date="${end}"]`).count())) await cal.getByRole('button', { name: 'Próximo mês' }).click();
  await expect(cal.locator(`[data-date="${end}"] [data-mark="residency-inscricao"]`)).toHaveCount(1);
  await cal.locator(`[data-date="${end}"]`).click();
  await expect(page.getByRole('group', { name: 'Residências do dia' })).toContainText('FAMEMA - fim da inscrição');

  // Planner: linha discreta com o prazo mais próximo; clicar leva à residência
  await page.getByRole('link', { name: 'Planner', exact: true }).click();
  await expect(page.getByTestId('deadline-line')).toHaveText('Inscrição FAMEMA termina em 3 dias');
  // E cada prazo aparece no dia dele, na semana do Planner
  if (!(await page.getByTestId(`day-${end}`).count())) await page.getByRole('button', { name: 'Próxima semana' }).click();
  await expect(page.getByTestId(`day-${end}`).getByTestId('planner-residency')).toHaveText('FAMEMA - fim da inscrição');
  await page.getByTestId('deadline-line').click();
  await expect(page).toHaveURL(/residencias\?r=/);
  await expect(page.getByRole('dialog').getByLabel('Nome da residência')).toHaveValue('FAMEMA');

  // "Não vou": vai para o fim, apagada, e sai dos prazos
  await page.getByRole('dialog').getByRole('tab', { name: 'Não vou' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('article[data-testid^="residency-"]').last()).toHaveAttribute('data-testid', 'residency-FAMEMA');
  await expect(page.getByTestId('residency-FAMEMA').getByTestId('status').first()).toHaveText('não vou');
  await expect(page.getByTestId('upcoming')).not.toContainText('FAMEMA');

  // Continua lá depois de recarregar
  await page.reload();
  await expect(page.locator('article[data-testid^="residency-"]')).toHaveCount(2);
});
