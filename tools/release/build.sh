#!/usr/bin/env bash
# tools/release/build.sh — build the files of a release, the same way on a laptop and in the workflow.
#
#   tools/release/build.sh <out-dir>                  # HEAD must carry the tag vX.Y.Z of its own version
#   tools/release/build.sh <out-dir> --tag v0.6.1     # the workflow names the tag it was started by
#   tools/release/build.sh <out-dir> --untagged       # a trial build of the working tree; not for a registry
#   tools/release/build.sh <out-dir> --skip-tests     # when the tests have just run on this commit
#
# Writes into <out-dir>, which must be new or empty:
#   studium-vX.Y.Z.vsix   the VS Code extension
#   lesson-mcp.cjs        the MCP server as one file, the one the VSIX embeds
#   SHA256SUMS.txt        checksums of the two files
#   npm-stage/            the npm package studium-mcp, ready for `npm publish`
#   BUILD                 what was built: version, tag (or "untagged") and commit; send.sh reads it
#
# It sends nothing anywhere: tools/release/send.sh and the release workflow do that.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
usage() { echo "usage: build.sh <out-dir> [--tag vX.Y.Z | --untagged] [--skip-tests]" >&2; exit 2; }

out="" tag="" untagged=0 tests=1
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || usage; tag="$2"; shift 2 ;;
    --untagged) untagged=1; shift ;;
    --skip-tests) tests=0; shift ;;
    -*) usage ;;
    *) [ -z "$out" ] || usage; out="$1"; shift ;;
  esac
done
[ -n "$out" ] || usage
[ -z "$tag" ] || [ "$untagged" -eq 0 ] || usage

cd "$root"
if command -v pnpm >/dev/null 2>&1; then pnpm=(pnpm); else pnpm=(corepack pnpm); fi
if command -v sha256sum >/dev/null 2>&1; then sha=(sha256sum); else sha=(shasum -a 256); fi
say() { printf '\n== %s\n' "$*"; }

say "Version"
node tools/release/version.mjs --check
version="$(node -p "require('./apps/studium-vscode/package.json').version")"
if [ "$untagged" -eq 0 ]; then
  [ -z "$(git status --porcelain)" ] || { echo "build: the working tree has uncommitted changes; commit them or use --untagged" >&2; exit 1; }
  [ -n "$tag" ] || tag="$(git describe --exact-match --tags --match 'v*.*.*' HEAD 2>/dev/null || true)"
  [ -n "$tag" ] || { echo "build: HEAD carries no tag vX.Y.Z; tag it, name one with --tag, or use --untagged" >&2; exit 1; }
  [ "$tag" = "v$version" ] || { echo "build: the tag $tag is not the version $version of apps/studium-vscode/package.json" >&2; exit 1; }
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null || { echo "build: this clone has no tag $tag; fetch it or create it, or use --untagged" >&2; exit 1; }
  [ "$(git rev-parse "$tag^{commit}")" = "$(git rev-parse HEAD)" ] || { echo "build: the tag $tag is not on HEAD" >&2; exit 1; }
fi

mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "build: $out is not empty; name a new folder" >&2; exit 1; }
out="$(cd "$out" && pwd)"

# The tests must not write into the maintainer's ~/.studium, nor call a model.
export STUDIUM_EPHEMERAL=1 LITELLM_BASE_URL=

say "Install and build"
"${pnpm[@]}" install --frozen-lockfile
"${pnpm[@]}" build:libs
# The extension's drivers read the panel renderer from apps/lesson-panel-ui/dist, which build:libs
# (packages only) does not produce.
"${pnpm[@]}" --filter @studium/lesson-panel-ui build

if [ "$tests" -eq 1 ]; then
  say "Tests of the extension and of the MCP server"
  "${pnpm[@]}" --filter studium-vscode test
  "${pnpm[@]}" --filter @studium/lesson-mcp test
fi

say "Package"
rm -f apps/studium-vscode/studium.vsix
"${pnpm[@]}" --filter studium-vscode package
.github/scripts/check-vsix.sh apps/studium-vscode/studium.vsix
packaged="$(unzip -p apps/studium-vscode/studium.vsix extension/package.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')"
[ "$packaged" = "$version" ] || { echo "build: the VSIX calls itself $packaged, not $version" >&2; exit 1; }

say "Release files"
cp apps/studium-vscode/studium.vsix "$out/studium-v$version.vsix"
cp apps/studium-vscode/dist/lesson-mcp.cjs "$out/lesson-mcp.cjs"
(cd "$out" && "${sha[@]}" "studium-v$version.vsix" lesson-mcp.cjs > SHA256SUMS.txt)
node .github/scripts/stage-npm-mcp.mjs "$version" "$out/npm-stage"
[ "$("$out/npm-stage/studium-mcp.cjs" --version)" = "$version" ] || { echo "build: the staged server does not answer $version to --version" >&2; exit 1; }
printf 'version=%s\ntag=%s\ncommit=%s\n' "$version" "$([ "$untagged" -eq 1 ] && echo untagged || echo "$tag")" "$(git rev-parse HEAD)" > "$out/BUILD"

say "Built $version$([ "$untagged" -eq 1 ] && echo ' (untagged trial, not for a registry)') in $out"
cat "$out/SHA256SUMS.txt"
