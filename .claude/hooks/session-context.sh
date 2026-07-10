#!/bin/bash
# Load project context at Claude Code session start.
# Outputs key project information for immediate context.

echo "=== Project Context ==="

# Project type detection (Node.js npm-workspaces monorepo)
if [ -f "package.json" ]; then
    NAME=$(node -e "console.log(require('./package.json').name || '')" 2>/dev/null)
    echo "Project: ${NAME:-$(basename "$(pwd)")} (Node.js)"
    WORKSPACES=$(node -e "console.log((require('./package.json').workspaces || []).join(', '))" 2>/dev/null)
    [ -n "$WORKSPACES" ] && echo "Workspaces: $WORKSPACES"
elif [ -f "pyproject.toml" ]; then
    echo "Project: $(basename "$(pwd)") (Python)"
elif [ -f "go.mod" ]; then
    MODULE=$(head -1 go.mod | awk '{print $2}')
    echo "Project: $MODULE (Go)"
elif [ -f "Cargo.toml" ]; then
    echo "Project: $(basename "$(pwd)") (Rust)"
else
    echo "Project: $(basename "$(pwd)")"
fi

# Recent activity
LAST_COMMIT=$(git log -1 --format="%h %s (%cr)" 2>/dev/null)
[ -n "$LAST_COMMIT" ] && echo "Last commit: $LAST_COMMIT"

# Branch info
BRANCH=$(git branch --show-current 2>/dev/null)
[ -n "$BRANCH" ] && echo "Branch: $BRANCH"

# Uncommitted changes
CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "$CHANGES" -gt 0 ] && echo "Uncommitted changes: $CHANGES file(s)"

# Documentation status
CLAUDE_COUNT=$(find . -name "CLAUDE.md" -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
echo "CLAUDE.md files: $CLAUDE_COUNT"

echo "======================"
