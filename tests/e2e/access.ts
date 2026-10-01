/**
 * Conta nova só entra com um código de acesso. scripts/e2e-stack.mjs já
 * cadastra os códigos E2E<grupo>0001…0100 (um grupo por arquivo de teste).
 */
import { expect, type Page } from '@playwright/test';

export const E2E_CODE_GROUPS = ['APP', 'GES', 'VIE', 'PDF'] as const;
export const e2eCode = (group: (typeof E2E_CODE_GROUPS)[number], n: number) => `E2E${group}${String(n).padStart(4, '0')}`;

const used: Record<string, number> = {};
export const nextCode = (group: (typeof E2E_CODE_GROUPS)[number]) => e2eCode(group, (used[group] = (used[group] ?? 0) + 1));

/** Preenche e envia "Criar conta". */
export async function register(page: Page, user: { name: string; email: string; password: string }, code: string) {
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(user.name);
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByLabel('Código de acesso').fill(code);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
}

/** Conta nova já liberada, no Planner. */
export async function member(page: Page, group: (typeof E2E_CODE_GROUPS)[number]) {
  const email = `membro${Date.now()}${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  await register(page, { name: 'Membro E2E', email, password: 'senha-membro-123' }, nextCode(group));
  await expect(page).toHaveURL(/\/planner\/planner$/);
  return email;
}
