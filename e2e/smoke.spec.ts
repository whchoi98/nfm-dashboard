import { test, expect } from '@playwright/test';
import * as path from 'node:path';

// Auth session captured by spec 1, reused by specs 2-3 (gitignored).
const authFile = path.join(__dirname, '.auth.json');

// Explicit flag from scripts/smoke.sh (mirrors the deployed `authDisabled` CDK
// context). Deliberately NOT auto-detected from the landing URL: if auth should
// be ON but the middleware breaks, auto-detection would pass a broken deploy.
const authDisabled = process.env.E2E_AUTH_DISABLED === '1';

// Cognito credentials are only required when the login flow is exercised.
const required = authDisabled
  ? (['APP_URL'] as const)
  : (['APP_URL', 'E2E_EMAIL', 'E2E_PASSWORD'] as const);
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is not set — run via scripts/smoke.sh`);
}

// Serial: the login spec must succeed first (it writes the storageState);
// on its failure the dependent specs are skipped instead of failing noisily.
test.describe.serial('NFM Dashboard smoke', () => {
  test('login (auth on) / direct entry (auth off) → overview KPI renders', async ({ page }) => {
    await page.goto('/');
    if (authDisabled) {
      // AUTH_DISABLED deploy: '/' must render the overview directly — no /login redirect.
      await expect(page).not.toHaveURL(/\/login/);
    } else {
      // unauthenticated → middleware redirected to /login
      await page.locator('a[href="/api/auth/login"]').click(); // → Cognito Hosted UI
      await page.waitForURL(/amazoncognito\.com/, { timeout: 30_000 });
      // Classic Hosted UI renders duplicate desktop/mobile forms — target the visible one.
      await page.locator('input[name="username"]:visible').fill(process.env.E2E_EMAIL!);
      await page.locator('input[name="password"]:visible').fill(process.env.E2E_PASSWORD!);
      await page
        .locator('input[name="signInSubmitButton"]:visible, button[type="submit"]:visible')
        .first()
        .click();
      // PKCE callback → session cookie → overview.
    }
    // KPI card must render (an empty/collecting value still renders the card).
    await expect(page.getByTestId('kpi-dataTransferred')).toBeVisible({ timeout: 30_000 });
    // Always write the storageState — specs 2-3 consume it in both modes
    // (an anonymous state is fine when auth is disabled).
    await page.context().storageState({ path: authFile });
  });

  test.describe(() => {
    test.use({ storageState: authFile });

    test('chat SSE streams tokens', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('kpi-dataTransferred')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('floating-chat-fab').click();
      await page.getByTestId('chat-input').fill('top talker pod?');
      await page.getByTestId('chat-send').click();
      // Bedrock streaming can be slow on a cold path — allow up to 90s.
      const assistantMsg = page.getByTestId('chat-assistant-msg').last();
      await expect(assistantMsg).toContainText(/\w/, { timeout: 90_000 });
      // A rendered bubble is not enough — an error bubble also carries text.
      await expect(assistantMsg).not.toContainText(/error|오류|⚠️/i);
    });

    test.describe(() => {
      test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

      test('iphone viewport has no horizontal scroll', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('kpi-dataTransferred')).toBeVisible({ timeout: 30_000 });
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, 'documentElement must not overflow horizontally')
          .toBeLessThanOrEqual(clientWidth);
      });
    });
  });
});
