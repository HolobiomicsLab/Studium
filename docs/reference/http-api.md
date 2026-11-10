English · [Français](http-api.fr.md)

# HTTP API

Studium has two local HTTP servers. Use the **lesson API** of `apps/lesson-mcp` to drive lessons
from a script or a harness without MCP; it exposes the 25 lesson operations from the
[MCP tools](mcp-tools.md), plus `rate_recall`. The older **lesson-server**
(`apps/lesson-server`) serves the teacher dashboard's peer rooms and course pages. Both hide answer
keys: a scene is sent as its public projection, never with its key.

| | Lesson API | lesson-server |
|---|---|---|
| Start | `pnpm --filter @studium/lesson-mcp api` | `pnpm --filter @studium/lesson-server start` |
| Address | `http://127.0.0.1:8130` (`STUDIUM_API_PORT`) | `http://127.0.0.1:8010` (`PORT`) |
| Authentication | Bearer token, loopback only, browser origins refused | none (loopback only) |
| Operations | 26: the 25 lesson tools plus `rate_recall`, with discovery | sessions, peer rooms, courses |
| Retries | idempotent with `request_id` | none |

Neither is meant for a class on the internet: both listen on 127.0.0.1 only, and their sessions
belong to the running process. Session ids are not interchangeable between the two.

## Lesson API

### Start it

```bash
export STUDIUM_API_TOKEN="$(openssl rand -hex 32)"   # at least 32 characters; share it with clients, not in chat or Git
BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-mcp api
```

