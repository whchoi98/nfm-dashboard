# e2e — Playwright Live Smoke Suite

## Role
Post-deploy production gate: a live Playwright smoke suite that drives the deployed CloudFront app (not a local build) through login, the overview KPIs, the chat stream, and a mobile-viewport layout check. Runs headless with a single worker in serial order — the login spec authenticates first and hands its session to the rest.

## Key Files
- `playwright.config.ts` — `testDir: '.'`, `baseURL` from `APP_URL`, serial (`fullyParallel: false`, `workers: 1`, `retries: 0`), 120s timeout; `trace: 'retain-on-failure'` + `screenshot: 'only-on-failure'` into `./test-results`.
- `smoke.spec.ts` — 3 serial specs: (1) login → Cognito Hosted UI → PKCE callback → `getByTestId('kpi-dataTransferred')` renders on the overview; (2) chat SSE streams tokens via the `floating-chat-fab` → `chat-input`/`chat-send` → `chat-assistant-msg` (asserts non-error text, up to 90s for a cold Bedrock path); (3) iPhone viewport (390×844, `isMobile`) has no horizontal scroll (`scrollWidth <= clientWidth`).
- `.auth.json` — captured `storageState` written by spec 1 and reused by specs 2–3. Gitignored (`.gitignore`: `e2e/.auth.json`).

## Rules
- The smoke suite is the post-deploy prod gate — run it against the live URL after every `NfmDash-App` deploy.
- Always run via `scripts/smoke.sh`; it exports the required env (`APP_URL`, `E2E_EMAIL`, `E2E_PASSWORD`). `smoke.spec.ts` throws if any is missing.
- `APP_URL` comes from the `NfmDash-App` stack `AppUrl` output; `E2E_PASSWORD` is pulled from Secrets Manager `nfm-dashboard/cognito-admin` at runtime only — never write credentials to disk or commit them.
- Chat asserts on the assistant text NOT matching `error|오류|⚠️`: a rendered error bubble also carries text, so a visible bubble alone is not a pass.
