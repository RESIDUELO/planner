/**
 * Gera o ícone e a tela de abertura do app Android a partir do monograma "R"
 * do site (fonte Tinos, papel creme). Uso: node scripts/make-android-icons.mjs
 * (precisa da fonte Tinos instalada no sistema e do Chromium do Playwright).
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RES = 'android/app/src/main/res';
const CANVAS = '#F1EEE8', INK = '#1C1B19';
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage();

/** Monograma: círculo fino + R em serifa, `d` = diâmetro em px. */
const mark = (d) => `<div style="width:${d}px;height:${d}px;border:${Math.max(1, d * 0.035)}px solid ${INK};border-radius:50%;box-sizing:border-box;
  display:flex;align-items:center;justify-content:center;font-family:Tinos;font-size:${d * 0.58}px;color:${INK};line-height:1">
  <span style="transform:translateY(${d * 0.02}px)">R</span></div>`;

async function shot(path, w, h, body, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;
    background:${transparent ? 'transparent' : CANVAS}">${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: transparent });
}

for (const dir of readdirSync(RES)) {
  const full = join(RES, dir);
  if (!statSync(full).isDirectory()) continue;
  for (const f of readdirSync(full)) {
    const p = join(full, f);
    const buf = readFileSync(p);
    if (!f.endsWith('.png')) continue;
    const W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
    if (f === 'splash.png') await shot(p, W, H, mark(Math.round(Math.min(W, H) * 0.22)));
    // Ícone adaptativo: o conteúdo fica na zona segura central (66 de 108)
    else if (f === 'ic_launcher_foreground.png') await shot(p, W, H, mark(Math.round(W * 0.5)), true);
    else if (f === 'ic_launcher.png') await shot(p, W, H, `<div style="width:${W}px;height:${H}px;border-radius:${W * 0.22}px;background:${CANVAS};display:flex;align-items:center;justify-content:center">${mark(Math.round(W * 0.66))}</div>`, true);
    else if (f === 'ic_launcher_round.png') await shot(p, W, H, `<div style="width:${W}px;height:${H}px;border-radius:50%;background:${CANVAS};display:flex;align-items:center;justify-content:center">${mark(Math.round(W * 0.66))}</div>`, true);
  }
}
await browser.close();
console.log('ícones e tela de abertura gerados');
