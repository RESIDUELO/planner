/**
 * A tela principal cabe inteira na viewport do computador (sem rolagem da página);
 * só a lista de Assuntos e os dias da semana rolam por dentro, sem barra visível.
 */
import { expect, test } from '@playwright/test';

const user = { name: 'Tela E2E', email: `tela${Date.now()}@e2e.test`, password: 'senha-tela-123' };
// Computadores e tablets deitados
const SIZES = [[1366, 768], [1280, 800], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [1024, 768], [1138, 712], [1024, 600]] as const;

test('workspace cabe na viewport em várias alturas, só Assuntos e dias rolam', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(user.name);
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await page.locator('label', { has: page.getByLabel('Selecionar FAMERP') }).click();
  await expect(page.getByLabel('Selecionar FAMERP')).toBeChecked();
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  await expect(page.getByTestId('week-scroll')).toBeVisible();

  // Barra lateral aberta (padrão) e recolhida: nos dois casos tudo cabe na tela
  for (const state of ['open', 'closed'] as const) {
  if (state === 'closed') {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(700);
    const wideBefore = (await page.locator('section[aria-label="Semana"]').first().boundingBox())!.width;
    const sidebar = page.getByTestId('sidebar');
    await page.getByRole('button', { name: 'Recolher menu' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(70);
    await expect.poll(async () => (await page.locator('section[aria-label="Semana"]').first().boundingBox())!.width).toBeGreaterThan(wideBefore + 100);
    // Só ícones, clicáveis, com o nome ao passar o mouse
    await sidebar.getByRole('link', { name: 'Agenda' }).hover();
    await expect(sidebar.getByText('Agenda', { exact: true }).last()).toBeVisible();
    await sidebar.getByRole('link', { name: 'Agenda' }).click();
    await expect(page).toHaveURL(/agenda/);
    await sidebar.getByRole('link', { name: 'Planner' }).click();
    await sidebar.getByRole('button', { name: 'Perfil' }).click();
    for (const item of ['Meu perfil', 'Provas', 'Revisões', 'Configurações', 'Sair']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 300);
    // Continua recolhida depois de recarregar
    await page.reload();
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('week-scroll')).toBeVisible();
  }
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      const regions = ['[aria-label="Semana"]', 'section[aria-label="Assuntos"]', 'section[aria-label="Calendário"]', 'section[aria-label="Desempenho"]', '[data-testid="sidebar"]']
        .map((s) => ({ s, r: rect(s) }));
      // Elementos que rolam por dentro (além da lista de Assuntos e das colunas-salvaguarda dos dias)
      const scrollers = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
        const cs = getComputedStyle(el);
        return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.tagName !== 'TEXTAREA';
      }).map((el) => el.getAttribute('data-testid') ?? el.className.toString().slice(0, 60));
      return {
        scrollH: d.scrollHeight, scrollW: d.scrollWidth, innerH: innerHeight, innerW: innerWidth,
        bodyScrollH: document.body.scrollHeight,
        regions: regions.map(({ s, r }) => ({ s, top: r?.top ?? -1, bottom: r?.bottom ?? -1, right: r?.right ?? -1 })),
        scrollers,
      };
    });
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/ws-${width}x${height}.png` });
    // Sem rolagem vertical nem horizontal da página
    expect(m.scrollH, `${state} ${width}x${height} altura`).toBeLessThanOrEqual(m.innerH);
    expect(m.scrollW, `${state} ${width}x${height} largura`).toBeLessThanOrEqual(m.innerW);
    // Cabeçalho, Semana, Assuntos, Calendário e Desempenho visíveis de uma vez
    for (const r of m.regions) {
      expect(r.top, `${state} ${width}x${height} ${r.s}`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `${state} ${width}x${height} ${r.s}`).toBeLessThanOrEqual(m.innerH + 0.5);
      expect(r.right, `${state} ${width}x${height} ${r.s}`).toBeLessThanOrEqual(m.innerW + 0.5);
    }
    // Só a lista de Assuntos e os dias da semana rolam por dentro
    expect(m.scrollers.filter((s) => s !== 'library' && s !== 'week-scroll'), `${state} ${width}x${height} rolagens internas`).toEqual([]);
  }
  }

  // Residências com a lista cheia: a página também não rola, só a lista por dentro
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name: 'Residências', exact: true }).click();
  for (const name of ['FAMEMA', 'SUS-SP', 'HR Presidente Prudente', 'UNIFIPA', 'ENARE', 'Santa Casa Ourinhos', 'FAMERP', 'HU-UEL']) {
    await page.getByTestId('new-residency').click();
    await page.getByRole('dialog').getByLabel('Nome da residência').fill(name);
    await page.getByRole('dialog').getByLabel('Inscrição - fim', { exact: true }).fill('2026-12-20');
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/res-${width}x${height}.png` });
    expect(m.h, `residências ${width}x${height} altura`).toBeLessThanOrEqual(m.ih);
    expect(m.w, `residências ${width}x${height} largura`).toBeLessThanOrEqual(m.iw);
  }
});
