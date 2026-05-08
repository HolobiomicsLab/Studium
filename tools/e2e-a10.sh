#!/usr/bin/env bash
# Orchestration E2E A.10 — plan → bundle (scene-synth) → runtime joue 6 types
# Pré-requis : pnpm tauri:build OK + tauri-driver sur le PATH + python miniconda 3.13.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="${BUNDLE_DIR:-/tmp/studium-e2e}"
mkdir -p "$BUNDLE_DIR"

PLANNER_PORT="${PLANNER_PORT:-8001}"
SYNTH_PORT="${SYNTH_PORT:-8002}"

echo "[A.10] starting planner on :$PLANNER_PORT"
( cd "$ROOT/services/planner" && \
  uvicorn planner_app:app --port "$PLANNER_PORT" >/tmp/planner.log 2>&1 ) &
PLANNER_PID=$!

echo "[A.10] starting scene-synth on :$SYNTH_PORT"
( cd "$ROOT/services/scene-synth" && \
  uvicorn scene_synth_app:app --port "$SYNTH_PORT" >/tmp/scene-synth.log 2>&1 ) &
SYNTH_PID=$!

cleanup() {
  kill "$PLANNER_PID" "$SYNTH_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 3

echo "[A.10] running pytest pipeline E2E"
( cd "$ROOT" && \
  python -m pytest services/scene-synth/tests/e2e/test_full_pipeline.py -v )

echo "[A.10] running wdio runtime E2E (requires release bundle)"
( cd "$ROOT/apps/student-runtime" && \
  pnpm wdio:run --spec tests-e2e/play-bundle-from-scene-synth.test.ts )

echo "[A.10] DONE"
