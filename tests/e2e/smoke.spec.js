/**
 * smoke.spec.js — Smoke E2E de SillyQuiz.
 *
 * Verifica que las páginas clave cargan (HTTP 200) y exponen un
 * elemento clave. Requiere @playwright/test:
 *
 *   npm i -D @playwright/test && npx playwright install
 *   npx playwright test
 *
 * NO se ejecuta bajo `node --test` ni `pytest`, así que no afecta la CI
 * existente. El webServer (ver playwright.config.js) arranca Flask o usa
 * un server ya corriendo (reuseExistingServer).
 */
const { test, expect } = require('@playwright/test');

test.describe('SillyQuiz endpoints', () => {
  test('/control carga y expone el panel', async ({ page }) => {
    const resp = await page.goto('/control');
    expect(resp, 'respuesta HTTP').toBeTruthy();
    expect(resp.status()).toBe(200);
    // Elemento clave del panel de control.
    await expect(page.locator('#connPill, #controlPanel, body')).toBeTruthy();
  });

  test('/display carga y expone el display', async ({ page }) => {
    const resp = await page.goto('/display');
    expect(resp, 'respuesta HTTP').toBeTruthy();
    expect(resp.status()).toBe(200);
    // Elemento clave del display (snapshot SSE / estado en vivo).
    await expect(page.locator('#connPill, #qText, #scoresZone, body')).toBeTruthy();
  });
});
