/**
 * A tela principal cabe inteira na viewport do computador (sem rolagem da página);
 * só a lista de Assuntos e os dias da semana rolam por dentro, sem barra visível.
 */
import { expect, test } from '@playwright/test';

const user = { name: 'Tela E2E', email: `tela${Date.now()}@e2e.test`, password: 'senha-tela-123' };
const SIZES = [[1366, 768], [1280, 800], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [1024, 768]] as const;

test('workspace cabe na viewport em várias alturas, só Assuntos e dias rolam', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('login');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('Nome').fill(user.name);
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.locator('form').getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('Selecionar FAMERP').check({ force: true });
  await page.getByRole('button', { name: 'Criar meu planner' }).click();
  await expect(page.getByTestId('week-scroll')).toBeVisible();

  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      const regions = ['[aria-label="Semana"]', 'section[aria-label="Assuntos"]', 'section[aria-label="Foco"]', 'section[aria-label="Desempenho"]', 'header']
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
    expect(m.scrollH, `${width}x${height} altura`).toBeLessThanOrEqual(m.innerH);
    expect(m.scrollW, `${width}x${height} largura`).toBeLessThanOrEqual(m.innerW);
    // Cabeçalho, Semana, Assuntos, Foco e Desempenho visíveis de uma vez
    for (const r of m.regions) {
      expect(r.top, `${width}x${height} ${r.s}`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `${width}x${height} ${r.s}`).toBeLessThanOrEqual(m.innerH + 0.5);
      expect(r.right, `${width}x${height} ${r.s}`).toBeLessThanOrEqual(m.innerW + 0.5);
    }
    // Só a lista de Assuntos e os dias da semana rolam por dentro
    expect(m.scrollers.filter((s) => s !== 'library' && s !== 'week-scroll'), `${width}x${height} rolagens internas`).toEqual([]);
  }
});
