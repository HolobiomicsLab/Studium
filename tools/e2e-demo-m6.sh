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
#   6. Assertions curl (TOUS les modes, en-tête X-Course-Token obligatoire) :
#        /metrics/progress?course=demo-m6              → ≥ 10 scènes complétées
#        /metrics/concept-mastery-history?course=demo-m6 → forme {"concepts": …}
#        /metrics/journal?course=demo-m6               → entries_total ≥ 2
#
# Modes :
#   --help        affiche ce help
#   --no-tauri    skip étape 5 (smoke local macOS) ; l'étape 6 tourne quand même,
#                 contre une télémétrie de fixture postée à l'étape 5b — ce qui
#                 prouve la plomberie (en-tête, routes, filtres jq) mais PAS le
#                 runtime. Un run de démo réel, c'est --ci.
#   --ci          inclut WDIO E2E (CI Linux) ; aucune télémétrie n'est semée.
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
# Seuils de l'étape 6. 10 = le nombre de scènes du bundle demo-atomistique ;
# 2 = le minimum d'entrées de journal attendu des deux sessions WDIO.
MIN_SCENES=10
MIN_JOURNAL_ENTRIES=2

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

# ── Étape 6 : lecture des métriques du collector ─────────────────────────────
#
# Chaque route /metrics du collector est gardée par `_require_course_token`
# (analytics_collector_app.py, parité ADR 011) : la garde lit l'EN-TÊTE
# `X-Course-Token`, pas le paramètre `?course=`. Les deux portent la même
# valeur — le token EST l'identifiant de cours — ce qui est précisément
# pourquoi le paramètre seul paraissait suffire. `tools/e2e-c2.sh:107` pilote
# le même service et passe les deux depuis C.8 (INT-STUDIUM-021).
collector_get() {
  local path="$1" body rc=0
  body=$(curl -fs -H "X-Course-Token: $COURSE_TOKEN" \
    "http://127.0.0.1:$COLLECTOR_PORT/$path") || rc=$?
  if (( rc != 0 )); then
    echo "[M6] FAIL: GET /$path — curl rc=$rc" >&2
    echo "           (22 = statut HTTP >= 400 ; un 401 'missing X-Course-Token'" >&2
    echo "            signifie en-tête absent, pas métrique insuffisante)" >&2
    return "$rc"
  fi
  printf '%s' "$body"
}

# Le diagnostic tient dans collector_get : sous `set -euo pipefail`, un
# `x=$(curl …)` qui échoue avortait le script à la ligne même, avant qu'aucun
# `FAIL:` ne s'imprime, et la seule trace était `[M6] cleanup (rc=1)`.
assert_metrics() {
  echo "[M6] Step 6 — assertions curl"
  local progress scenes history journal entries

  # compute_progress renvoie {"scenes": {<scene_id>: {completion_rate, n_learners}}}.
  # Il n'y a pas de champ `scenes_completed` : l'ancien filtre lisait un nom que
  # le endpoint n'a jamais émis, donc l'assertion valait 0 ≥ 10 en toute
  # circonstance.
  progress=$(collector_get "metrics/progress?course=$COURSE_TOKEN") || exit 7
  scenes=$(printf '%s' "$progress" | jq -r '.scenes | length')
  [[ "$scenes" -ge "$MIN_SCENES" ]] \
    || { echo "[M6] FAIL: scènes vues = $scenes < $MIN_SCENES"; exit 7; }

  # /metrics/concept-mastery-history renvoie {"concepts": {...}}, pas
  # {"snapshots": [...]}. Le COMPTE n'est pas asserté : un snapshot ne s'écrit
  # que depuis `concept_states` porté par un événement, et TelemetryEvent est
  # `extra="forbid"` — aucun client ne peut poster ce champ aujourd'hui (le
  # collector le dit lui-même : « no-op tant que le runtime n'aura pas été
  # étendu »). Asserter « ≥ 2 snapshots » serait asserter contre un chemin qui
  # n'existe pas. Ce qui est vérifié ici : la route répond sous l'en-tête et
  # rend sa forme documentée.
  history=$(collector_get "metrics/concept-mastery-history?course=$COURSE_TOKEN") || exit 8
  printf '%s' "$history" | jq -e 'has("concepts")' > /dev/null \
    || { echo "[M6] FAIL: concept-mastery-history sans clé 'concepts'"; exit 8; }

  # compute_journal_metrics renvoie `entries_total`, pas `entries`.
  journal=$(collector_get "metrics/journal?course=$COURSE_TOKEN") || exit 9
  entries=$(printf '%s' "$journal" | jq -r '.entries_total')
  [[ "$entries" -ge "$MIN_JOURNAL_ENTRIES" ]] \
    || { echo "[M6] FAIL: journal entries_total=$entries < $MIN_JOURNAL_ENTRIES"; exit 9; }

  echo "[M6] metrics OK — scènes=$scenes journal_entries=$entries"
}

# En --no-tauri il n'y a pas de session runtime, donc rien à mesurer. Plutôt que
# de sauter l'étape 6 — c'est ainsi que ses trois défauts ont survécu — on sème
# la télémétrie du bundle et on fait tourner les mêmes assertions. Ce qui est
# alors prouvé : l'en-tête, les routes et les filtres jq. PAS le runtime ; un
# run de démo réel, c'est --ci.
seed_demo_telemetry() {
  echo "[M6] Step 5b — seed télémétrie de fixture (mode=$MODE, aucune session runtime)"
  python3 - "$COLLECTOR_PORT" "$COURSE_TOKEN" "$ROOT" "$MIN_JOURNAL_ENTRIES" <<'PY'
import json, sys, urllib.request

port, token, root, min_journal = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
bundle = json.load(open(f"{root}/fixtures/m6/demo-atomistique/lesson.json"))
base = dict(learner_pseudonym="seed-pseudo-1", lesson_id=bundle["bundle_id"],
            client_timestamp="2026-01-01T09:00:00Z")
scenes = [s["id"] for s in bundle["scenes"]]

events = [dict(base, event_id=f"seed-sc-{i}", type="scene_completed",
               scene_id=sid, duration_ms=1000, success=True)
          for i, sid in enumerate(scenes)]
events += [dict(base, event_id=f"seed-jr-{i}", type="journal_entry_submitted",
                scene_id=scenes[0], entry_length=120, revision_count=0,
                is_revision=False)
           for i in range(min_journal)]

req = urllib.request.Request(
    f"http://127.0.0.1:{port}/telemetry",
    data=json.dumps({"events": events}).encode(),
    headers={"Content-Type": "application/json", "X-Course-Token": token})
with urllib.request.urlopen(req, timeout=10) as r:
    n = json.load(r)["accepted"]
print(f"[M6] seeded {n} events ({len(scenes)} scènes + {min_journal} journal)")
PY
}

# Garde de sourçage : `E2E_M6_LIB=1 source tools/e2e-demo-m6.sh` donne les
# fonctions ci-dessus à un test sans lancer la démo (tools/e2e-demo-m6.test.sh).
[[ -n "${E2E_M6_LIB:-}" ]] && return 0

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
else
  seed_demo_telemetry
fi

assert_metrics

echo "[M6] DEMO M6 OK — mode=$MODE"
