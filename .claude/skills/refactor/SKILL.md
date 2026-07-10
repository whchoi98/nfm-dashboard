---
name: refactor
description: Refactor existing code to improve quality using SRP, DRY, and incremental steps. Use when mentioning refactoring, code cleanup, or code improvement.
---

# Refactor Skill

Refactor existing code to improve quality without changing behavior.

## Principles
- Improve structure without changing behavior
- Single Responsibility Principle (SRP)
- Remove duplicate code (DRY)
- Small, incremental steps with verification

## Process

### 1. Analysis
- Identify the target code and its tests
- Map all callers and dependencies
- Confirm test coverage exists (suggest adding tests first if not)

### 2. Plan
Present the refactoring plan to the user:
- What will change
- What will NOT change (behavior preservation)
- Risk assessment (low/medium/high)

### 3. Execute
- Make changes in small, verifiable steps
- Run tests after each step if possible:
  - `app/` changes: `npx -w app vitest run`
  - `collector/` changes: `npm -w collector test`
- Keep commits atomic

### 4. Verify
- Confirm all existing tests pass:
  `npx -w app vitest run && npm -w collector test && npx -w app tsc --noEmit`
- Verify no behavior changes
- Check that the refactoring achieved its goal
