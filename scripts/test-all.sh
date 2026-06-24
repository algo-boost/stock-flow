#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Backend (pytest)"
cd "$ROOT/backend"
python -m pytest tests/ -q

echo ""
echo "==> Frontend (vitest)"
cd "$ROOT/frontend"
npm run test

echo ""
echo "All module tests passed."
