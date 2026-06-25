#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo "          QTS_Startup"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20 or newer."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install --no-audit --no-fund
fi

echo
echo "Starting API + UI..."
echo "  Login: http://localhost:1027/login"
echo "  API:   http://localhost:1028/api"
echo
echo "Press Ctrl+C to stop, or run: npm run stop"
echo

npm start
