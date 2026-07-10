---
description: Execute the full test suite (app vitest + collector tests + tsc) and report results
allowed-tools: Read, Bash(npx -w app vitest:*), Bash(npm -w collector test:*), Bash(npx -w app tsc:*), Glob
---

# Test All

Execute the full test suite for this monorepo (workspaces: `app`, `collector`, `infra`).

## Step 1: Run Tests

Run the full suite. Run each part separately so a failure in one workspace does not hide results from the others:

```bash
# app unit tests (Vitest)
npx -w app vitest run

# collector tests
npm -w collector test

# typecheck (serves as lint for this project)
npx -w app tsc --noEmit
```

Equivalent one-liner when a single pass/fail answer is enough:

```bash
npx -w app vitest run && npm -w collector test && npx -w app tsc --noEmit
```

## Step 2: Report

Present:
- Total tests run, passed, failed, skipped (per workspace)
- Failed test details with file paths and error messages
- tsc errors with file:line locations
- Suggest fixes for failing tests if the cause is apparent

## Error Recovery

### If the test runner itself fails
```bash
npm install                       # Missing/stale node_modules (root installs all workspaces)
npx -w app vitest run --reporter=verbose   # More detail on collection errors
```

### Common failure categories and fixes

| Failure Pattern | Likely Cause | Fix |
|---|---|---|
| "Cannot find module" | Missing deps after pull/branch switch | `npm install` at repo root |
| vitest collects 0 tests | Wrong cwd or glob | Run via `npx -w app vitest run`, not inside subdir |
| tsc errors only | Types drifted from implementation | Fix types; do not add `any` to silence |
| collector test env errors | Missing env/AWS mocks | Check collector test setup files |

### If many tests fail at once
Likely a structural change broke multiple assumptions:
1. `git log -1` — what was the last change?
2. `git diff HEAD~1` — what specifically changed?
3. Fix the root cause, not individual tests
