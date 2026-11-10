English · [Français](README.fr.md)

# Scene-synth service

A FastAPI service with two roles. Its research role turns an approved lesson plan into scenes and a
lesson bundle (`bundler.py`, also used by the [eval harness](../../eval/README.md)). Its live role hosts
the moderation of learner contributions: a learner proposes a quiz item, peers test it, and the teacher
decides; an approved item becomes a community bundle next to the course.

| | |
|---|---|
| Status | **legacy** for synthesis; the learner-contribution routes back the maintained teacher dashboard |
| Run | `uvicorn scene_synth_app:app` (see below) |
| Port | 8002 by convention; CORS allows `localhost:3000` (the learner app), never on the decision route |
| Called by | the [teacher dashboard](../../apps/teacher-dashboard/README.md) (`SCENE_SYNTH_BASE_URL`), the legacy [Author Studio](../../apps/author-web/README.md) |
| Calls | a model only through an orchestrator that an integration injects |
| Tests | `.venv/bin/python -m pytest services/scene-synth` |

## Run it

From the repository root, with the virtual environment installed:

```bash
COMMUNITY_BUNDLES_ROOT=/tmp/studium-community LEARNER_PSEUDONYM_SECRET="$(openssl rand -hex 32)" \
  STUDIUM_REVIEW_TOKEN="$STUDIUM_REVIEW_TOKEN" \
  .venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --host 127.0.0.1 --port 8002
```

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /scenes/synthesize` | turn a `lesson_plan` into a bundle; **503** until an orchestrator is configured |
| `POST /scenes/critique-eval` | score a critique against claims and a rubric; **503** until an evaluator is configured |
| `POST /learner-items/validate`, `POST /learner-items`, `GET /learner-items` | check, submit and list learner-proposed items for a course |
| `POST /learner-items/{item_id}/peer-review`, `GET /learner-items/{item_id}/peer-signals` | peer test results; the teacher-facing signals sit behind a floor of three raters |
| `POST /learner-items/{item_id}/decide` | the teacher's decision, with `Authorization: Bearer $STUDIUM_REVIEW_TOKEN` and no browser `Origin`; an approved item is written as `community-<id>.zip` (with its `approval.json` record) under `<root>/<course_id>/community/`, and every decision is appended to `learner_decisions.jsonl` |

Starting the app is not enough to synthesize: no default orchestrator exists, and a request schema is not
an approval gate. The canonical course `lesson.json` is never modified.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BUNDLES_ROOT` | the repository's `fixtures/` | root holding one `<course_id>/lesson.json` per course |
| `COMMUNITY_BUNDLES_ROOT` | the value of `BUNDLES_ROOT` | where approved community bundles are written; set it to keep a checkout clean |
| `LEARNER_DATA_ROOT` | `/tmp/studium-learner-items` | store of submitted items |
| `LEARNER_PSEUDONYM_SECRET` | `dev-insecure-secret` | HMAC key of author pseudonyms; set your own outside a demo |
| `STUDIUM_REVIEW_TOKEN` | none | teacher review token (at least 32 characters) required on a decision; unset, every decision is refused with `503` |

## Tests

```bash
.venv/bin/python -m pytest services/scene-synth
```

[`tests/e2e/test_full_pipeline.py`](tests/e2e/test_full_pipeline.py) shows how to inject a model client
(a deterministic fake returning canned JSON per scene type).

## See also

- [Learner contributions](../../docs/teach/learner-contributions.md)
- [Lesson bundle format](../../docs/reference/lesson-bundle.md)
