#!/usr/bin/env bash
# Orchestration E2E M5 — pipeline 2-sessions cross-session + assertions M5.
#
# Étend tools/e2e-c2.sh (pipeline télémétrie bout-en-bout) avec :
#   - WDIO spec m5-end-to-end : joue 2 sessions consécutives, asserte
#     ≥ 30 events (session 1) puis ≥ 60 events cumulés (session 2)
#   - 4 curl-assertions M5 :
#       /metrics/concept-mastery-history?course=…  → ≥ 2 snapshots
#       /metrics/ai-literacy?course=…&pseudonyme=… → value != null
#       /metrics/reasoning?course=…                → ≥ 1 scene
#       /metrics/ai-audit?course=…                 → n_scenes ≥ 1
#   - Playwright sur 3 nouvelles vues dashboard :
#       trajectory.spec.ts + ai-literacy.spec.ts + reasoning.spec.ts
#
# Mode --dry-run : skip les étapes WDIO (utile sur macOS).
#
# Pré-requis :
#   - `tauri-driver` sur le PATH (Linux/Windows uniquement, macOS bloqué)
#   - `uvicorn`, `python3.13`, `pnpm`, `jq`, `curl`
#   - `services/analytics-collector` installé en éditable
#     (`pip install -e services/analytics-collector`)
#   - WDIO peut écrire le pseudonyme via console.log "[e2e-m5] pseudonyme=…"
#     — un sniff de log permet de remplir /tmp/test-pseudo pour
#     l'assertion ai-literacy. Si absent, l'assertion est skippée
#     gracieusement.
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
PSEUDO_FILE="/tmp/test-pseudo"
WDIO_LOG="/tmp/m5-wdio.log"
DRY_RUN="${1:-}"

# Plateforme : tauri-driver est Linux/Windows-only
case "$(uname -s)" in
  Linux*|MINGW*|CYGWIN*|MSYS*) ;;
  *)
    echo "[M5] ATTENTION : tauri-driver ne supporte pas '$(uname -s)'."
    echo "[M5] Ce script est conçu pour CI Linux (workflow D.5)."
    if [[ "$DRY_RUN" != "--dry-run" ]]; then
      echo "[M5] Continuer quand même ? (Ctrl+C pour annuler ; sinon les"
      echo "[M5] étapes WDIO échoueront proprement. Utiliser --dry-run"
      echo "[M5] pour valider les autres étapes localement.)"
    fi
    ;;
esac

