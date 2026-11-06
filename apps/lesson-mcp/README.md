English · [Français](README.fr.md)

# Studium lesson server for MCP

`@studium/lesson-mcp` lets any AI assistant that speaks the Model Context Protocol (MCP) play Studium
lessons with a learner, build a lesson from sources the learner chose, schedule reviews over days, and
give teachers a review and a class report. Codex, Claude Code, Copilot, OpenCode and Cursor all start it
the same way: as a local process talking over stdio. The VS Code extension ships the same server.

| | |
|---|---|
| Status | **supported** (decision D6) |
| Run | `pnpm --filter @studium/lesson-mcp start` (stdio, no port) |
| Optional HTTP adapter | `pnpm --filter @studium/lesson-mcp api`, port 8130 on 127.0.0.1 |
| Depends on | [`@studium/lesson-session-host`](../../packages/lesson-session-host), [`@studium/lesson-session`](../../packages/lesson-session) |
| Calls | nothing by default; a judge model only when `LITELLM_BASE_URL` is set |
| Tests | `pnpm --filter @studium/lesson-mcp test` |

## Run it

From a checkout, after `pnpm install` at the repository root:

```bash
pnpm --filter @studium/lesson-mcp start
```

The server writes one start-up line to stderr (stdout carries the protocol) naming the lessons folder,
the library, the data folder and whether a judge model is configured. To try it without touching your
home folder, keep the state in memory:

```bash
STUDIUM_EPHEMERAL=1 BUNDLES_ROOT="$PWD/fixtures" pnpm --filter @studium/lesson-mcp start
```

A single-file build that needs no checkout:

```bash
pnpm --filter @studium/lesson-mcp bundle   # writes apps/lesson-mcp/dist/studium-mcp.cjs
```

The VS Code extension builds the same entry point as `apps/studium-vscode/dist/lesson-mcp.cjs`.
Ready-made harness configurations are in [`docs/examples/`](../../docs/examples/) (`codex.toml`,
`mcp.claude.json`, `mcp.vscode.json`, `opencode-v2.json`); the
[harness guide](../../docs/start/harnesses.md) explains each one.

## What it offers

37 tools, two prompts (`learn` and `review`) and server instructions that tell the assistant to wait for
the learner's own answers. The full contract is in the [MCP tools reference](../../docs/reference/mcp-tools.md).

| Group | Tools |
|---|---|
| Lesson (25) | `start_lesson_session`, `get_current_scene`, `submit_response`, `request_hint`, `submit_turn`, `get_session_state`, `get_operator_context`, `explain_last_adaptation`, `get_workflow_graph`, `get_scene_artifacts`, `get_run_manifest`, `submit_run_result`, `record_experiment`, `get_experiment_journal`, `get_next_reinforcement`, `set_session_language`, `end_session`, `forget_session`, `get_server_info`, `list_community_bundles`, `open_peer_room`, `join_peer_room`, `get_peer_room_state`, `submit_peer_rating`, `close_peer_room` |
| Study over days (4) | `list_lessons`, `get_study_plan`, `start_review_session`, `rate_recall` |
| Authoring from sources (3) | `get_authoring_guide`, `prepare_sources`, `create_lesson` |
| Teacher (2) | `review_lesson`, `class_report` |
| Shared panel (3) | `open_lesson_panel`, `get_panel_view`, `panel_action` |

What the server guarantees:

- No answer key before an answer: scenes are redacted before they leave the server, and cited source
  passages of graded scenes are released only after the learner has answered.
- `end_session` closes a lesson and keeps progress. `forget_session {session_id}` erases this lesson's
  progress and the learner's cross-lesson profile and review schedule; `forget_session {learner_id}`
  erases every lesson's progress too. Its answer lists what was erased and what stays on disk: the
  lessons of the learner's library and their sources, which the learner deletes themselves.
- `create_lesson` writes `<course_id>/lesson.json` into the learner's library
  (`<STUDIUM_HOME>/library`) after validation and lint, never into `BUNDLES_ROOT`; quotes must match a
  prepared passage character for character. The lesson is marked as drafted by the agent, not
  validated by a teacher.
- `class_report` withholds each figure computed over fewer than five learners; neither the floor nor
  the data folder can be changed from the tool.
- Every date is a calendar day in the server's time zone, named by `get_server_info.time_zone`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STUDIUM_HOME` | `~/.studium` | root of the learner's library and data |
| `BUNDLES_ROOT` | `<STUDIUM_HOME>/library` | where lessons are looked up first; the library is always searched too |
| `STUDIUM_DATA_DIR` | `<STUDIUM_HOME>/data` | durable learner state |
| `STUDIUM_EPHEMERAL` | unset | `1` keeps state in memory unless `STUDIUM_DATA_DIR` is set (tests, demos, CI) |
| `STUDIUM_LEARNER_ID` | `anonymous` | learner id used when a call names none |
| `STUDIUM_PSEUDO_SECRET` | per-install file `<data dir>/.studium-secret` | secret of the on-disk learner pseudonyms |
| `LITELLM_BASE_URL` | empty | judge model endpoint; empty means no judge |
| `LITELLM_API_KEY`, `LITELLM_MODEL` | unset | credentials and model name for that endpoint |
| `STUDIUM_LLM_TIMEOUT_MS` | `20000` | time limit of a judge call |

The [configuration reference](../../docs/reference/configuration.md) lists every variable of every
surface.

## HTTP adapter

[`src/http.ts`](src/http.ts) exposes the lesson operations (not the study, authoring or teacher tools)
to a local client under `/v1/operations`. It listens on 127.0.0.1 only and requires a bearer token of at
least 32 characters:

```bash
STUDIUM_API_TOKEN="$(openssl rand -hex 32)" BUNDLES_ROOT="$PWD/fixtures" \
  pnpm --filter @studium/lesson-mcp api
```

| Variable | Default | Meaning |
|---|---|---|
| `STUDIUM_API_TOKEN` | none (required) | bearer token, 32 characters or more |
| `STUDIUM_API_PORT` | `8130` | port |
| `STUDIUM_API_LIVE` | unset | `1` enables the judge model for this transport |

Sessions last as long as the process. See the [HTTP API reference](../../docs/reference/http-api.md).

## File channel

[`src/session-runner-cli.ts`](src/session-runner-cli.ts) drives a lesson through files in a
`.studium-session/` folder (`task.md` out, `response.json` in, `feedback.md` back) for assistants that
edit files rather than call tools. The protocol is described in the
[agentic session protocol](../../docs/reference/agentic-session-protocol.md).

```bash
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-mcp exec tsx src/session-runner-cli.ts \
  capsule-run-demo/lesson.json --bundles-root=../../fixtures --dir="$(mktemp -d)" --stub
```

`--stub` lets a placeholder operator play to the end, as a quick check.

## Tests

```bash
pnpm --filter @studium/lesson-mcp test     # vitest, includes the learn-and-review end-to-end test
node apps/lesson-mcp/scripts/headless_smoke.mjs   # a bare MCP client against the real server (CI runs it)
```

[`src/learn-and-review.e2e.test.ts`](src/learn-and-review.e2e.test.ts) goes from "learn X" to the first
question in six Studium tool calls, then plays a review seven days later. The `*.mjs` scripts at the root
of this folder are older demonstrations; they keep their state in memory.

## See also

- [Learn with your assistant](../../docs/learn/learn-with-your-assistant.md)
- [How Studium works](../../docs/concepts/how-studium-works.md)
- [VS Code extension](../studium-vscode/README.md), which starts this server for its lesson pane
