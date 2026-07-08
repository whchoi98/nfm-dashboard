import { defineConfig, devices } from '@playwright/test';

/**
 * Live smoke suite against the deployed CloudFront URL.
 *
 * Required env (scripts/smoke.sh sets all three):
 *   APP_URL      — e.g. https://dv4r4bnlhlpcx.cloudfront.net
 *   E2E_EMAIL    — Cognito admin email
 *   E2E_PASSWORD — from Secrets Manager `nfm-dashboard/cognito-admin` (never committed)
 *
 * Browser: the ms-playwright cache in this environment already contains
 * chromium_headless_shell-1228 (matches @playwright/test 1.61.x) — no
 * `playwright install` needed. Headless runs use the headless shell.
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 120_000, // chat SSE can take a while on a cold Bedrock path
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // spec 1 performs the login and saves storageState for specs 2-3
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
