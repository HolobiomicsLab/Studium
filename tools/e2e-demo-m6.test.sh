#!/usr/bin/env bash
# Smoke test pour tools/e2e-demo-m6.sh — vérifie syntaxe + --help.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/tools/e2e-demo-m6.sh"

# Test 1: existe et exécutable
test -x "$SCRIPT" || { echo "FAIL: script not executable"; exit 1; }

# Test 2: syntaxe valide
bash -n "$SCRIPT" || { echo "FAIL: bash syntax error"; exit 1; }

# Test 3: --help retourne 0 et imprime "Usage"
out=$("$SCRIPT" --help 2>&1)
echo "$out" | grep -q "Usage:" || { echo "FAIL: --help should print Usage"; exit 1; }

# Test 4: --no-tauri mode reconnu
"$SCRIPT" --help 2>&1 | grep -q -- "--no-tauri" || { echo "FAIL: --no-tauri should be documented"; exit 1; }

echo "OK: e2e-demo-m6.sh smoke tests pass"
