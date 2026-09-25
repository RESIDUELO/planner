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
  await expect(page.getByRole('heading', { name: 'Residência Planner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar conta' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar como visitante' })).toBeVisible();
  await expect(page).toHaveTitle('Residência Planner');
});

test('TESTE 1 — criar conta e ver somente as provas cadastradas', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Criar conta' }).first().click();
  await page.getByLabel('Nome').fill(student.name);
  await page.getByLabel('E-mail').fill(student.email);
  await page.getByLabel('Senha').fill(student.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(3);
  for (const i of ['FAMERP', 'HU-UEL', 'UNOESTE/HRPP']) await expect(page.getByTestId(`exam-${i}-2027`)).toBeVisible();
  await expect(page.getByTestId('exam-FAMERP-2027')).toContainText('Análise baseada em 6 edições cadastradas.');
});

test('TESTE 20 — não existe área administrativa no site', async ({ page }) => {
  await login(page, student.email, student.password);
  await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
  await page.goto('admin');
  await expect(page).toHaveURL(/\/planner\/?$/);
});

test('o aluno informa data, inscrição e valor da própria prova', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('provas');
  const card = page.getByTestId('exam-FAMERP-2027');
  await card.getByLabel('Data da prova — FAMERP').fill(inDays(48));
  await card.getByLabel('Valor (R$) — FAMERP').fill('450');
  await card.getByLabel('Valor (R$) — FAMERP').blur();
  await expect(card.getByText('salvo')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('exam-FAMERP-2027').getByLabel('Data da prova — FAMERP')).toHaveValue(inDays(48));
  await expect(page.getByTestId('exam-FAMERP-2027').getByText('48 dias')).toBeVisible();
});

test('TESTES 3, 5–12 — planner, checklist, questões e primeira revisão', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('provas');
  await page.getByTestId('exam-FAMERP-2027').getByRole('button', { name: 'Selecionar' }).click();
  await expect(page.getByTestId('exam-FAMERP-2027').getByText('Principal')).toBeVisible();

  await page.goto('planner');
  await expect(page.getByLabel(/Selecionar FAMERP/)).toBeChecked();
  await expect(page.getByLabel('Data da prova — FAMERP')).toHaveValue(inDays(48));
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Horas disponíveis por dia').fill('4');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Gerar planner' }).click();
  await expect(page.getByText('PRIORIDADE 1 · #1 NO RANKING')).toBeVisible();

  await page.getByRole('button', { name: /Assuntos \(/ }).click();
  const card = page.getByTestId('subject-card').first();
  await expect(card).toContainText('Saúde do Trabalhador');
  await expect(card).not.toContainText('Resumo');
  await card.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('representou 6,3% das questões das 6 edições cadastradas');
  await dialog.getByRole('button', { name: /Videoaula/ }).click();
  await dialog.getByRole('button', { name: /Flashcards/ }).click();
  await expect(dialog.getByText('67%')).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Questões feitas' }).fill('20');
  await dialog.getByRole('spinbutton', { name: 'Acertos' }).fill('17');
  await dialog.getByRole('button', { name: 'Registrar questões' }).click();
  await expect(dialog.getByText(/Assunto estudado/)).toBeVisible();
  await expect(dialog.getByText('85%')).toBeVisible();
  await expect(dialog.getByText('82%')).toBeVisible();
  await expect(dialog.getByText('Próxima revisão')).toBeVisible();
});

test('TESTES 15, 17–19 — calendário e persistência após fechar o navegador', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, student.email, student.password);
  await page.goto('revisoes');
  await expect(page.locator('text=/\\d+ rev\\./').first()).toBeVisible();
  await ctx.close();

  const again = await browser.newContext();
  const p2 = await again.newPage();
  await login(p2, student.email, student.password);
  await expect(p2.getByText('48', { exact: true })).toBeVisible();
  await p2.goto('desempenho');
  await expect(p2.getByRole('cell', { name: '17/20' })).toBeVisible();
  await again.close();
});

test('TESTE 2 — visitante escolhe prova e usa o sistema', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await expect(page.getByText('Você está no modo visitante')).toBeVisible();
  await page.goto('provas');
  await expect(page.locator('article')).toHaveCount(3);
  // A data informada pela outra aluna não aparece para o visitante
  await expect(page.getByTestId('exam-FAMERP-2027').getByLabel('Data da prova — FAMERP')).toHaveValue('');
});
