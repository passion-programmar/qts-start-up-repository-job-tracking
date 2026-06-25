#!/usr/bin/env bash
# Push to GitHub using a Personal Access Token (one-time setup).
# Usage:
#   export GITHUB_TOKEN=ghp_your_token_here
#   bash scripts/push-github.sh

set -euo pipefail

REPO="https://github.com/passion-programmar/qts-start-up-repository-job-tracking.git"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Missing GITHUB_TOKEN."
  echo ""
  echo "1. Open https://github.com/settings/tokens"
  echo "2. Generate new token (classic) with 'repo' scope"
  echo "3. Run:"
  echo "   export GITHUB_TOKEN=ghp_your_token_here"
  echo "   bash scripts/push-github.sh"
  exit 1
fi

git push "https://passion-programmar:${GITHUB_TOKEN}@github.com/passion-programmar/qts-start-up-repository-job-tracking.git" main

echo ""
echo "Done. Check: https://github.com/passion-programmar/qts-start-up-repository-job-tracking"
