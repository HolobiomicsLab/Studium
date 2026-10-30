English · [Français](README.fr.md)

# Studium analytics collector

A FastAPI service that stores learner telemetry as append-only JSONL, one folder per course, and serves
class-level aggregates (progress, calibration, completion, reasoning depth, trust, autonomy and more) to
the [teacher dashboard](../../apps/teacher-dashboard/README.md). Every aggregate sits behind a floor of
five learners.

| | |
|---|---|
| Status | **maintained**, development and demo service |
| Run | `uvicorn analytics_collector_app:app` (see below) |
| Port | 8003 by convention, on 127.0.0.1 |
| Called by | the teacher dashboard (`ANALYTICS_BASE_URL`); read on disk by the [Observatory](../observatory/README.md) |
| Calls | nothing |
| Tests | `.venv/bin/python -m pytest services/analytics-collector` |

## Run it

From the repository root, with the virtual environment installed:

```bash
ANALYTICS_DATA_DIR=/tmp/studium-analytics .venv/bin/python -m uvicorn analytics_collector_app:app \
  --app-dir services/analytics-collector --host 127.0.0.1 --port 8003
```

| Variable | Default | Meaning |
|---|---|---|
| `ANALYTICS_DATA_DIR` | `data`, relative to the working directory | event store, `<store>/<course>/<YYYY-MM-DD>.jsonl`; give an absolute path |
| `ANALYTICS_MIN_LEARNERS` | `5` | server-side floor of distinct learners per aggregate; never a query parameter |

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /telemetry` | append events for a course |
| `GET /metrics/progress`, `/metrics/course-completion`, `/metrics/scene-breakdown` | progress and completion |
| `GET /metrics/calibration`, `/metrics/trust-calibration`, `/metrics/autonomy` | judgement metrics, published with a cohort band |
| `GET /metrics/reasoning`, `/metrics/ai-audit`, `/metrics/ai-literacy`, `/metrics/journal`, `/metrics/cooperation`, `/metrics/concept-mastery-history` | further class readings |
| `POST /metrics/blueprint` | composite score against an assessment blueprint, for formative use only |

What the floor is for: it restrains singling out; it does not make the numbers anonymous, because a
teacher already knows the class roster. Judgement metrics publish their population as a band (`5–9`,
`10–19`, `20+`) and carry a sentence saying they are a class reading, not a statement about a student.
The shared definitions live in [`metrics.py`](metrics.py).

## Limits

- **No real authentication.** The `X-Course-Token` header must equal the `course` it reads, so anyone
  who knows a course id can read that course's metrics. Bind it to `127.0.0.1` (as
  `tools/e2e-demo-m6.sh` does) and do not expose it.
- **Path confinement.** The course token names a folder under `ANALYTICS_DATA_DIR`. It must match
  `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` (no `..`, no separator, no leading dot) and the folder must resolve
  inside the data folder, symlinks included; anything else is a `400` and nothing is written.
  `store.course_dir` is the single place that enforces it.

## Tests

```bash
.venv/bin/python -m pytest services/analytics-collector
```

## See also

- [Follow a class](../../docs/teach/follow-a-class.md)
- [Privacy and limits](../../docs/concepts/privacy-and-limits.md)
