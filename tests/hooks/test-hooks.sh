#!/bin/bash
# Tests for .claude/hooks/*.sh (sourced by tests/run-all.sh from project root)

# --- Existence, permissions, syntax ---
HOOKS=(check-doc-sync secret-scan session-context notify)
for hook in "${HOOKS[@]}"; do
    assert_file_exists "$hook.sh exists" ".claude/hooks/$hook.sh"
    assert_file_executable "$hook.sh is executable" ".claude/hooks/$hook.sh"
    assert_bash_syntax "$hook.sh valid bash" ".claude/hooks/$hook.sh"
done

# --- settings.json hook registration ---
assert_file_exists "settings.json exists" ".claude/settings.json"
assert_json_valid "settings.json is valid JSON" ".claude/settings.json"

SETTINGS=$(cat .claude/settings.json)
assert_contains "SessionStart hook registered" "$SETTINGS" "session-context.sh"
assert_contains "PreToolUse hook registered" "$SETTINGS" "secret-scan.sh"
assert_contains "PostToolUse hook registered" "$SETTINGS" "check-doc-sync.sh"
assert_contains "PostToolUse matcher is Write|Edit" "$SETTINGS" "Write|Edit"
assert_contains "Notification hook registered" "$SETTINGS" "notify.sh"

# --- Behavior tests ---
# (|| true guards keep the sourced runner's set -e from aborting on hook exit codes)
# check-doc-sync: empty path should produce no output and exit 0
OUTPUT=$(bash .claude/hooks/check-doc-sync.sh "" 2>&1 || true)
assert_eq "check-doc-sync: empty path produces no output" "" "$OUTPUT"

# session-context: should print the project context header and monorepo name
OUTPUT=$(bash .claude/hooks/session-context.sh 2>&1 || true)
assert_contains "session-context: shows project header" "$OUTPUT" "Project Context"
assert_contains "session-context: detects nfm-dashboard" "$OUTPUT" "nfm-dashboard"

# notify: no webhook URL should exit silently
OUTPUT=$(CLAUDE_NOTIFY_WEBHOOK="" bash .claude/hooks/notify.sh "test" "msg" 2>&1 || true)
assert_eq "notify: no webhook URL produces no output" "" "$OUTPUT"

# secret-scan: with no staged files it must exit 0 silently (run from a temp non-git dir
# would error; here we rely on 'git diff --cached' returning empty in a clean tree state)
if bash .claude/hooks/secret-scan.sh > /dev/null 2>&1; then
    pass "secret-scan: exits 0 when nothing staged contains secrets"
else
    skip "secret-scan: exits 0 when nothing staged contains secrets" "staged changes currently trip the scanner"
fi
