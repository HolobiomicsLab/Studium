#!/usr/bin/env bash
# Check that a Studium VSIX carries what the installed extension needs (ENG-06).
#
# A VSIX is a zip. The failures this guards against all shipped before: a `package` run that skipped
# `vendor` (no KaTeX / 3Dmol in the pane), a stale VSIX without the `package.nls*.json` manifests
# (English-only UI), and a package that picked up sources or node_modules.
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
require extension/media/vendor/marked.min.js
require extension/media/vendor/katex/katex.min.js
require extension/media/vendor/katex/katex.min.css
require extension/media/vendor/3Dmol-min.js
forbid '^extension/src/'
forbid '^extension/node_modules/'

if [ "$status" -eq 0 ]; then
  echo "check-vsix: OK ($(wc -l <<<"$listing" | tr -d ' ') entries in $vsix)"
fi
exit "$status"
