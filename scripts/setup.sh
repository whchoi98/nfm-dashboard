#!/bin/bash
# nfm-dashboard setup script for new developers.
# npm-workspaces monorepo: app (Next.js) / collector (Lambda) / infra (CDK).
# Usage: bash scripts/setup.sh

set -e

echo "=== nfm-dashboard Setup ==="

# Check prerequisites
command -v git >/dev/null 2>&1 || { echo "ERROR: git is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node is required (see .nvmrc for the expected version)"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is required"; exit 1; }

if [ -f ".nvmrc" ]; then
    echo "Expected Node.js version: $(cat .nvmrc) (current: $(node --version))"
fi

# Install dependencies for all workspaces (app, collector, infra)
echo "Installing npm workspace dependencies (root)..."
npm install

# Build the collector Lambda bundle (required before any CDK deploy)
echo "Building collector Lambda..."
npm -w collector run build

# Setup environment
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "IMPORTANT: Edit .env with your actual values (secrets live in AWS Secrets Manager)"
fi

# Setup Claude Code hooks
if [ -d ".claude/hooks" ]; then
    chmod +x .claude/hooks/*.sh 2>/dev/null || true
    echo "Claude hooks configured"
fi

# Install git commit-msg hook (strips AI co-author lines)
if [ -d ".git" ] && [ -f "scripts/install-hooks.sh" ]; then
    bash scripts/install-hooks.sh
fi

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "  1. Local dev (no Cognito needed):  AUTH_DISABLED=1 npm -w app run dev"
echo "  2. Run tests:                       npm test  (collector vitest)"
echo "                                      npx -w app vitest run  (app vitest)"
echo "  3. Deploy (needs AWS credentials for ap-northeast-2):"
echo "       bash scripts/build-push.sh                     # build+push app image to ECR"
echo "       cd infra && npx cdk deploy NfmDash-Data NfmDash-App -c imageTag=<sha>"
echo "  4. Read CLAUDE.md and README.md for project conventions"
