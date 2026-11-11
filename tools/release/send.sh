#!/usr/bin/env bash
# tools/release/send.sh — send a built release to the four registries, from the maintainer's machine.
# For when the release workflow cannot run. Run it from a checkout of the tagged commit.
#
#   tools/release/build.sh <out-dir>            # first: build the files
#   tools/release/send.sh <out-dir> --plan      # what would be sent; sends nothing, asks nothing
#   tools/release/send.sh <out-dir>             # asks before each registry
#
# A registry that already has the version is skipped, so the command can be run again after a failure.
# A registry that gives no answer is skipped too: nothing is sent blind.
#
# Accounts and tokens are the maintainer's. None is read from a file or written anywhere:
#   npm            your own `npm login`; npm asks for your second factor in a browser
#   Open VSX       OVSX_PAT in the environment, else asked at a hidden prompt
#   Marketplace    the file is uploaded by hand on the publisher's page (no token)
#   MCP Registry   GH_ORG_TOKEN in the environment, else asked at a hidden prompt: a fine-grained GitHub
#                  token whose resource owner is the organisation, permission Members read-only
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
usage() { echo "usage: send.sh <out-dir> [--plan]" >&2; exit 2; }
out="" plan=0
for arg in "$@"; do
  case "$arg" in
    --plan) plan=1 ;;
    -*) usage ;;
    *) [ -z "$out" ] || usage; out="$arg" ;;
  esac
done
[ -n "$out" ] && [ -d "$out" ] || usage
out="$(cd "$out" && pwd)"
cd "$root"

if command -v sha256sum >/dev/null 2>&1; then sha=(sha256sum); else sha=(shasum -a 256); fi
# STUDIUM_RELEASE_REGISTRIES replaces the status command in tools/release/send.test.sh only.
registries="${STUDIUM_RELEASE_REGISTRIES:-node tools/release/registries.mjs}"
say() { printf '\n== %s\n' "$*"; }

# What is about to be sent is what build.sh wrote, and the checkout is the version it was built from.
[ -f "$out/npm-stage/package.json" ] || { echo "send: $out holds no npm-stage/; run tools/release/build.sh first" >&2; exit 1; }
version="$(node -p "require('$out/npm-stage/package.json').version")"
vsix="$out/studium-v$version.vsix"
[ -f "$vsix" ] || { echo "send: $vsix is missing" >&2; exit 1; }
(cd "$out" && "${sha[@]}" -c SHA256SUMS.txt >/dev/null) || { echo "send: the files of $out do not match SHA256SUMS.txt" >&2; exit 1; }
[ "$(node -p "require('./server.json').version")" = "$version" ] || { echo "send: this checkout's server.json is not at $version; check out the tag v$version" >&2; exit 1; }

say "Studium $version, from $out"
$registries status "$version"

# state <registry>: "present", "absent" or "unknown".
state() {
  local rc=0
  $registries has "$1" "$version" >/dev/null 2>&1 || rc=$?
  case "$rc" in 0) echo present ;; 1) echo absent ;; *) echo unknown ;; esac
}
# go <registry> <what is sent>: true when this registry is to be sent to now.
go() {
  local reply
  case "$(state "$1")" in
    present) echo "$1: already has $version, skipped"; return 1 ;;
    unknown) echo "$1: the registry gave no answer, skipped; run the command again later"; return 1 ;;
  esac
  if [ "$plan" -eq 1 ]; then echo "$1: would send $2"; return 1; fi
  read -r -p "$1: send $2? [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || { echo "$1: not sent"; return 1; }
}
# secret <variable> <prompt>: the variable from the environment, else typed without echo.
secret() {
  if [ -z "${!1:-}" ]; then
    read -rs -p "$2: " "$1"; echo
    [ -n "${!1}" ] || { echo "send: nothing typed" >&2; return 1; }
  fi
}

say "npm"
if go npm "npm-stage/ as studium-mcp@$version"; then
  npm whoami >/dev/null 2>&1 || { echo "send: not logged in to npm; run \`npm login\`, then this command again" >&2; exit 1; }
  (cd "$out/npm-stage" && npm publish --access public)
fi

say "Open VSX"
if go open-vsx "$(basename "$vsix")"; then
  secret OVSX_PAT "Open VSX token"
  OVSX_PAT="$OVSX_PAT" npx --yes ovsx@1.2.0 publish "$vsix"
fi

say "Visual Studio Marketplace"
if go marketplace "$(basename "$vsix") (by hand)"; then
  echo "Open https://marketplace.visualstudio.com/manage/publishers/holobiomicslab"
  echo "On the line « Studium », choose « … », then « Update », and give this file:"
  echo "  $vsix"
  read -r -p "Press Enter once the upload is accepted. " _
fi

say "MCP Registry"
if go mcp-registry "server.json as io.github.HolobiomicsLab/studium $version"; then
  command -v mcp-publisher >/dev/null 2>&1 || { echo "send: mcp-publisher is not installed (brew install mcp-publisher)" >&2; exit 1; }
  # The registry checks the npm package, which can take a few minutes to appear.
  $registries wait npm "$version" --minutes 10
  secret GH_ORG_TOKEN "GitHub token of the organisation (Members, read-only)"
  # One line: the registry session lasts a few minutes.
  mcp-publisher login github --token "$GH_ORG_TOKEN" && mcp-publisher publish
fi

say "Where $version is now"
$registries status "$version"
[ "$plan" -eq 1 ] || echo "The Marketplace and Open VSX can take a few minutes to show a version they accepted."
