import { defineConfig, devices } from '@playwright/test';

/**
 * Live smoke suite against the deployed CloudFront URL.
 *
 * Required env (scripts/smoke.sh sets them):
 *   APP_URL           — e.g. https://dv4r4bnlhlpcx.cloudfront.net (always)
 *   E2E_AUTH_DISABLED — '1' when the deployed `authDisabled` CDK context is on
 *   E2E_EMAIL / E2E_PASSWORD — Cognito admin creds, auth-on mode only
 *                       (from Secrets Manager `nfm-dashboard/cognito-admin`)
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
  workers: 1, // spec 1 logs in (or enters directly when auth is off) and saves storageState for specs 2-3
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
