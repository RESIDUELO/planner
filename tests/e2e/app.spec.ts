/**
 * Testes E2E no navegador (seção 58). Rodam em sequência sobre um banco vazio.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe.configure({ mode: 'serial' });

const admin = { email: 'admin@e2e.test', password: 'admin-e2e-123' };
const student = { name: 'Aluna E2E', email: `aluna${Date.now()}@e2e.test`, password: 'senha-aluna-123' };

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
  await expect(page.getByText('Planeje seus estudos com base no que realmente cai na sua prova.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar conta' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar como visitante' })).toBeVisible();
  await expect(page).toHaveTitle('Residência Planner');
});

test('TESTE 1 — criar usuário e ver base vazia', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Criar conta' }).first().click();
  await page.getByLabel('Nome').fill(student.name);
  await page.getByLabel('E-mail').fill(student.email);
  await page.getByLabel('Senha').fill(student.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await page.goto('provas');
  await expect(page.getByText('Nenhuma prova disponível')).toBeVisible();
});

test('TESTE 20 — usuário comum não acessa /admin', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('admin');
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administração' })).toHaveCount(0);
});

test('TESTES 21–23 — admin cria prova como rascunho; usuários não a veem', async ({ page, browser }) => {
  await login(page, admin.email, admin.password);
  await page.goto('admin/nova-prova');
  await page.getByLabel('Nome da instituição').fill('Faculdade de Medicina de São José do Rio Preto');
  await page.getByLabel('Sigla da instituição').fill('FAMERP');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Número de questões').fill('80');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Ano / edição').fill('2027');
  await page.getByLabel('Data da prova').fill('2026-11-12');
  await page.getByLabel('Valor da inscrição (R$)').fill('450');
  await page.getByRole('button', { name: 'Salvar edição como rascunho' }).click();
  await expect(page.getByText('Rascunho', { exact: true })).toBeVisible();

  const ctx = await browser.newContext();
  const u = await ctx.newPage();
  await login(u, student.email, student.password);
  await u.goto('provas');
  await expect(u.getByText('Nenhuma prova disponível')).toBeVisible();
  await ctx.close();
});

test('TESTE 25 — importar questões (prévia + confirmação) e ver estatísticas', async ({ page }) => {
  await login(page, admin.email, admin.password);
  await page.goto('admin/importacao');
  await page.getByLabel('Prova de destino').selectOption({ label: 'FAMERP — R1 Acesso Direto' });
  await page.getByLabel('Arquivo').setInputFiles({
    name: 'famerp.json', mimeType: 'application/json', buffer: readFileSync('data/import/famerp_r1_2021-2026.json'),
  });
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(page.getByText('480 questões encontradas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
  await page.getByRole('button', { name: 'Criar restantes' }).click();
  await page.getByLabel(/Revisei a prévia/).check();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByText('480 questões inseridas')).toBeVisible({ timeout: 30_000 });

  await page.goto('admin/estatisticas');
  await expect(page.getByText('Análise baseada em 6 edições cadastradas.')).toBeVisible();
  const first = page.locator('tbody tr').first();
  await expect(first).toContainText('Saúde do Trabalhador');
  await expect(first).toContainText('30');
});

test('TESTE 24 — publicar torna a prova visível', async ({ page, browser }) => {
  await login(page, admin.email, admin.password);
  await page.goto('admin/edicoes');
  const links = page.getByRole('link', { name: /FAMERP \d{4}/ });
  await expect(links).toHaveCount(7);
  const n = await links.count();
  for (let i = 0; i < n; i++) {
    await page.goto('admin/edicoes');
    await page.getByRole('link', { name: /FAMERP \d{4}/ }).nth(i).click();
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible();
  }
  const ctx = await browser.newContext();
  const u = await ctx.newPage();
  await login(u, student.email, student.password);
  await u.goto('provas');
  await expect(u.getByTestId('exam-FAMERP-2027')).toBeVisible();
  await expect(u.getByTestId('exam-FAMERP-2027')).toContainText('Análise baseada em 6 edições cadastradas.');
  await ctx.close();
});

test('TESTES 3, 5–12 — planner, checklist, questões e primeira revisão', async ({ page }) => {
  await login(page, student.email, student.password);
  await page.goto('provas');
  await page.getByTestId('exam-FAMERP-2027').getByRole('button', { name: 'Selecionar' }).click();
  await expect(page.getByTestId('exam-FAMERP-2027').getByText('Principal')).toBeVisible();

  await page.goto('planner');
  await expect(page.getByLabel(/Selecionar FAMERP 2027/)).toBeChecked();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Horas disponíveis por dia').fill('4');
  await page.getByRole('button', { name: 'Continuar' }).click();
  // Métodos: Videoaula, Flashcards e Questões (padrão)
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Gerar planner' }).click();
  await expect(page.getByText('PRIORIDADE 1 · #1 NO RANKING')).toBeVisible();

  await page.getByRole('button', { name: /Assuntos \(/ }).click();
  const card = page.getByTestId('subject-card').first();
  await expect(card).toContainText('Saúde do Trabalhador');
  await expect(card).not.toContainText('Resumo');
  await card.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Por que está em #1?')).toBeVisible();
  await expect(dialog).toContainText('representou 6,3% das questões das 6 edições cadastradas');
  await dialog.getByRole('button', { name: /Videoaula/ }).click();
  await dialog.getByRole('button', { name: /Flashcards/ }).click();
  await expect(dialog.getByText('67%')).toBeVisible();

  await dialog.getByRole('spinbutton', { name: 'Questões feitas' }).fill('20');
  await dialog.getByRole('spinbutton', { name: 'Acertos' }).fill('17');
  await dialog.getByRole('button', { name: 'Registrar questões' }).click();
  await expect(dialog.getByText(/Assunto estudado/)).toBeVisible();
  await expect(dialog.getByText('Estudado', { exact: true })).toBeVisible();
  await expect(dialog.getByText('85%')).toBeVisible();
  await expect(dialog.getByText('82%')).toBeVisible(); // domínio estimado
  await expect(dialog.getByText('Próxima revisão')).toBeVisible();
});

test('TESTES 15, 17–19 — calendário e persistência após fechar o navegador', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, student.email, student.password);
  await page.goto('revisoes');
  await expect(page.getByText('Revisões', { exact: true }).first()).toBeVisible();
  await expect(page.locator('text=/\\d+ rev\\./').first()).toBeVisible();
  await ctx.close();

  const again = await browser.newContext();
  const p2 = await again.newPage();
  await login(p2, student.email, student.password);
  await expect(p2.getByText('Assuntos estudados')).toBeVisible();
  await expect(p2.getByText('1 / ', { exact: false }).first()).toBeVisible();
  await p2.goto('desempenho');
  await expect(p2.getByRole('cell', { name: '17/20' })).toBeVisible();
  await again.close();
});

test('TESTE 2 — visitante usa o sistema e não acessa /admin', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(/\/planner\/?$/);
  await expect(page.getByText('Você está no modo visitante')).toBeVisible();
  await page.goto('provas');
  await expect(page.getByTestId('exam-FAMERP-2027')).toBeVisible();
  await page.goto('admin');
  await expect(page.getByText('Acesso restrito')).toBeVisible();
});
