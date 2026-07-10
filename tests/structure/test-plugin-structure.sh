#!/bin/bash
# Structure tests for the nfm-dashboard npm-workspaces monorepo
# (app: Next.js dashboard / collector: Lambda / infra: CDK).
# Sourced by tests/run-all.sh from the project root.

# --- Manifest validation ---
assert_file_exists "root package.json exists" "package.json"
assert_json_valid "root package.json is valid JSON" "package.json"
assert_file_exists ".claude/settings.json exists" ".claude/settings.json"
assert_json_valid ".claude/settings.json is valid JSON" ".claude/settings.json"

ROOT_PKG=$(cat package.json)
assert_contains "root package.json declares workspaces" "$ROOT_PKG" '"workspaces"'

# --- npm workspaces layout (app / collector / infra) ---
for ws in app collector infra; do
    assert_dir_exists "workspace $ws/ exists" "$ws"
    assert_file_exists "$ws/package.json exists" "$ws/package.json"
    assert_json_valid "$ws/package.json is valid JSON" "$ws/package.json"
done

# --- Core docs ---
assert_file_exists "Root CLAUDE.md exists" "CLAUDE.md"
assert_file_exists "README.md exists" "README.md"
assert_file_exists "CHANGELOG.md exists" "CHANGELOG.md"

# --- Version consistency: app/src/lib/version.ts <-> app/package.json <-> CHANGELOG ---
assert_file_exists "app/src/lib/version.ts exists" "app/src/lib/version.ts"
APP_PKG_VER=$(node -e "console.log(require('./app/package.json').version || '')" 2>/dev/null || echo "")
APP_TS_VER=$(grep -oP "APP_VERSION\s*=\s*'\K[0-9]+\.[0-9]+\.[0-9]+" app/src/lib/version.ts 2>/dev/null || echo "")
if [ -n "$APP_PKG_VER" ] && [ -n "$APP_TS_VER" ]; then
    assert_eq "APP_VERSION matches app/package.json version" "$APP_PKG_VER" "$APP_TS_VER"
else
    fail "APP_VERSION matches app/package.json version" "could not extract versions (pkg='$APP_PKG_VER', ts='$APP_TS_VER')"
fi
if [ -n "$APP_TS_VER" ] && [ -f "CHANGELOG.md" ]; then
    assert_contains "CHANGELOG.md mentions current version" "$(cat CHANGELOG.md)" "$APP_TS_VER"
fi

# --- Supporting files (project-init Step 14) ---
assert_file_exists ".gitignore exists" ".gitignore"
assert_file_exists ".env.example exists" ".env.example"
assert_file_exists ".editorconfig exists" ".editorconfig"

GITIGNORE=$(cat .gitignore)
for ignored in "node_modules" ".next" "cdk.out" ".env"; do
    assert_contains ".gitignore covers $ignored" "$GITIGNORE" "$ignored"
done

# .env.example must not contain a real-looking AWS access key
if grep -qP 'AKIA[0-9A-Z]{16}' .env.example 2>/dev/null; then
    fail ".env.example contains no AWS access key" "found AKIA-style key in .env.example"
else
    pass ".env.example contains no AWS access key"
fi

# --- Script validation ---
for script in setup.sh install-hooks.sh build-push.sh smoke.sh save-cognito-secret.sh; do
    assert_file_exists "scripts/$script exists" "scripts/$script"
    assert_file_executable "scripts/$script is executable" "scripts/$script"
    assert_bash_syntax "scripts/$script valid bash" "scripts/$script"
done
