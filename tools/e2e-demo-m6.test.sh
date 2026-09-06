#!/usr/bin/env bash
# Smoke test pour tools/e2e-demo-m6.sh — vérifie syntaxe + --help, puis exerce
# le bloc d'assertions de l'étape 6 avec un `curl` bouchonné (INT-STUDIUM-021).
#
# Pourquoi bouchonner : l'étape 6 vit derrière `if [[ "$MODE" != "no-tauri" ]]`,
# et sur macOS le script force `MODE="no-tauri"`. Le bloc n'a donc jamais tourné
# sur la machine du mainteneur, et trois défauts y ont survécu : l'en-tête
# `X-Course-Token` absent (401 sur les trois routes), des filtres jq lisant des
# champs que le collector n'émet pas, et sous `set -euo pipefail` une
# substitution de commande qui avorte le script avant tout diagnostic `FAIL:`.
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

# ── Étape 6 sous bouchon ─────────────────────────────────────────────────────

command -v jq > /dev/null || { echo "SKIP: jq absent — tests 5-8 non exécutés"; exit 0; }

# Test 5: le script est sourçable pour test. Vérifié AVANT de le sourcer : sans
# le garde, `source` exécuterait la démo entière (build du bundle, uvicorn, pnpm).
grep -q 'E2E_M6_LIB' "$SCRIPT" || {
  echo "FAIL: no E2E_M6_LIB guard — the step-6 block cannot be exercised without"
  echo "      running the whole demo, which is how its defects survived"
  exit 1
}

defined=$(E2E_M6_LIB=1 bash -c 'source "$1"; declare -F collector_get assert_metrics' _ "$SCRIPT") || {
  echo "FAIL: sourcing with E2E_M6_LIB=1 should define the helpers and return 0"
  exit 1
}
for fn in collector_get assert_metrics; do
  echo "$defined" | grep -qx "$fn" || { echo "FAIL: $fn is not defined when sourced"; exit 1; }
done

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

# Bouchon `curl` : journalise son argv et répond avec les VRAIES formes du
# collector — {"scenes": {...}} (metrics.compute_progress), {"concepts": {...}}
# (store.read_concept_mastery_history) et {"entries_total": n}
# (metrics.compute_journal_metrics). Un filtre jq qui lit un autre nom lira null.
cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
url="${@: -1}"
if [[ -n "${STUB_FAIL_ON:-}" && "$url" == *"$STUB_FAIL_ON"* ]]; then
  exit 22   # curl -f sur une réponse HTTP >= 400, ce que rend un 401
fi
case "$url" in
  *metrics/progress*)
    sep=""; out='{"scenes":{'
    for i in 1 2 3 4 5 6 7 8 9 10; do
      out+="$sep\"s$i\":{\"completion_rate\":1.0,\"n_learners\":2}"; sep=","
    done
    printf '%s}}' "$out" ;;
  *metrics/concept-mastery-history*) printf '{"concepts":{}}' ;;
  *metrics/journal*) printf '{"entries_total":4,"mean_length":120.0,"revision_rate":0.0,"entries_by_scene":{}}' ;;
  *) printf '{}' ;;
esac
STUB
chmod +x "$STUB_DIR/curl"

run_assert_metrics() {  # $1 = URL fragment sur lequel le bouchon échoue ("" = aucun)
  E2E_M6_LIB=1 CURL_LOG="$STUB_DIR/log" STUB_FAIL_ON="$1" PATH="$STUB_DIR:$PATH" \
    bash -c 'source "$1"; assert_metrics' _ "$SCRIPT" 2>&1
}

# Test 6: les trois appels portent l'en-tête. Le collector garde chaque route
# /metrics par `_require_course_token` (parité ADR 011) : le paramètre de requête
# `?course=` porte la même valeur mais la garde ne lit que l'en-tête.
: > "$STUB_DIR/log"
run_assert_metrics "" > /dev/null || { echo "FAIL: assert_metrics should pass on well-shaped responses"; exit 1; }
calls=$(wc -l < "$STUB_DIR/log" | tr -d ' ')
[[ "$calls" -eq 3 ]] || { echo "FAIL: expected 3 collector calls, saw $calls"; exit 1; }
headed=$(grep -c 'X-Course-Token: demo-m6' "$STUB_DIR/log" || true)
[[ "$headed" -eq 3 ]] || {
  echo "FAIL: $headed/3 calls carried X-Course-Token — every /metrics route 401s without it"
  cat "$STUB_DIR/log"
  exit 1
}

# Test 7: un curl qui échoue nomme sa requête. Sans cela, `set -euo pipefail`
# avorte la substitution de commande et la seule sortie est `[M6] cleanup (rc=1)`,
# qui se lit comme une panne d'infrastructure et non comme un en-tête manquant.
: > "$STUB_DIR/log"
set +e
out=$(run_assert_metrics "metrics/journal")
rc=$?
set -e
[[ "$rc" -ne 0 ]] || { echo "FAIL: a failing curl must not leave assert_metrics green"; exit 1; }
echo "$out" | grep -q "metrics/journal" || {
  echo "FAIL: the diagnostic must name the failing request; got:"
  echo "$out"
  exit 1
}

# Test 8: les filtres jq lisent les champs réels. Une réponse dont le compte est
# sous le seuil doit échouer — preuve que le filtre lit bien la réponse et ne
# renvoie pas 0 (ou null) quel que soit son contenu.
: > "$STUB_DIR/log"
cat > "$STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
url="${@: -1}"
case "$url" in
  *metrics/progress*) printf '{"scenes":{"s1":{"completion_rate":1.0,"n_learners":1}}}' ;;
  *metrics/concept-mastery-history*) printf '{"concepts":{}}' ;;
  *metrics/journal*) printf '{"entries_total":4}' ;;
  *) printf '{}' ;;
esac
STUB
chmod +x "$STUB_DIR/curl"
set +e
out=$(run_assert_metrics "")
rc=$?
set -e
[[ "$rc" -ne 0 ]] || { echo "FAIL: 1 completed scene must not satisfy the ≥ 10 threshold"; exit 1; }

echo "OK: e2e-demo-m6.sh smoke tests pass"
