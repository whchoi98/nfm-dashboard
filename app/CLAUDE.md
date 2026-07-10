# app — Next.js Dashboard Module

## Role
Next.js 16 (App Router) + React 19 dashboard workspace. Serves the UI pages, the entire API surface (`src/app/api/*` route handlers), and all server-side data access for the NFM dashboard. Shipped as a standalone container (see `Dockerfile`) to ECS Fargate.

## Key Files
- `src/app/` — App Router pages: flows, topology, paths, workload, monitors, insights, diagnose, agents, chat-popup, login
- `src/app/api/` — route handlers (see `src/app/api/CLAUDE.md`)
- `src/lib/` — data access, Bedrock/MCP clients, i18n, tokens (see `src/lib/CLAUDE.md`)
- `src/components/` — presentational components (see `src/components/CLAUDE.md`)
- `src/middleware.ts` — Cognito session gate + CloudFront origin-verify
- `tailwind.config.ts` — Tailwind v4 / SnowUI tokens (mirrored by `src/lib/chart-tokens.ts`)
- `Dockerfile` — production image (linux/arm64) built by `scripts/build-push.sh`
- `vitest.config.ts` — test runner config

## Rules
- Commands: `npm -w app run dev` / `npm -w app run build` / `npx -w app vitest run` / `npx -w app tsc --noEmit` (run from repo root).
- All UI strings through `t()` (`src/lib/i18n`), translated in both `ko.json` and `en.json`.
- Chart/UI colors only from `src/lib/chart-tokens.ts` — never hardcode hex values in components.
- AWS SDK usage is server-only (`src/lib`, route handlers); never import it into client components.
- Tests co-located next to source (`*.test.ts` / `*.test.tsx`).