Start it in a terminal you keep open. It listens on 127.0.0.1 only, refuses browser requests that carry an
`Origin` header, and reads lessons from `BUNDLES_ROOT` (default: the checkout's `fixtures/`). Keep the token
in your environment, never in a chat or in Git. The API never calls a model unless `STUDIUM_API_LIVE=1` and `LITELLM_BASE_URL` are set. Learner
state stays in memory unless `STUDIUM_DATA_DIR` is set (see [Configuration](configuration.md)).

### Call it

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | `{schema: "studium/http/v1", status: "ready", sessions: "process-local"}` |
| `/v1/operations` | GET | Every operation: `name`, `description`, `mutating`, `requires_scene_id`, `input_schema` (JSON Schema) |
| `/v1/operations/<name>` | POST | Run one operation. The result has the same fields as the MCP tool, without the MCP envelope. |

Every request carries `Authorization: Bearer <token>`; a POST body is JSON (`content-type:
application/json`, at most 1 MiB) in this envelope:

```json
{
  "request_id": "start-001",
  "expected_scene_id": "s-intro",
  "arguments": { "bundle_ref": "capsule-judgment-demo/lesson.json", "learner_id": "local-student" }
}
```

| Field | When |
|---|---|
| `arguments` | Always: the tool's arguments, checked against its schema. |
| `request_id` | Every mutating operation. Reuse it, with identical arguments, to retry safely: the stored reply is returned and nothing runs twice. |
| `expected_scene_id` | `submit_response`, `submit_turn`, `submit_run_result`, `request_hint`, `record_experiment`: the scene the learner is answering. A changed scene gives `409 stale_scene`. |

When `submit_response` returns `self_rating: {requested: true, scene_id, ...}`, ask the learner for
`again`, `hard`, `good` or `easy`, then call `rate_recall` with a new `request_id` and
`arguments: {session_id, scene_id, grade}`. It needs no `expected_scene_id` because `scene_id` is the
rating request it consumes. An identical resend with the same `request_id` returns the stored reply; a
different request id cannot rate the same self-rating request twice.

```bash
curl -s -H "Authorization: Bearer $STUDIUM_API_TOKEN" http://127.0.0.1:8130/v1/operations
curl -s -X POST -H "Authorization: Bearer $STUDIUM_API_TOKEN" -H 'content-type: application/json' \
  -d '{"request_id":"start-001","arguments":{"bundle_ref":"capsule-judgment-demo/lesson.json","learner_id":"local-student"}}' \
  http://127.0.0.1:8130/v1/operations/start_lesson_session
```

The repository also ships a small client that reads the token from the environment and never
prints it:

```bash
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
pnpm --silent --filter @studium/lesson-mcp api:call start_lesson_session /absolute/path/start.json
```

Read-only operations (`get_*`, `explain_last_adaptation`, `list_community_bundles`) need no
`request_id` and are recomputed on each call. `forget_session` takes `session_id` or `learner_id`, as
over MCP; with `learner_id` no session needs to be open, and a retried request on one of the sessions it
closed answers `410 forgotten`. The other study tools (`get_study_plan`, `list_lessons`,
`start_review_session`) and all authoring and teacher tools are not served here in this version; use MCP
for them.

### Errors

Errors are `{error, code}` with these statuses:

| Status | Codes | What to do |
|---|---|---|
| 400 | `invalid_json`, `invalid_input`, `request_id_required`, `scene_required`, `invalid_bundle` | Fix the request from the discovery schema; nothing was recorded. |
| 401, 403 | `unauthorized`, `local_only`, `origin_rejected` | Check the token and that the client is local and not a browser. |
| 404 | `not_found`, `session_not_found` | Unknown route or session (a restart ends every session). Do not invent a resume. |
| 409 | `stale_scene`, `request_conflict` | Re-read the current scene; or a `request_id` was reused with different content. |
| 410 | `session_closed`, `forgotten` | The session was ended or erased; start a new one, never recreate erased data. |
| 413, 415 | `body_too_large`, `media_type` | Send JSON under 1 MiB; pass media as references. |
| 422 | `operation_failed` | The lesson engine refused the operation; read `error`. |
| 503 | `busy`, `receipt_limit` | Retry with the same `request_id`; or export and restart after 512 mutations (16 MiB of stored replies). |

Operations run one at a time. After a network error, resend the same file with the same
`request_id` rather than a second answer. To switch harnesses mid-lesson, hand over the address, the
`session_id` and the language, and start with `get_operator_context`; do not restart the lesson.

A server restart ends its sessions: a call on an old `session_id` answers `session not found` and says how
to resume. With durable storage, a new `start_lesson_session` for the same learner and lesson resumes at the
first unfinished step. On a panel or a pane, the learner's next action on the old session replaces the scene
with "Session lost (the server restarted or the session was closed). Reopen the lesson: your progress is
kept." and a reopen control: the MCP Apps panel's button and the Claude Code pane's button open the same
lesson for the same learner (the Claude Code pane also names `/studium <bundle_ref>`), and the VS Code pane's
button closes it and opens the lesson in a new pane. Nothing is retried on its own.

### Keep the journal

Export what you want to keep before stopping an in-memory server. With `context.json` holding
`{"arguments":{"session_id":"<id>"}}`:

```bash
pnpm --silent --filter @studium/lesson-mcp api:call get_experiment_journal context.json > journal.json
.venv/bin/python tools/learner_report.py export new-report --journal journal.json
```

See [Learner report](../learn/learner-report.md) for what the report contains.

## lesson-server

A Fastify server for the teacher dashboard. Replies are `{success, ok, ...}` on success and
`{success: false, ok: false, error}` otherwise.

| Route | Method | Body or query | Reply |
|---|---|---|---|
| `/sessions` | POST | `{bundle_ref, learner_id?}` | `201 {session_id, presentation}` |
| `/sessions/:id` | GET | | `{presentation}` |
| `/sessions/:id/respond` | POST | `{input}` (a response, as in `submit_response`) | `{transition}`; `409` when the session cannot take it |
| `/sessions/:id/turns` | POST | `{text}` | `{accepted: true}` |
| `/sessions/:id/state` | GET | | `{state}` |
| `/sessions/:id` | DELETE | | `{forgotten: true}`: erases the session |
| `/rooms` | POST | `{bundle_ref}` | `201`, the new peer room |
| `/rooms/join` | POST | `{join_code, session_id}` | the room |
| `/rooms/:id/ratings` | POST | `{rater_session_id, target_session_id, passed, rating (1–5), helpful}` | the rating |
| `/rooms/:id` | GET | `?teacher_key=` | the room state |
| `/rooms/:id/close` | POST | `{teacher_key}` | the closed room |
| `/courses` | GET | `?ref=` (a path under `BUNDLES_ROOT`) | `{course}`: the course order and prerequisites |

It has no authentication: keep it on a machine you control. Configuration (`BUNDLES_ROOT`, `PORT`,
`LITELLM_BASE_URL`) is in [Configuration](configuration.md#lesson-server).
