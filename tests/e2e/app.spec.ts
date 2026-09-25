/**
 * Testes E2E no navegador (seção 58), com o site compilado em /planner/ como
 * no GitHub Pages e as provas carregadas pelos arquivos supabase/data/*.sql.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const student = { name: 'Aluna E2E', email: `aluna${Date.now()}@e2e.test`, password: 'senha-aluna-123' };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, email: string, password: string) {
  await page.goto('login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.locator('form').getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
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

test('TESTE 1 — criar conta e ver somente as provas cadastradas', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(student.name);
  await page.getByLabel('E-mail').fill(student.email);
  await page.getByLabel('Senha').fill(student.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(3);
  for (const i of ['FAMERP', 'HU-UEL', 'UNOESTE/HRPP']) await expect(page.getByTestId(`exam-${i}`)).toBeVisible();
  await page.getByTestId('exam-FAMERP').locator('button').first().click();
  await expect(page.getByTestId('exam-FAMERP')).toContainText('Análise baseada em 6 edições cadastradas.');
});

test('TESTE 20 — não existe área administrativa no site', async ({ page }) => {
  await login(page, student.email, student.password);
  await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
  await page.goto('admin');
  await expect(page).toHaveURL(/\/planner\/?$/);
});

test('o aluno escolhe a prova e informa data, inscrição e valor (teste 3)', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('provas');
  const card = page.getByTestId('exam-FAMERP');
  await card.locator('button').first().click();
  await card.getByRole('button', { name: 'Adicionar à minha preparação' }).click();
  await card.getByLabel('Data da prova — FAMERP').fill(inDays(48));
  await card.getByRole('button', { name: 'Inscrição, valor e mais' }).click();
  await card.getByLabel('Valor (R$) — FAMERP').fill('450');
  await card.getByLabel('Valor (R$) — FAMERP').blur();
  await expect(card.getByText('Salvo')).toBeVisible();
  await expect(card).toContainText('principal');
  await page.reload();
  await expect(page.getByTestId('exam-FAMERP')).toContainText('48 dias');
  await page.getByTestId('exam-FAMERP').locator('button').first().click();
  await expect(page.getByTestId('exam-FAMERP').getByLabel('Data da prova — FAMERP')).toHaveValue(inDays(48));
});

test('TESTES 3, 5–12 — planner, checklist, questões e primeira revisão', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('planner');
  await expect(page.getByLabel(/Selecionar FAMERP/)).toBeChecked();
  await expect(page.getByLabel('Data da prova — FAMERP')).toHaveValue(inDays(48));
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Sem configurar nada: só marcar como estuda (tempo fica em "Opções avançadas")
  await expect(page.getByRole('heading', { name: 'Como você estuda?' })).toBeVisible();
  await expect(page.getByLabel('Videoaula')).toBeChecked();
  await expect(page.getByText('Horas por dia')).toHaveCount(0);
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  const today = page.getByTestId(`day-${inDays(0)}`);
  await expect(today.getByTestId('task').first()).toBeVisible();
  await expect(today.getByText('Saúde do Trabalhador')).toBeVisible();
  await expect(today).not.toContainText('min');

  // Pomodoro a partir da tarefa, opcional e independente
  await today.getByRole('button', { name: 'Iniciar Pomodoro — Saúde do Trabalhador' }).click();
  await expect(page).toHaveURL(/\/foco$/);
  await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
  await expect(page.getByRole('button', { name: 'Saúde do Trabalhador' })).toBeVisible();
  await page.getByRole('button', { name: 'Pausar' }).click();
  await page.getByRole('tab', { name: '50/10' }).click();
  await expect(page.getByRole('timer')).toHaveText('50:00');
  await page.getByRole('tab', { name: '25/5' }).click();
  await page.goto('planner');

  await page.getByRole('tab', { name: 'Assuntos' }).click();
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
  await expect(dialog.getByText('85%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Domínio e memória' }).click();
  await expect(dialog.getByText('82%')).toBeVisible();
  await expect(dialog.getByText('Próxima revisão')).toBeVisible();
});

test('TESTES 15, 17–19 — calendário e persistência após fechar o navegador', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, student.email, student.password);
  await page.goto('revisoes');
  await expect(page.getByText('Próximos dias')).toBeVisible();
  await expect(page.getByText('Saúde do Trabalhador').first()).toBeVisible();
  await page.getByRole('button', { name: 'Calendário' }).click();
  await expect(page.getByTestId(`day-${inDays(0)}`)).toBeVisible();
  await ctx.close();

  const again = await browser.newContext();
  const p2 = await again.newPage();
  await login(p2, student.email, student.password);
  await expect(p2.getByText('48', { exact: true })).toBeVisible();
  await expect(p2.getByText(/1 de \d+ assuntos concluídos/)).toBeVisible();
  await p2.goto('desempenho');
  await expect(p2.getByText('85%', { exact: true })).toBeVisible();
  await expect(p2.getByText('de acertos em 20 questões')).toBeVisible();
  await again.close();
});

test('TESTE 2 — visitante escolhe prova e usa o sistema', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await expect(page.getByText('Você está no modo visitante')).toBeVisible();
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(3);
  // A escolha e a data da outra aluna não aparecem para o visitante
  await expect(page.getByText('Você ainda não escolheu uma prova.')).toBeVisible();
  await expect(page.getByTestId('exam-FAMERP')).toContainText('Adicionar');

  // Uso sem configuração: prova + data → planner → marcar a primeira tarefa
  await page.goto('planner');
  await page.getByLabel(/Selecionar FAMERP/).check({ force: true });
  await page.getByLabel('Data da prova — FAMERP').fill(inDays(60));
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  const task = page.getByTestId(`day-${inDays(0)}`).getByTestId('task').first();
  const circle = task.getByRole('checkbox');
  await expect(circle).toHaveAttribute('aria-checked', 'false');
  await circle.click();
  await expect(circle).toHaveAttribute('aria-checked', 'true');
});
