/**
 * Playwright config for SillyQuiz E2E smoke tests.
 *
 * IMPORTANTE (no rompe la CI): este archivo requiere @playwright/test.
 * NO se ejecuta con `node --test` ni con `pytest`. Solo corre si haces:
 *
 *   npm i -D @playwright/test && npx playwright install
 *   npx playwright test
 *
 * webServer arranca la app (Flask). Si ya hay un server en la URL, se
 * reutiliza (reuseExistingServer) para no duplicar procesos en CI.
 */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.SQ_BASE_URL || 'http://127.0.0.1:5000',
    headless: true,
  },
  webServer: {
    // Override con SQ_WEB_CMD si tu arranque es distinto (p.ej. launcher.pyw).
    command:
      process.env.SQ_WEB_CMD ||
      'python -m flask --app interno/silly/app.py run --port 5000 --debug',
    url: process.env.SQ_BASE_URL || 'http://127.0.0.1:5000',
    reuseExistingServer: true,
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
