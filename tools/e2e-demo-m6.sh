#!/usr/bin/env bash
# Orchestration E2E démo M6 atomistique — pipeline 2-sessions cross-session
# + dashboard enseignant.
#
# Étapes :
#   1. Build fixture bundle demo-atomistique (fixtures/m6/demo-atomistique/build.sh)
#   2. Validation bundle Pydantic (services/scene-synth schema 1.4)
#   3. Démarrage analytics-collector port 8003
#   4. Démarrage teacher-dashboard port 3001
#   5. (Si pas --no-tauri) build Tauri release + WDIO 2-sessions
#   6. Assertions curl :
#        /metrics/progress?course=demo-m6 → scenes_completed ≥ 10
#        /metrics/concept-mastery-history?course=demo-m6 → ≥ 2 snapshots
#        /metrics/journal?course=demo-m6 → entries ≥ 2
#
# Modes :
#   --help        affiche ce help
#   --no-tauri    skip étapes 5 (smoke local macOS)
#   --ci          inclut WDIO E2E (CI Linux)
#
# Pré-requis :
#   - `uvicorn`, `python3.12`, `pnpm`, `jq`, `curl`, `bash` ≥ 5
#   - `services/analytics-collector` installé éditable
#   - macOS : --no-tauri obligatoire (tauri-driver Linux/Windows only)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTOR_PORT="${COLLECTOR_PORT:-8003}"
DASH_PORT="${DASH_PORT:-3001}"
DATA_DIR="${ANALYTICS_DATA_DIR:-/tmp/m6-demo-data}"
COURSE_TOKEN="demo-m6"
BUNDLE_PATH="$ROOT/fixtures/m6/demo-atomistique-bundle.zip"
WDIO_LOG="/tmp/m6-wdio.log"
MODE="full"

usage() {
  cat <<EOF
Usage: $0 [--help|--no-tauri|--ci]

Modes :
  --help       Affiche ce help.
  --no-tauri   Smoke local macOS : skip étape WDIO Tauri.
  --ci         CI Linux : inclut WDIO E2E.

Pré-requis :
  - uvicorn, python3.12, pnpm, jq, curl, bash ≥ 5
  - services/analytics-collector pip install -e
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help) usage; exit 0 ;;
    --no-tauri) MODE="no-tauri" ;;
    --ci) MODE="ci" ;;
    *) echo "Argument inconnu: $arg" >&2; usage; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Linux*|MINGW*|CYGWIN*|MSYS*)
    [[ "$MODE" == "full" ]] && MODE="ci"
    ;;
  *)
    if [[ "$MODE" == "full" ]]; then
      echo "[M6] macOS détecté — switch en mode --no-tauri (tauri-driver bloqué)."
      MODE="no-tauri"
    fi
    ;;
esac

mkdir -p "$DATA_DIR"
rm -rf "$DATA_DIR"/*.jsonl 2>/dev/null || true

cleanup() {
  local rc=$?
  echo "[M6] cleanup (rc=$rc)"
  [[ -n "${COLLECTOR_PID:-}" ]] && kill "$COLLECTOR_PID" 2>/dev/null || true
  [[ -n "${DASH_PID:-}" ]] && kill "$DASH_PID" 2>/dev/null || true
  return $rc
}
trap cleanup EXIT INT TERM

echo "[M6] Step 1 — build bundle fixture"
bash "$ROOT/fixtures/m6/demo-atomistique/build.sh"
test -f "$BUNDLE_PATH" || { echo "[M6] FAIL: bundle absent"; exit 3; }

echo "[M6] Step 2 — valider bundle (Pydantic)"
python3 -c "
import sys, json
sys.path.insert(0, '$ROOT/services/scene-synth')
from scene_synth_schemas import LessonBundle
data = json.loads(open('$ROOT/fixtures/m6/demo-atomistique/lesson.json').read())
b = LessonBundle.model_validate(data)
print(f'[M6] bundle OK: {b.bundle_id} schema={b.schema_version} scenes={len(b.scenes)}')
"

echo "[M6] Step 3 — start analytics-collector port $COLLECTOR_PORT"
(
  cd "$ROOT/services/analytics-collector" && \
  ANALYTICS_DATA_DIR="$DATA_DIR" \
    uvicorn analytics_collector_app:app \
    --host 127.0.0.1 --port "$COLLECTOR_PORT" \
    > /tmp/m6-collector.log 2>&1
) &
COLLECTOR_PID=$!
sleep 2
curl -fs "http://127.0.0.1:$COLLECTOR_PORT/health" > /dev/null \
  || { echo "[M6] FAIL: collector not up"; exit 4; }

echo "[M6] Step 4 — start teacher-dashboard port $DASH_PORT"
(cd "$ROOT/apps/teacher-dashboard" && \
  NEXT_PUBLIC_COLLECTOR_URL="http://127.0.0.1:$COLLECTOR_PORT" \
  PORT="$DASH_PORT" pnpm dev > /tmp/m6-dash.log 2>&1) &
DASH_PID=$!
sleep 5

if [[ "$MODE" != "no-tauri" ]]; then
  echo "[M6] Step 5 — build + run WDIO E2E"
  (cd "$ROOT/apps/student-runtime" && pnpm tauri:build --debug) \
    || { echo "[M6] FAIL: tauri build"; exit 5; }
  mkdir -p /tmp/studium-e2e
  cp "$BUNDLE_PATH" /tmp/studium-e2e/demo-atomistique.zip
  (cd "$ROOT/apps/student-runtime" && \
    pnpm wdio:run --spec tests-e2e/specs/demo-m6-atomistique.spec.ts \
    > "$WDIO_LOG" 2>&1) \
    || { echo "[M6] FAIL: WDIO"; tail -50 "$WDIO_LOG"; exit 6; }
  echo "[M6] WDIO OK"

  echo "[M6] Step 6 — assertions curl"
  progress=$(curl -fs "http://127.0.0.1:$COLLECTOR_PORT/metrics/progress?course=$COURSE_TOKEN")
  scenes_completed=$(echo "$progress" | jq -r '.scenes_completed // 0')
  [[ "$scenes_completed" -ge 10 ]] \
    || { echo "[M6] FAIL: scenes_completed=$scenes_completed < 10"; exit 7; }

  history=$(curl -fs "http://127.0.0.1:$COLLECTOR_PORT/metrics/concept-mastery-history?course=$COURSE_TOKEN")
  snapshots=$(echo "$history" | jq -r '.snapshots | length // 0')
  [[ "$snapshots" -ge 2 ]] \
    || { echo "[M6] FAIL: snapshots=$snapshots < 2"; exit 8; }

  journal=$(curl -fs "http://127.0.0.1:$COLLECTOR_PORT/metrics/journal?course=$COURSE_TOKEN")
  entries=$(echo "$journal" | jq -r '.entries // 0')
  [[ "$entries" -ge 2 ]] \
    || { echo "[M6] FAIL: journal entries=$entries < 2"; exit 9; }
fi

echo "[M6] DEMO M6 OK — mode=$MODE"
