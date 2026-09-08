#!/usr/bin/env bash
# Orchestration E2E C.8 — pipeline télémétrie bout-en-bout.
#
# Pipeline :
#   1. Démarre `analytics-collector` (FastAPI/uvicorn) sur :8003
#      JSONL data dir = /tmp/c2-e2e-data
#   2. Démarre `teacher-dashboard` (Next dev) sur :3001 pointé vers le
#      collector via ANALYTICS_BASE_URL
#   3. Build le runtime release (`pnpm tauri:build`)
#   4. Exécute le spec WDIO `telemetry-end-to-end.spec.ts` qui joue un
#      parcours complet et asserte ≥ 30 événements émis
#   5. Curl /metrics/progress?course=e2e-course pour vérifier que le
#      collector a bien indexé ≥ 4 scènes
#   6. (Optionnel) Playwright sur dashboard si tests présents
#   7. Cleanup background processes
#
# Pré-requis :
#   - `tauri-driver` sur le PATH (Linux/Windows uniquement, macOS bloqué)
#   - `uvicorn`, `python3.13`, `pnpm`, `jq`, `curl`
#   - `services/analytics-collector` installé en éditable
#     (`pip install -e services/analytics-collector`)
#
# macOS : exécution bloquée — `tauri-driver` ne supporte pas Darwin.
# Cible d'exécution : workflow CI Linux (D.5).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTOR_PORT="${COLLECTOR_PORT:-8003}"
DASH_PORT="${DASH_PORT:-3001}"
DATA_DIR="${ANALYTICS_DATA_DIR:-/tmp/c2-e2e-data}"
COURSE_TOKEN="e2e-course"
BUNDLE_DIR="${BUNDLE_DIR:-/tmp/studium-e2e}"

# Plateforme : tauri-driver est Linux/Windows-only
case "$(uname -s)" in
  Linux*|MINGW*|CYGWIN*|MSYS*) ;;
  *)
    echo "[C.8] ATTENTION : tauri-driver ne supporte pas '$(uname -s)'."
    echo "[C.8] Ce script est conçu pour CI Linux (workflow D.5)."
    echo "[C.8] Continuer quand même ? (Ctrl+C pour annuler ; sinon les"
    echo "[C.8] étapes 3-4 échoueront proprement.)"
    ;;
esac

mkdir -p "$DATA_DIR"
rm -rf "$DATA_DIR"/*.jsonl 2>/dev/null || true

cleanup() {
  local rc=$?
  echo "[C.8] cleanup (rc=$rc)"
  if [[ -n "${COLLECTOR_PID:-}" ]]; then
    kill "$COLLECTOR_PID" 2>/dev/null || true
  fi
  if [[ -n "${DASH_PID:-}" ]]; then
    kill "$DASH_PID" 2>/dev/null || true
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ── 1. Démarrer analytics-collector ────────────────────────────────────
echo "[C.8] starting analytics-collector on :$COLLECTOR_PORT"
(
  cd "$ROOT/services/analytics-collector" && \
  ANALYTICS_DATA_DIR="$DATA_DIR" \
    uvicorn analytics_collector_app:app --port "$COLLECTOR_PORT" \
      >/tmp/c2-collector.log 2>&1
) &
COLLECTOR_PID=$!

# ── 2. Démarrer teacher-dashboard (dev) ───────────────────────────────
echo "[C.8] starting teacher-dashboard on :$DASH_PORT"
(
  cd "$ROOT" && \
  ANALYTICS_BASE_URL="http://localhost:$COLLECTOR_PORT" \
    pnpm --filter @studium/teacher-dashboard dev \
      >/tmp/c2-dashboard.log 2>&1
) &
DASH_PID=$!

# Wait for collector readiness (max ~15s)
echo "[C.8] waiting for collector readiness"
for i in $(seq 1 15); do
  if curl -fs "http://localhost:$COLLECTOR_PORT/health" >/dev/null 2>&1; then
    echo "[C.8] collector ready (attempt $i)"
    break
  fi
  sleep 1
done
curl -fs "http://localhost:$COLLECTOR_PORT/health" >/dev/null || {
  echo "[C.8] FATAL: collector never became ready"
  cat /tmp/c2-collector.log
  exit 1
}

# ── 3. Build runtime release ───────────────────────────────────────────
echo "[C.8] building student-runtime (tauri:build)"
pnpm --filter @studium/student-runtime tauri:build

# ── 3bis. Baker le bundle que le spec joue ────────────────────────────
# `telemetry-end-to-end.spec.ts` pointe `window.__test_bundle_path` sur
# `$BUNDLE_DIR/demo-fresh.zip`, qu'aucun script n'écrivait (INT-STUDIUM-033).
echo "[C.8] baking demo-fresh.zip"
BUNDLE_DIR="$BUNDLE_DIR" python3 "$ROOT/tools/bake_demo_fresh.py"

# ── 4. Exécuter le spec WDIO E2E ──────────────────────────────────────
echo "[C.8] running WDIO telemetry-end-to-end.spec.ts"
pnpm --filter @studium/student-runtime wdio:run \
  --spec tests-e2e/specs/telemetry-end-to-end.spec.ts

# ── 5. Vérifier que le collector a reçu et indexé ────────────────────
echo "[C.8] verifying collector /metrics/progress"
SCENES_COUNT="$(
  curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://localhost:$COLLECTOR_PORT/metrics/progress?course=$COURSE_TOKEN" \
    | jq '.scenes | length'
)"
echo "[C.8] scenes_count = $SCENES_COUNT (attendu ≥ 4)"
if [[ "$SCENES_COUNT" -lt 4 ]]; then
  echo "[C.8] FATAL: collector did not index ≥ 4 scenes"
  exit 1
fi

# ── 6. (Optionnel) Playwright dashboard ───────────────────────────────
DASH_PW_SPEC="$ROOT/apps/teacher-dashboard/tests/integration/progress.spec.ts"
if [[ -f "$DASH_PW_SPEC" ]]; then
  echo "[C.8] running playwright on dashboard progress.spec.ts"
  (
    cd "$ROOT/apps/teacher-dashboard" && \
    pnpm exec playwright test tests/integration/progress.spec.ts
  )
else
  echo "[C.8] SKIP : pas de tests/integration/progress.spec.ts (à venir)"
fi

echo "[C.8] DONE — pipeline télémétrie bout-en-bout vert"
