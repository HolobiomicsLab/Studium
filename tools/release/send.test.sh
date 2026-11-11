#!/usr/bin/env bash
# Tests of tools/release/send.sh. Nothing is sent: `npm`, `npx` and `mcp-publisher` are stand-ins on
# PATH that write down how they were called, and the registries' answers come from a folder.
#
#   bash tools/release/send.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEND="$ROOT/tools/release/send.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION="$(node -p "require('$ROOT/server.json').version")"
FAKE_NPM_TOKEN="ovsx-not-a-real-token" FAKE_ORG_TOKEN="org-not-a-real-token"
tests=0

# Stand-ins. Each appends one line to $CALLS: name, working folder, arguments, and whether OVSX_PAT is set.
mkdir -p "$TMP/bin"
for tool in npm npx mcp-publisher; do
  cat > "$TMP/bin/$tool" <<'EOF'
#!/usr/bin/env bash
name="$(basename "$0")"
if [ "$name" = npm ] && [ "${1:-}" = whoami ]; then [ -f "$STATE/npm-logged-out" ] && exit 1; echo someone; exit 0; fi
echo "$name | $(basename "$PWD") | $* | OVSX_PAT=${OVSX_PAT:+set}" >> "$CALLS"
EOF
  chmod +x "$TMP/bin/$tool"
done
# The registries: `has <registry>` exits with the number in $STATE/<registry> (0 there, 1 not, 2 no answer).
cat > "$TMP/registries" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  has) exit "$(cat "$STATE/$2")" ;;
  wait) echo "waited for $2" >> "$CALLS" ;;
  status) echo "(status of $2)" ;;
esac
EOF
chmod +x "$TMP/registries"

# A built release as build.sh leaves it.
fresh() {
  rm -rf "$TMP/out" "$TMP/state" "$TMP/calls"
  mkdir -p "$TMP/out/npm-stage" "$TMP/state"
  : > "$TMP/calls"
  echo "{\"name\":\"studium-mcp\",\"version\":\"$VERSION\"}" > "$TMP/out/npm-stage/package.json"
  echo vsix > "$TMP/out/studium-v$VERSION.vsix"
  echo server > "$TMP/out/lesson-mcp.cjs"
  (cd "$TMP/out" && shasum -a 256 "studium-v$VERSION.vsix" lesson-mcp.cjs > SHA256SUMS.txt)
  for registry in npm open-vsx marketplace mcp-registry; do echo "${1:-1}" > "$TMP/state/$registry"; done
}
OUTPUT="" STATUS=0
# send <stdin> [arguments]: run send.sh with the stand-ins.
send() {
  local answers="$1"; shift
  set +e
  OUTPUT="$(printf '%b' "$answers" | env PATH="$TMP/bin:$PATH" STATE="$TMP/state" CALLS="$TMP/calls" \
    STUDIUM_RELEASE_REGISTRIES="$TMP/registries" "$@" "$SEND" "$TMP/out" ${PLAN:+"$PLAN"} 2>&1)"
  STATUS=$?
  set -e
}
ok() { tests=$((tests + 1)); }
fail() { echo "FAIL: $1"; echo "--- output"; echo "$OUTPUT"; echo "--- calls"; cat "$TMP/calls"; exit 1; }
expect_status() { [ "$STATUS" -eq "$1" ] || fail "$2 (status $STATUS, expected $1)"; ok; }
expect_output() { grep -qF -- "$1" <<<"$OUTPUT" || fail "output lacks « $1 »"; ok; }
expect_call() { grep -qF -- "$1" "$TMP/calls" || fail "no call « $1 »"; ok; }
expect_calls() { [ "$(wc -l < "$TMP/calls" | tr -d ' ')" -eq "$1" ] || fail "$2 ($(wc -l < "$TMP/calls" | tr -d ' ') calls, expected $1)"; ok; }

# 1. --plan says what would go and calls nothing, asks nothing.
fresh
PLAN=--plan send ""
expect_status 0 "plan"
for registry in npm open-vsx marketplace mcp-registry; do expect_output "$registry: would send"; done
expect_calls 0 "plan must call nothing"

# 2. Yes everywhere, tokens in the environment: the four routes, in order, each with its own command.
fresh
send "y\ny\ny\n\ny\n" env OVSX_PAT="$FAKE_NPM_TOKEN" GH_ORG_TOKEN="$FAKE_ORG_TOKEN"
expect_status 0 "send all"
expect_call "npm | npm-stage | publish --access public"
expect_call "npx | $(basename "$ROOT") | --yes ovsx@1.2.0 publish $TMP/out/studium-v$VERSION.vsix | OVSX_PAT=set"
expect_output "$TMP/out/studium-v$VERSION.vsix"
expect_call "waited for npm"
expect_call "mcp-publisher | $(basename "$ROOT") | login github --token $FAKE_ORG_TOKEN"
expect_call "mcp-publisher | $(basename "$ROOT") | publish"
expect_calls 5 "send all"
if grep -F "npx" "$TMP/calls" | grep -qF "$FAKE_NPM_TOKEN"; then fail "the Open VSX token is on the command line"; fi; ok
if grep -qF -e "$FAKE_NPM_TOKEN" -e "$FAKE_ORG_TOKEN" <<<"$OUTPUT"; then fail "a token is printed"; fi; ok

# 3. A token that is not in the environment is asked for, and what is typed is not printed.
fresh; echo 0 > "$TMP/state/npm"; echo 0 > "$TMP/state/marketplace"; echo 0 > "$TMP/state/mcp-registry"
send "y\n$FAKE_NPM_TOKEN\n"
expect_status 0 "typed token"
expect_call "npx | $(basename "$ROOT") | --yes ovsx@1.2.0 publish $TMP/out/studium-v$VERSION.vsix | OVSX_PAT=set"
if grep -qF "$FAKE_NPM_TOKEN" <<<"$OUTPUT"; then fail "the typed token is printed"; fi; ok

# 4. No everywhere: nothing is called.
fresh
send "n\nn\nn\nn\n"
expect_status 0 "refuse all"
expect_output "npm: not sent"
expect_calls 0 "a refusal must call nothing"

# 5. A registry that already has the version, and one that gives no answer, are skipped without a question.
fresh 0; echo 2 > "$TMP/state/open-vsx"
send ""
expect_status 0 "present or unknown"
expect_output "npm: already has $VERSION, skipped"
expect_output "open-vsx: the registry gave no answer, skipped"
expect_calls 0 "nothing to send"

# 6. Files that do not match their checksums stop everything.
fresh; echo tampered >> "$TMP/out/studium-v$VERSION.vsix"
send "y\ny\ny\n\ny\n"
expect_status 1 "tampered file"
expect_output "do not match SHA256SUMS.txt"
expect_calls 0 "a tampered file must stop before any call"

# 7. Files of another version than the checkout stop everything.
fresh; echo '{"name":"studium-mcp","version":"9.9.9"}' > "$TMP/out/npm-stage/package.json"; echo vsix > "$TMP/out/studium-v9.9.9.vsix"
send "y\n"
expect_status 1 "other version"
expect_calls 0 "another version must stop before any call"

# 8. Without an npm login, the command stops and says what to do.
fresh; : > "$TMP/state/npm-logged-out"
send "y\n"
expect_status 1 "npm logged out"
expect_output "npm login"
expect_calls 0 "no upload without a login"

echo "OK — send.sh passed all $tests assertions."