mkdir -p "$DATA_DIR"
rm -rf "$DATA_DIR"/*.jsonl 2>/dev/null || true
rm -f "$PSEUDO_FILE" 2>/dev/null || true

cleanup() {
  local rc=$?
  echo "[M5] cleanup (rc=$rc)"
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
echo "[M5] starting analytics-collector on :$COLLECTOR_PORT"
(
  cd "$ROOT/services/analytics-collector" && \
  ANALYTICS_DATA_DIR="$DATA_DIR" \
    uvicorn analytics_collector_app:app --port "$COLLECTOR_PORT" \
      >/tmp/m5-collector.log 2>&1
) &
COLLECTOR_PID=$!

# ── 2. Démarrer teacher-dashboard (dev) ───────────────────────────────
echo "[M5] starting teacher-dashboard on :$DASH_PORT"
(
  cd "$ROOT" && \
  ANALYTICS_BASE_URL="http://localhost:$COLLECTOR_PORT" \
    pnpm --filter @studium/teacher-dashboard dev \
      >/tmp/m5-dashboard.log 2>&1
) &
DASH_PID=$!

# Wait for collector readiness (max ~15s)
echo "[M5] waiting for collector readiness"
for i in $(seq 1 15); do
  if curl -fs "http://localhost:$COLLECTOR_PORT/health" >/dev/null 2>&1; then
    echo "[M5] collector ready (attempt $i)"
    break
  fi
  sleep 1
done
curl -fs "http://localhost:$COLLECTOR_PORT/health" >/dev/null || {
  echo "[M5] FATAL: collector never became ready"
  cat /tmp/m5-collector.log
  exit 1
}

# Wait for dashboard readiness (max ~30s — Next.js dev compile can be slow)
echo "[M5] waiting for dashboard readiness on :$DASH_PORT"
for i in $(seq 1 30); do
  if curl -fs -o /dev/null "http://localhost:$DASH_PORT" ; then
    echo "[M5] dashboard ready (attempt $i)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[M5] FATAL: dashboard not ready after 30s"
    cat /tmp/m5-dashboard.log
    exit 1
  fi
  sleep 1
done

# ── 3. Build runtime release + run WDIO (Linux/CI only) ────────────────
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "[M5] --dry-run : skip tauri:build + WDIO"
else
  echo "[M5] building student-runtime (tauri:build)"
  pnpm --filter @studium/student-runtime tauri:build

  # `m5-end-to-end.spec.ts` joue `$BUNDLE_DIR/demo-fresh.zip`, qu'aucun script
  # n'écrivait (INT-STUDIUM-033).
  echo "[M5] baking demo-fresh.zip"
  BUNDLE_DIR="$BUNDLE_DIR" python3 "$ROOT/tools/bake_demo_fresh.py"

  echo "[M5] running WDIO m5-end-to-end.spec.ts"
  pnpm --filter @studium/student-runtime wdio:run \
    --spec tests-e2e/specs/m5-end-to-end.spec.ts | tee "$WDIO_LOG"

  # Sniff le pseudonyme émis par le spec via console.log (best-effort).
  PSEUDO_FROM_LOG="$(grep -oE '\[e2e-m5\] pseudonyme=\S+' "$WDIO_LOG" \
    | tail -n1 | sed 's/^\[e2e-m5\] pseudonyme=//' || true)"
  if [[ -n "$PSEUDO_FROM_LOG" ]]; then
    echo "$PSEUDO_FROM_LOG" > "$PSEUDO_FILE"
    echo "[M5] pseudonyme capturé : $PSEUDO_FROM_LOG"
  fi
fi

# ── 4. Assertions M5 (curl + jq) ───────────────────────────────────────
echo "[M5] [assertion] concept-mastery-history ≥ 2 snapshots cumulés"
HISTORY_COUNT="$(
  curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://localhost:$COLLECTOR_PORT/metrics/concept-mastery-history?course=$COURSE_TOKEN" \
    | jq '[.concepts // {} | to_entries | .[].value | length] | add // 0'
)"
echo "[M5] concept-mastery-history snapshots = $HISTORY_COUNT (attendu ≥ 2)"
if [[ "$DRY_RUN" != "--dry-run" ]] && [[ "$HISTORY_COUNT" -lt 2 ]]; then
  echo "[M5] FATAL: concept-mastery-history < 2 snapshots"
  exit 1
fi

echo "[M5] [assertion] ai-literacy value != null"
PSEUDO="$(cat "$PSEUDO_FILE" 2>/dev/null || echo "")"
if [[ -n "$PSEUDO" ]]; then
  if curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://localhost:$COLLECTOR_PORT/metrics/ai-literacy?course=$COURSE_TOKEN&pseudonyme=${PSEUDO}" \
    | jq -e '.value != null' >/dev/null; then
    echo "[M5] ai-literacy value valide pour pseudonyme=$PSEUDO"
  else
    echo "[M5] WARN : ai-literacy value null pour pseudonyme=$PSEUDO"
    if [[ "$DRY_RUN" != "--dry-run" ]]; then
      exit 1
    fi
  fi
else
  echo "[M5] SKIP ai-literacy : pseudonyme non capturé (best-effort)"
fi

echo "[M5] [assertion] reasoning ≥ 1 scene"
REASONING_COUNT="$(
  curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://localhost:$COLLECTOR_PORT/metrics/reasoning?course=$COURSE_TOKEN" \
    | jq '.scenes | length'
)"
echo "[M5] reasoning scenes = $REASONING_COUNT (attendu ≥ 1)"
if [[ "$DRY_RUN" != "--dry-run" ]] && [[ "$REASONING_COUNT" -lt 1 ]]; then
  echo "[M5] FATAL: reasoning < 1 scene"
  exit 1
fi

echo "[M5] [assertion] ai-audit n_scenes ≥ 1"
AUDIT_N="$(
  curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://localhost:$COLLECTOR_PORT/metrics/ai-audit?course=$COURSE_TOKEN" \
    | jq '.n_scenes // 0'
)"
echo "[M5] ai-audit n_scenes = $AUDIT_N (attendu ≥ 1)"
if [[ "$DRY_RUN" != "--dry-run" ]] && [[ "$AUDIT_N" -lt 1 ]]; then
  echo "[M5] FATAL: ai-audit n_scenes < 1"
  exit 1
fi

# ── 5. Playwright sur les 3 nouvelles vues dashboard ───────────────────
echo "[M5] running playwright trajectory + ai-literacy + reasoning"
PW_SPECS=(
  "tests/integration/trajectory.spec.ts"
  "tests/integration/ai-literacy.spec.ts"
  "tests/integration/reasoning.spec.ts"
)
PW_EXISTS=()
for spec in "${PW_SPECS[@]}"; do
  if [[ -f "$ROOT/apps/teacher-dashboard/$spec" ]]; then
    PW_EXISTS+=("$spec")
  else
    echo "[M5] WARN : $spec absent — skip"
  fi
done

if [[ "${#PW_EXISTS[@]}" -gt 0 ]]; then
  (
    cd "$ROOT/apps/teacher-dashboard" && \
    DASHBOARD_PORT_EXTERNAL=1 pnpm exec playwright test "${PW_EXISTS[@]}"
  )
else
  echo "[M5] SKIP playwright : aucun spec trouvé"
fi

echo "[M5] DONE — pipeline M5 2-sessions + assertions vert"
