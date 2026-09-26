/**
 * Testes E2E no navegador (seção 58), com o site compilado em /planner/ como
 * no GitHub Pages e as provas carregadas pelos arquivos supabase/data/*.sql.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const student = { name: 'Aluna E2E', email: `aluna${Date.now()}@e2e.test`, password: 'senha-aluna-123' };
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));
const HOME = /\/planner\/planner$/;

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
  await expect(page.getByRole('heading', { name: 'Residência', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Criar conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar como visitante' })).toBeVisible();
  await expect(page).toHaveTitle('Residência Planner');
});

test('TESTE 1 — criar conta leva direto ao Planner, sem tela de passos', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(student.name);
  await page.getByLabel('E-mail').fill(student.email);
  await page.getByLabel('Senha').fill(student.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(HOME);
  await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
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
  await expect(card.getByLabel('Data da prova — FAMERP')).toHaveCount(0);
  await card.getByRole('button', { name: 'Inscrição, valor e mais' }).click();
  await card.getByLabel('Valor (R$) — FAMERP').fill('450');
  await card.getByLabel('Valor (R$) — FAMERP').blur();
  await expect(card.getByText('Salvo')).toBeVisible();
  await expect(card).toContainText('principal');
});

test('TESTES 3, 5–12 — planner em duas colunas, fila dinâmica, Pomodoro e checklist', async ({ page }) => {
  await login(page, student.email, student.password);
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

  // Workspace: semana, assuntos, foco e desempenho na mesma tela; sem barra de navegação
  await expect(page.getByRole('region', { name: 'Assuntos' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Foco' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Provas' })).toHaveCount(0);

  // Pomodoro a partir da tarefa: abre o foco por cima, sem sair da página
  await page.getByTestId(`day-${inDays(0)}`).getByRole('button', { name: 'Iniciar Pomodoro — Saúde do Trabalhador' }).click();
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
  await page.getByLabel(/Selecionar FAMERP/).check({ force: true });
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
  await src.dragTo(target);
  await expect(target).toContainText(name);
  await expect(page.getByTestId(`day-${inDays(mon)}`).getByTestId('col-subjects')).not.toContainText(name);

  // Arrastar da lista de Assuntos para um dia da semana
  const libItem = page.getByTestId('library-item').filter({ hasNotText: name }).nth(5);
  const libName = (await libItem.locator('button span').first().textContent())!.trim();
  const dropDay = page.getByTestId(`day-${inDays(mon)}`).getByTestId("col-subjects");
  await libItem.dragTo(dropDay);
  await expect(page.getByText(`✓ ${libName} adicionado a`, { exact: false })).toBeVisible();
  await expect(dropDay).toContainText(libName);

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
  await page.getByRole('link', { name: '← Voltar ao planner' }).click();
  await expect(page).toHaveURL(HOME);

  // Zerar o perfil: volta ao início, como uma conta nova
  await page.goto('configuracoes');
  await page.getByRole('button', { name: 'Zerar meu perfil' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Zerar tudo' }).click();
  await expect(page).toHaveURL(HOME);
  await expect(page.getByText('Qual prova você vai fazer?')).toBeVisible();
  await expect(page.getByLabel(/Selecionar FAMERP/)).not.toBeChecked();
});
