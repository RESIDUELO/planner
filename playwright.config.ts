import { defineConfig } from '@playwright/test';

const PORT = 3100;
const DB = 'postgres://rp_owner:rp_owner@localhost:5432/residencia_planner_e2e';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `bash scripts/e2e-server.sh`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_DB_URL: DB, PORT: String(PORT) },
  },
});
