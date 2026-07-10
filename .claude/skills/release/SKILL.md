---
name: release
description: Automate the release process with semver, CHANGELOG, tags, and release notes. Use when mentioning release, versioning, changelog, or tagging.
---

# Release Skill

Automate the release process with validation checks.

## Procedure

### 1. Pre-release Checks
- Verify working tree is clean: `git status`
- Verify all tests pass:
  `npx -w app vitest run && npm -w collector test && npx -w app tsc --noEmit`
- Verify the app builds: `npm -w app run build`
- Check for uncommitted changes

### 2. Determine Version
- Review changes since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Apply semver rules:
  - MAJOR: Breaking API changes
  - MINOR: New features, backward compatible
  - PATCH: Bug fixes only

### 3. Update Changelog
- Group changes by type (Added, Changed, Fixed, Removed)
- Include commit references
- Add date and version header

### 4. Create Release
- Update version in relevant files (root `package.json`, `app/package.json` — the sidebar version label reads from it, `CHANGELOG.md`)
- Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- Generate release notes

### 5. Summary
- Display version bump
- List key changes
- Show next steps. Note: this repo has **no git remote** — there is no tag push step. Deployment is the release vehicle: `bash scripts/build-push.sh <sha>` then `cd infra && npx cdk deploy NfmDash-App --require-approval never -c imageTag=<sha>` (see `/deploy`).
