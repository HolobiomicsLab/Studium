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

Decisions need a teacher review token: a secret of at least 32 characters, set to the same value
in `STUDIUM_REVIEW_TOKEN` for scene-synth and for the dashboard's server, and never given to a
learner. Generate one per deployment, for example in a shell you then use for both commands:

```bash
export STUDIUM_REVIEW_TOKEN="$(openssl rand -hex 32)"
```

Three terminals, from the repository root (the first and the third need the token):

```bash
.venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --port 8002
```

```bash
pnpm --filter @studium/author-web dev
```

```bash
pnpm --filter @studium/teacher-dashboard dev
```

Without the token, scene-synth refuses every decision (approve, reject, request revision) with
`503` and says which variable to set; learners can still draft and submit.

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

Above the queue, type **Your name, as learners will read it**. Approve stays disabled until the field
holds a name, and the page shows the sentence learners will read: "Lesson contributed by a classmate,
validated by <name>" (in French: « Leçon proposée par une personne de la classe, validée par
<name> »). An e-mail address is accepted with a note that learners will see it. The browser remembers
the name for your next visit (local storage, on this browser only).

| Decision | Effect |
|---|---|
| Approve | A single-scene community lesson `community-<id>.zip` is written under `BUNDLES_ROOT/<course_id>/community/`, with your name in `validated_by`, an `approval.json` record next to its `lesson.json`, and the author pseudonym removed |
| Reject | Nothing is published |
| Request revision | Nothing is published; the decision is recorded on the item |

### How a decision is recorded

A decision is a teacher act, and the service checks it as one:

- Your browser posts the decision to the dashboard's own server, which calls scene-synth with
  `Authorization: Bearer $STUDIUM_REVIEW_TOKEN`. The token stays on the two servers: it never
  reaches a browser, a response, a log or a file. A missing or wrong token gets `401`.
- scene-synth refuses any decision coming straight from a browser (`403`) and grants no CORS
  access to the decision route, so the learner app on `localhost:3000` cannot decide, even for
  its own items.
- On approval the reviewer is the name you typed, trimmed: the dashboard refuses an empty name, one
  longer than 200 characters, one with a control character, or an identifier starting with `urn:`,
  and scene-synth refuses an empty or overlong name, an identifier starting with `urn:`, and the item
  author's own handle or pseudonym (`400`). A rejection or a revision request, which publishes
  nothing, records your name when you typed one and the course identifier
  `urn:studium:teacher:<course_id>` otherwise.
- On approval the archive holds `approval.json`, the same `studium-approval/1` record that
  `experience_packet.py approve` writes for a teacher lesson: `bundle_sha256` (the sha256 of the
  exact `lesson.json` bytes in the archive), `reviewer`, `reviewed_at`, `tool`, and
  `decision_route: "learner-contribution"`. Any change to `lesson.json` breaks the match.
- The lesson says who wrote it: `metadata.authoring` is `{mode: "teacher", author_is_learner: true,
  drafted_by: "learner"}`, a learner's draft validated by you.
- Every decision adds one line to `learner_decisions.jsonl` in `LEARNER_DATA_ROOT`: item, course,
  decision, reviewer, the declared `reviewed_at`, the server's `recorded_at` and, on approval, the
  sha256 of the published `lesson.json` and of the archive.

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
| CORS error in the browser console | The service is not running, or the learner page is not on `localhost:3000`; the dashboard never calls scene-synth from the browser |
| "Les décisions sont désactivées" in the dashboard, or `503` on a decision | `STUDIUM_REVIEW_TOKEN` (at least 32 characters) is missing on scene-synth or on the dashboard's server: set the same value on both and restart them |
| `401` on a decision | The two servers hold different `STUDIUM_REVIEW_TOKEN` values |
| `400` "the reviewer cannot be the item's author" | The reviewer named is the learner who wrote the item; a learner never decides on their own item |
| `400` or `404` on submit | The course id is malformed, or `BUNDLES_ROOT/<course_id>/lesson.json` does not exist |
| `422` on submit | The scene failed validation; the response lists the errors |
| Empty queue | No item is in state `submitted`; do the learner step first |
| `Connection refused` on port 8002 | Start the scene-synth service |

Code: [`services/scene-synth/scene_synth_app.py`](../../services/scene-synth/scene_synth_app.py),
[`services/scene-synth/learner_review.py`](../../services/scene-synth/learner_review.py),
[`apps/teacher-dashboard/lib/decide-route.ts`](../../apps/teacher-dashboard/lib/decide-route.ts),
[`apps/author-web/app/studio/`](../../apps/author-web/app/studio/).
