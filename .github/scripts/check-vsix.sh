#!/usr/bin/env bash
# Check that a Studium VSIX carries what the installed extension needs (ENG-06).
#
# A VSIX is a zip. The failures this guards against all shipped before: a `package` run that skipped
# `vendor` (no KaTeX / 3Dmol in the pane), a stale VSIX without the `package.nls*.json` manifests
# (English-only UI), a package that picked up sources or node_modules, and one whose registry page was
# the developers' README (0.6.0).
#
#   .github/scripts/check-vsix.sh apps/studium-vscode/studium.vsix
set -euo pipefail

vsix="${1:?usage: check-vsix.sh <file.vsix>}"
[ -f "$vsix" ] || { echo "check-vsix: $vsix not found" >&2; exit 2; }

listing="$(unzip -Z1 "$vsix")"
status=0

require() {
  if ! grep -qxF "$1" <<<"$listing"; then
    echo "check-vsix: MISSING $1" >&2
    status=1
  fi
}
forbid() {
  if grep -q -- "$1" <<<"$listing"; then
    echo "check-vsix: UNEXPECTED entries matching $1:" >&2
    grep -- "$1" <<<"$listing" | head -5 >&2
    status=1
  fi
}

require extension/package.json
require extension/package.nls.json
require extension/package.nls.fr.json
require extension/dist/extension.js
require extension/dist/lesson-mcp.cjs
require extension/dist/panel/artifact-pane.js
require extension/dist/panel/graph-pane.js
require extension/dist/panel/bridge-vscode.js
require extension/dist/panel/VENDOR-LICENSES.md
require extension/dist/panel/vendor/marked.min.js
require extension/dist/panel/vendor/katex/katex.min.js
require extension/dist/panel/vendor/katex/katex.min.css
require extension/dist/panel/vendor/3Dmol-min.js
forbid '^extension/src/'
forbid '^extension/node_modules/'
forbid '^extension/README\.fr\.md$'

# The page the registries show is the listing (apps/studium-vscode/MARKETPLACE.md), not the developers'
# README, whose build commands and relative links mean nothing outside a checkout.
require extension/readme.md
if unzip -p "$vsix" extension/readme.md 2>/dev/null | grep -qE 'pnpm --filter|/blob/HEAD/\.\./'; then
  echo "check-vsix: extension/readme.md is the developers' README; package with --readme-path MARKETPLACE.md" >&2
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "check-vsix: OK ($(wc -l <<<"$listing" | tr -d ' ') entries in $vsix)"
fi
exit "$status"
