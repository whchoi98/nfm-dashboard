#!/bin/bash
# Secret detection pattern tests (TP = must match, FP = must NOT match).
# Patterns mirror .claude/hooks/secret-scan.sh.
# Sensitive-looking tokens are constructed at runtime via string concatenation
# to avoid triggering GitHub Push Protection on this repository itself.

# Patterns under test (keep in sync with .claude/hooks/secret-scan.sh)
SECRET_PATTERNS=(
    'AKIA[0-9A-Z]{16}'                          # AWS Access Key ID
    'sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}' # OpenAI API Key
    'sk-ant-[A-Za-z0-9-]{90,}'                   # Anthropic API Key
    'ghp_[A-Za-z0-9]{36}'                        # GitHub Personal Access Token
    'gho_[A-Za-z0-9]{36}'                        # GitHub OAuth Token
    'github_pat_[A-Za-z0-9_]{82}'                # GitHub Fine-grained PAT
    'xoxb-[0-9]+-[A-Za-z0-9-]+'                  # Slack Bot Token
    'xoxp-[0-9]+-[A-Za-z0-9-]+'                  # Slack User Token
    'sk_live_[A-Za-z0-9]{24,}'                   # Stripe Secret Key
    'rk_live_[A-Za-z0-9]{24,}'                   # Stripe Restricted Key
    'AIza[A-Za-z0-9_-]{35}'                      # Google API Key
    'ya29\.[A-Za-z0-9_-]{50,}'                   # Google OAuth Token
    'DefaultEndpointsProtocol=https;Account'     # Azure Connection String
    'password\s*[:=]\s*["\x27][^"\x27]{8,}'      # Password assignments
    'secret\s*[:=]\s*["\x27][^"\x27]{8,}'        # Secret assignments
    'api[_-]?key\s*[:=]\s*["\x27][^"\x27]{8,}'   # API key assignments
)

secret_matches_any() {
    local line="$1" regex
    for regex in "${SECRET_PATTERNS[@]}"; do
        if echo "$line" | grep -qP "$regex" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

# --- True positives: runtime-constructed tokens ---
SLACK_PREFIX="xoxb-"
SLACK_BODY="123456789012-1234567890123-abcdef"
assert_grep_match "TP: Slack Bot Token" 'xoxb-[0-9]+-[A-Za-z0-9-]+' "${SLACK_PREFIX}${SLACK_BODY}"

GH_PREFIX="ghp_"
GH_BODY="$(printf 'A%.0s' $(seq 1 36))"
assert_grep_match "TP: GitHub PAT" 'ghp_[A-Za-z0-9]{36}' "${GH_PREFIX}${GH_BODY}"

GOOG_PREFIX="AIza"
GOOG_BODY="$(printf 'B%.0s' $(seq 1 35))"
assert_grep_match "TP: Google API Key" 'AIza[A-Za-z0-9_-]{35}' "${GOOG_PREFIX}${GOOG_BODY}"

STRIPE_PREFIX="sk_live_"
STRIPE_BODY="$(printf 'C%.0s' $(seq 1 24))"
assert_grep_match "TP: Stripe Secret Key" 'sk_live_[A-Za-z0-9]{24,}' "${STRIPE_PREFIX}${STRIPE_BODY}"

ANTH_PREFIX="sk-ant-"
ANTH_BODY="$(printf 'd%.0s' $(seq 1 95))"
assert_grep_match "TP: Anthropic API Key" 'sk-ant-[A-Za-z0-9-]{90,}' "${ANTH_PREFIX}${ANTH_BODY}"

# --- True positives from fixture file (every non-comment line must match) ---
TP_FIXTURE="tests/fixtures/secret-samples.txt"
assert_file_exists "TP fixture file exists" "$TP_FIXTURE"
if [ -f "$TP_FIXTURE" ]; then
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        case "$line" in "#"*) continue ;; esac
        if secret_matches_any "$line"; then
            pass "TP fixture: '${line:0:45}'"
        else
            fail "TP fixture: '${line:0:45}'" "no secret pattern matched (should be detected)"
        fi
    done < "$TP_FIXTURE"
fi

# --- False positives from fixture file (no line may match) ---
FP_FIXTURE="tests/fixtures/false-positives.txt"
assert_file_exists "FP fixture file exists" "$FP_FIXTURE"
if [ -f "$FP_FIXTURE" ]; then
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        case "$line" in "#"*) continue ;; esac
        if secret_matches_any "$line"; then
            fail "FP fixture: '${line:0:45}'" "a secret pattern matched (should NOT be detected)"
        else
            pass "FP fixture: '${line:0:45}'"
        fi
    done < "$FP_FIXTURE"
fi

# --- Targeted false-positive checks ---
assert_grep_no_match "FP: normal base64 is not an AWS key" 'AKIA[0-9A-Z]{16}' "dGhpcyBpcyBhIHRlc3Q="
assert_grep_no_match "FP: empty password assignment" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = ""'
assert_grep_no_match "FP: xoxb without numeric team id" 'xoxb-[0-9]+-[A-Za-z0-9-]+' "xoxb-not-a-token"
