#!/usr/bin/env bash
# setup.sh — one command to get a tester from a fresh clone to a runnable lesson.
#
# Installs the workspace, vendors the render libraries for offline use, and builds
# the VS Code extension. It deliberately does NOT run `pnpm -r build`: that builds
# apps a tester does not need, and costs minutes for nothing. It no longer FAILS —
# measured 2026-09-08 on `dev`, `pnpm build` exits 0 over 18 workspaces, the
# teacher-dashboard included, and leaves the tree clean — so the reason to skip it
# is time, not breakage. See TESTING.md.
#
# Safe to re-run.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf '\nerror: %s\n' "$1" >&2; exit 1; }
step() { printf '\n==> %s\n' "$1"; }

# ---------------------------------------------------------------- preflight ---
# Node and pnpm are hard requirements: nothing below works without them.
step "Checking toolchain"

command -v node >/dev/null 2>&1 || fail "node not found. Install Node 20 or newer (https://nodejs.org)."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || fail "Node $(node -v) is too old; Studium needs Node 20 or newer."
printf '    node    %s\n' "$(node -v)"

command -v pnpm >/dev/null 2>&1 || fail "pnpm not found. Run 'corepack enable' (ships with Node), then re-run ./setup.sh"
pnpm_major="$(pnpm -v | cut -d. -f1)"
[ "$pnpm_major" -ge 9 ] || fail "pnpm $(pnpm -v) is too old; Studium needs pnpm 9 or newer. Run 'corepack enable'."
printf '    pnpm    %s\n' "$(pnpm -v)"

# Python is NOT needed for the lesson you are about to run. It is needed only for
# the optional evaluation harness (eval/run_eval.py) and the teacher class report
# (tools/class_report.py). So this is a warning, never a failure.
#
# Note: on a stock macOS, `python3` is Xcode's 3.9 — too old. We look for a real
# 3.12+ first and only report what we find.
py=""
for cand in python3.13 python3.12 python3; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    py="$cand"; break
  fi
done
if [ -n "$py" ]; then
  printf '    python  %s (%s)\n' "$("$py" --version 2>&1 | cut -d' ' -f2)" "$py"
else
  printf '    python  none >= 3.12 found — fine for the lesson; needed only for the\n'
  printf '            eval harness and the teacher class report. See README.md.\n'
fi

# ------------------------------------------------------------------ install ---
step "Installing workspace dependencies (pnpm install)"
pnpm install

# The extension spawns the lesson-mcp server over stdio (extension.ts), and that server
# imports workspace packages that resolve to their built dist/ — @studium/llm-client above
# all. A fresh clone has no dist/, so without this step the lesson dies on F5 with
# ERR_MODULE_NOT_FOUND. `build:libs` builds every workspace library (never the apps, so
# never the apps, so never a minutes-long Next.js build); CI runs the same script, so the
# two cannot drift.
step "Building the workspace libraries the lesson server needs"
pnpm build:libs

step "Vendoring render libraries for offline use"
pnpm --filter studium-vscode vendor

step "Building the VS Code extension"
pnpm --filter studium-vscode build

# ------------------------------------------------------------------- verify ---
# Assert the two artifacts the extension needs at runtime, so a silent partial
# install cannot masquerade as success.
step "Verifying build output"
[ -f apps/studium-vscode/dist/extension.js ] || fail "build produced no apps/studium-vscode/dist/extension.js"
[ -d apps/studium-vscode/dist/panel/vendor ] || fail "vendor step produced no apps/studium-vscode/dist/panel/vendor/"
[ -f apps/studium-vscode/dist/panel/vendor/katex/katex.min.js ] || fail "vendor step did not copy KaTeX"
[ -f apps/studium-vscode/dist/panel/vendor/3Dmol-min.js ] || fail "vendor step did not copy 3Dmol"
# Without this the extension launches and then dies on the first scene.
[ -f packages/llm-client/dist/index.js ] || fail "workspace build produced no packages/llm-client/dist/index.js — the lesson server cannot start"
printf '    dist/extension.js, dist/panel/vendor/, and the lesson-server deps are present\n'

printf '\nSetup complete.\n\n'
printf 'Next step: open the folder apps/studium-vscode in VS Code and press F5 (fn+F5 on a Mac).\n'
