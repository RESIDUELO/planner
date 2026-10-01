/**
 * Planner em PDF: depois de escolher a prova e as datas, baixar o cronograma
 * inteiro (com a agenda) num arquivo PDF.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const HOME = /\/planner\/planner$/;

test('baixar o planner em PDF com a agenda, logo depois de montar o cronograma', async ({ page }) => {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);

  // Uma tarefa na agenda, para ir junto no PDF
  await page.goto('agenda');
  await page.getByTestId('add-day-task').click();
  await page.keyboard.type('Pagar a inscrição da FAMERP');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Pagar a inscrição da FAMERP')).toBeVisible();

  // Prova → início → como estuda
  await page.goto('planner');
  await page.locator('label', { has: page.getByLabel(/Selecionar FAMERP/) }).click();
  for (const step of ['exams', 'start', 'methods']) await page.getByTestId(`setup-${step}`).getByRole('button', { name: 'Confirmar' }).click();

  // O aviso de "planner pronto" já oferece o PDF
  await page.getByRole('button', { name: 'Baixar PDF' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Baixar o planner em PDF');
  await expect(sheet.getByRole('switch', { name: 'Incluir a agenda' })).toHaveAttribute('aria-checked', 'true');
  const [download] = await Promise.all([page.waitForEvent('download'), sheet.getByTestId('pdf-download').click()]);
  expect(download.suggestedFilename()).toMatch(/^planner-famerp.*\.pdf$/);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 5).toString()).toBe('%PDF-');
  expect(file.length).toBeGreaterThan(10_000);
  if (process.env.PDF_OUT) await download.saveAs(process.env.PDF_OUT);
  await expect(sheet).toBeHidden();

  // E pelo botão no topo do planner, a qualquer momento
  await page.getByTestId('download-pdf').click();
  await expect(page.getByRole('dialog')).toContainText('Incluir as revisões');
});
