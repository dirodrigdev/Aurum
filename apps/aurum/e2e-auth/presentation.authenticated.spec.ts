import { expect, test } from '@playwright/test';
import { installLocalNetworkGuard } from '../../../packages/e2e-harness/playwright/local-network-guard.mjs';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`presentation is isolated and readable on ${viewport.name}`, async ({ page }, testInfo) => {
    const guard = await installLocalNetworkGuard(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/#/presentation');
    const root = page.getByTestId('aurum-presentation');
    await expect(root.getByRole('heading', { name: 'Tu situación patrimonial, reunida y puesta en contexto' })).toBeVisible();
    await expect(root.getByTestId('aurum-asset-chart')).toBeVisible({ timeout: 30_000 });
    await expect(root.getByText('El reparto muestra activos. Las deudas se descuentan al calcular el patrimonio neto.')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Completar ahora|Reflejar cambios/ })).toHaveCount(0);
    const visible = await root.evaluate((element) => ({
      text: element.textContent || '',
      attributes: [...element.querySelectorAll('*')].map((node) => `${node.getAttribute('title') || ''} ${node.getAttribute('aria-label') || ''}`).join(' '),
      links: [...element.querySelectorAll('a')].map((node) => node.href),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    expect(`${visible.text} ${visible.attributes}`).not.toMatch(/\$|Fondo diversificado ficticio|Saldo bancos CLP|Capital de riesgo CLP|e2e-closure|Patrimonio neto actual/i);
    expect(visible.links).toEqual([]);
    expect(visible.overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`presentation-${viewport.name}.png`), fullPage: true });

    await page.goto('/#/presentation?demoState=empty');
    await expect(page.getByTestId('aurum-asset-unavailable')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`presentation-empty-${viewport.name}.png`), fullPage: true });
    await page.goto('/#/ecosystem');
    await expect(page.getByRole('heading', { name: 'Del comportamiento cotidiano a las decisiones de largo plazo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver a GastApp' })).toHaveAttribute('href', 'https://gastapp-chi.vercel.app/#/presentation');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`ecosystem-${viewport.name}.png`), fullPage: true });
    await guard.assertClean(testInfo);
  });
}
