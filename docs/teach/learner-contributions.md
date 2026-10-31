English · [Français](learner-contributions.fr.md)

# Learner contributions

Students can propose a new item for your course: a quiz, a "spot the flaw" or an "explain back"
scene. You see each proposal with its answer key, approve, reject or ask for a revision, and only
what you approve becomes available to the class, as a separate community lesson. Your original
course is never modified. Learners can never publish on their own: that is rule 003 applied to
contributions.

| Step | Who | Where | Result |
|---|---|---|---|
| Draft and self-test | Learner | `/studio` in the author web app (`localhost:3000`) | A scene that passes validation |
| Submit | Learner | Same page, after consent | An item in state `submitted` |
| Peer test (optional) | Learners | `/peer` in the author web app | Rating aggregates, shown from 3 raters |
| Decide | You | `/courses/<course_id>/submissions` in the dashboard (`localhost:3001`) | Approved, rejected or revision requested |
| Play | Class | Assistant (`list_community_bundles`) or VS Code ("Studium: Community contributions") | A single-scene community lesson |

## Start the services

Three terminals, from the repository root:

```bash
.venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --port 8002
```

```bash
pnpm --filter @studium/author-web dev
```

```bash
pnpm --filter @studium/teacher-dashboard dev
```

The service reads each course from `BUNDLES_ROOT/<course_id>/lesson.json` (default: the
repository's `fixtures/`) and keeps submissions in `LEARNER_DATA_ROOT` (default
`/tmp/studium-learner-items`). The web apps reach it on port 8002 (`NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL`
for the learner app, `SCENE_SYNTH_BASE_URL` for the dashboard). No API key is needed.

The learner form lives in the author web app, which is marked legacy, and is wired to the demo
course `atomistique-l1` (concept `c-orbitales-formes`). For another course, a client submits through
the same service (`POST /learner-items`) with that course's id.

## What the learner does

1. Fills a guided form (no JSON): title, question, two to six choices with exactly one correct,
   feedback for right and wrong answers, hints. "Spot the flaw" and "explain back" have their own
   editors.
2. Watches the validation badge: every edit is checked against the schema and the course's concepts.
3. Answers their own item in the self-test panel, with a local grader and no network call.
4. Ticks consent; with a green badge, **Submit** sends the item, which arrives as `submitted`.

## Decide on a submission

Open `http://localhost:3001/courses/atomistique-l1/submissions` (the course id is the token). Each
item shows the scene, its answer key (correct answers marked), the validation result and a
de-identified author label, so you never approve blind.

| Decision | Effect |
|---|---|
| Approve | A single-scene community lesson is written under `BUNDLES_ROOT/<course_id>/community/`, with your name in `validated_by` and the author pseudonym removed |
| Reject | Nothing is published |
| Request revision | Nothing is published; the decision is recorded on the item |

Learners and their assistants find approved items with the `list_community_bundles` MCP tool, whose
references pass unchanged to `start_lesson_session`, or with the VS Code command "Studium: Community
contributions".

## Peer rating in class

Two optional ways to let students test each other's work:

- **The `/peer` page** of the author web app lets learners take a submitted item and rate it. The
  ratings carry no text and no identity; you see the aggregate only once three learners have rated.
- **A live PeerStudio room**: your assistant calls `open_peer_room` for a lesson and gives students a
  six-character join code; they call `join_peer_room` and `submit_peer_rating`. You read
  `get_peer_room_state` and end with `close_peer_room`, which returns the aggregates of targets with
  at least three independent ratings. The room lives in memory and disappears when closed. The
  dashboard page `/room` offers the same controls through the lesson server
  (`LESSON_SERVER_BASE_URL`, default `http://localhost:8010`).

Ratings inform your decision; they never publish anything by themselves.

## Privacy

- The learner's text stays on their device until they submit; it never enters telemetry.
- The author pseudonym is computed on the server and never returned to any client or shown to peers.
- Self-test makes no network or model call.

## Not the same as a self-study lesson

A lesson a learner builds for themself with their assistant (see
[learn with your assistant](../learn/learn-with-your-assistant.md)) stays in their own library,
marked self-study. `experience_packet.py approve` refuses self-study lessons; to give that material
to a class, rebuild it through the [teacher route](author-a-lesson.md#route-b-the-evidence-packet).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| CORS error in the browser console | The service is not running, or the page is not on `localhost:3000` or `localhost:3001` |
| `400` or `404` on submit | The course id is malformed, or `BUNDLES_ROOT/<course_id>/lesson.json` does not exist |
| `422` on submit | The scene failed validation; the response lists the errors |
| Empty queue | No item is in state `submitted`; do the learner step first |
| `Connection refused` on port 8002 | Start the scene-synth service |

Code: [`services/scene-synth/scene_synth_app.py`](../../services/scene-synth/scene_synth_app.py),
[`apps/author-web/app/studio/`](../../apps/author-web/app/studio/).
