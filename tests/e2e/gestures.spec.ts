/**
 * Celular: toque longo abre as ações, deslizar conclui/exclui (com Desfazer),
 * deslizar fora dos assuntos troca de semana; Personalizar e paleta.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const HOME = /\/planner\/planner$/;
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + n * 86_400_000));

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Gesto de dedo (eventos de ponteiro do tipo toque). */
async function touch(el: Locator, dx: number, holdMs = 0) {
  await el.evaluate(async (node, [dx, hold]) => {
    const r = node.getBoundingClientRect();
    const x = r.left + Math.min(40, r.width / 2), y = r.top + r.height / 2;
    const ev = (type: string, cx: number) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    ev('pointerdown', x);
    if (hold) await wait(hold);
    for (let i = 1; i <= 10 && dx; i++) { await wait(16); ev('pointermove', x + (dx * i) / 10); }
    ev('pointerup', x + dx);
  }, [dx, holdMs] as const);
}

async function setup(page: Page) {
  await page.goto('login');
  await page.getByRole('button', { name: 'Continuar como visitante' }).click();
  await expect(page).toHaveURL(HOME);
  await page.locator('label', { has: page.getByLabel(/Selecionar FAMERP/) }).click();
  await page.getByTestId('setup-exams').getByRole('button', { name: 'Confirmar' }).click();
  await page.getByTestId('setup-start').getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Opções avançadas' }).click();
  const sunday = page.getByRole('switch', { name: 'Estudo aos domingos' });
  if ((await sunday.getAttribute('aria-checked')) !== 'true') await sunday.click();
  const saturday = page.getByRole('switch', { name: 'Estudo aos sábados' });
  if ((await saturday.getAttribute('aria-checked')) !== 'true') await saturday.click();
  await page.getByLabel('Dias de estudo por semana').fill('7');
  await page.getByTestId('setup-methods').getByRole('button', { name: 'Confirmar' }).click();
}

test('celular: toque longo, deslizar e Desfazer; semana por gesto; Personalizar e paleta', async ({ page }) => {
  await setup(page);
  const today = page.getByTestId(`day-${inDays(0)}`).getByTestId('col-subjects');
  const first = today.getByTestId('task').first();
  await expect(first).toBeVisible();
  const name = (await first.getByTestId('task-name').textContent())!.trim();
  const row = today.getByTestId('task').filter({ hasText: name });
  const toast = page.getByTestId('toast');

  // Toque longo: ações do assunto, numa folha que sobe do rodapé
  await touch(row.getByTestId('task-name'), 0, 650);
  const menu = page.getByRole('menu', { name });
  await expect(menu).toBeVisible();
  for (const a of ['Concluir', 'Mover para outro dia', 'Iniciar foco', 'Abrir assunto', 'Excluir do planner']) await expect(menu.getByRole('menuitem', { name: a })).toBeVisible();
  // Mover sem arrastar: escolhe o dia
  await menu.getByRole('menuitem', { name: 'Mover para outro dia' }).click();
  await page.getByRole('menu', { name: `Mover ${name}` }).getByRole('menuitem', { name: /Amanhã/ }).click();
  await expect(toast).toContainText(`✓ ${name} adicionado a`);
  await expect(today.getByTestId('task').filter({ hasText: name })).toHaveCount(0);
  await toast.getByRole('button', { name: 'Desfazer' }).click();
  await expect(toast).toContainText(`${name} de volta para`);
  await expect(row).toBeVisible();

  // Deslizar para a direita: conclui (e dá para desfazer)
  await touch(row.getByTestId('task-name'), 160);
  await expect(toast).toContainText(`✓ ${name} concluído`);
  await expect(row.getByRole('checkbox', { name: `Concluir ${name}` })).toHaveAttribute('aria-checked', 'true');
  await toast.getByRole('button', { name: 'Desfazer' }).click();
  await expect(row.getByRole('checkbox', { name: `Concluir ${name}` })).toHaveAttribute('aria-checked', 'false');

  // Deslizar para a esquerda: revela Excluir; tocar exclui do planner, com Desfazer
  await touch(row.getByTestId('task-name'), -140);
  await row.getByRole('button', { name: 'Excluir' }).click();
  await expect(toast).toContainText(`${name} excluído do planner`);
  await expect(today.getByTestId('task').filter({ hasText: name })).toHaveCount(0);
  await toast.getByRole('button', { name: 'Desfazer' }).click();
  await expect(today.getByTestId('task').filter({ hasText: name })).toHaveCount(1);

  // Deslizar fora dos assuntos (no título): próxima semana; e volta
  const title = page.locator('h1').first();
  const before = await title.textContent();
  await touch(title, -160);
  await expect(title).not.toHaveText(before!);
  await touch(title, 160);
  await expect(title).toHaveText(before!);

  // Personalizar: esconder Revisões e Observações; paleta Lavanda fica depois de recarregar
  await page.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: 'Personalizar' }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Personalizar Planner' });
  await sheet.getByRole('switch', { name: 'Mostrar Revisões' }).click();
  await sheet.getByRole('switch', { name: 'Mostrar Observações' }).click();
  await sheet.getByRole('radio', { name: 'Lavanda' }).click();
  await sheet.getByRole('button', { name: 'Concluído' }).click();
  await expect(page.getByTestId('col-reviews')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Observações da semana' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'lavanda');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'lavanda');
  await expect(page.getByTestId('col-reviews')).toHaveCount(0);
});
