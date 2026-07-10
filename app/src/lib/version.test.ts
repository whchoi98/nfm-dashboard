import { it, expect } from 'vitest';
import pkg from '../../package.json';
import { APP_VERSION } from './version';

// CHANGELOG.md's top entry is kept in sync by convention (parsing markdown
// here would be overkill) — this test pins the machine-readable pair.
it('APP_VERSION matches app/package.json version (single source of truth)', () => {
  expect(APP_VERSION).toBe(pkg.version);
});
