English · [Français](troubleshooting.fr.md)

# Troubleshooting

Find your symptom in the tables below; each row gives the check and the fix. Before asking for help, note
the revision (`git rev-parse HEAD`), your assistant and its version, `node --version`, `pnpm --version`,
the command that fails, and, if the server starts, the output of `get_server_info`. Share a minimal error
message without keys, personal data or private lesson content.

## Install and build

| Symptom | Check and fix |
|---|---|
| `Repository not found` when cloning | the repository is private: run `gh auth login`, then clone again |
| `pnpm` not found or too old | `corepack enable`, or install pnpm 9.15.9 |
| `ERR_MODULE_NOT_FOUND` or a missing `dist/` | rerun `./setup.sh`, or `pnpm install --frozen-lockfile`, `pnpm build:libs`, then `pnpm --filter studium-vscode build` |
| `tsx` not found | start the built server with `node apps/studium-vscode/dist/lesson-mcp.cjs` instead |
| `listen EPERM` from `tsx` inside a sandbox | run through the loader, which opens no IPC socket: `node --import apps/lesson-mcp/node_modules/tsx/dist/loader.mjs apps/lesson-mcp/src/session-runner-cli.ts …` |
| `ModuleNotFoundError` in Python | use the repository's `.venv` and `.venv/bin/pip install -r requirements.txt`, not the system Python |

## Connecting an assistant

| Symptom | Check and fix |
|---|---|
| The server waits and shows no page | normal: it talks over stdio to an MCP client, not to a browser |
| No Studium tools in the chat | read the client's MCP log, check the absolute path to `lesson-mcp.cjs`, restart the server and open a new conversation |
| VS Code ignores the JSON | `.vscode/mcp.json` uses `servers`; Claude Code and Cursor use `mcpServers`; OpenCode v2 uses `mcp.servers` |
| Codex: `MCP tool call requires approval, but approval policy is never` | answer the prompts interactively, or run `codex exec --approve-for-me` |
| A tool you read about is missing | the build predates your checkout: rebuild with `pnpm --filter studium-vscode build`, restart the server, compare `get_server_info.build` |
| `persistence.durable` is false | `STUDIUM_EPHEMERAL=1` is set and `STUDIUM_DATA_DIR` is not: progress is lost at restart |
| The lesson you asked for is not found | the server looks in `BUNDLES_ROOT` first, then `~/.studium/library`; ask the assistant to call `list_lessons` |
| Two different steps in the chat and the pane | they run two servers; drive the lesson from one of them only |

## During a lesson

| Symptom | Check and fix |
|---|---|
| Answer rejected | send the learner's words with `submit_response {kind: "reply", text}`; read `get_operator_context` for the expected format |
| A quiz choice id is refused | choices are reshuffled per session: use the id shown in the current step, never one remembered from another session |
| `run required: call get_run_manifest, run it, then submit_run_result` | the step needs a real run: follow `get_run_manifest`, run the capsule, then `submit_run_result` |
| Open answers say "check it yourself" | expected without a judge model; see [Configuration](../reference/configuration.md#judge-model-optional) |
| The assistant answers or rates for you | stop it and answer yourself; the server instructions forbid it, and self-rating never moves mastery |
| `session not found: …` | the server restarted or the session was closed; the message says how to resume: `start_lesson_session` with the same `bundle_ref` and `learner_id`, or `start_review_session` with the same `learner_id`; the MCP Apps panel, the Claude Code pane and the VS Code pane show a "Session lost" notice with a reopen control instead of the stale scene |
| A self-rating is refused as expired | the request was lost by an older server; answer the step again to be asked anew |
| `now_ms must be an integer epoch in milliseconds …` | pass a whole number of milliseconds since 1970, or leave `now_ms` out to use the server clock |
| `create_lesson` refuses the `course_id` | a lesson of that id already exists: under `BUNDLES_ROOT` it is never replaced, so choose another id; in your library, pass `overwrite: true` to replace a self-study lesson no teacher validated |

## VS Code

| Symptom | Check and fix |
|---|---|
| F5 finds no launch configuration | open the folder `apps/studium-vscode`, which holds the Extension Host configuration |
| The installed VSIX finds no lesson | lessons are not in the VSIX: put them in `~/.studium/library`, or set `studium.bundlesRoot` and `studium.bundleRef`, or use **Studium: Pick a course** |
| A `vscode://` link opens nothing | the path must be absolute, without `..`, percent-encoded, to an existing `.json` file |
| Equations or plots look degraded | run `pnpm --filter studium-vscode vendor`, rebuild, and keep `studium.assets` at `vendor` |
| No review count in the status bar | none is due, or you have no history yet; use the refresh button of the Lessons view |

## HTTP API

| Answer | Meaning | What to do |
|---|---|---|
| `400` | invalid JSON or schema, missing `request_id` or `expected_scene_id` | fix the request from `api:call operations` |
| `401` / `403` | wrong token, a browser `Origin`, or a non-local address | give the server and the client the same token through their environment |
| `404` | unknown operation, or session gone (forgotten or server restarted) | do not invent a resume; start again from durable state |
| `409 stale_scene` | the step changed | read `get_operator_context`, then ask the learner again |
| `409 request_conflict` | a `request_id` reused for a different request | inspect the earlier action before choosing a new id |
| `410 forgotten` | the session was erased | respect the erasure |
| `413` / `415` | body over 1 MiB, or not `application/json` | send JSON; pass media as references |
| `422` | the engine refused the operation | read the error; do not force progress |
| `503` | busy, or the receipt limit (512 mutations or 16 MiB) is reached | retry with the same `request_id` if busy; export, then restart the server if full |

After a network error, resend the same file with the same `request_id`, never a second answer.

## Teacher tools and services

| Symptom | Check and fix |
|---|---|
| `check` refuses the draft | compare schema, ids and quotes with the evidence; keep `status: draft` and `validated_by: null` |
| Output folder already exists | choose a new path; the tools keep existing outputs on purpose |
| Observatory or MySTRA shows 404 | check `--course-root` and the course subfolder; see [Observatory](../teach/observatory.md) |
| Planner answers `503` | no model is configured; set one, or use `STUDIUM_LLM_MODE=mock` for the deterministic mock |
| Planner answers `422` | send `manifest_id` and `target` in the request body |
| Scene synthesis answers `503` | its orchestrator is not configured; starting the service alone is not enough |
| A "live" run returns mock output | check the mode, URL, model aliases and fallback flags: an HTTP 200 does not prove that a model answered |

## Checks that do not need a chat

From the repository root:

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs        # MCP server, in memory, no client needed
node apps/lesson-mcp/scripts/http-smoke.mjs new-api-audit   # HTTP API and report export; needs .venv
```

The first prints `all 19 assertions passed`. The second starts a temporary API server, drives it from
several client processes with synthetic answers, exports and verifies a report, then stops; its output
folder must not exist yet. Neither checks your assistant's sign-in, the VS Code pane, or whether a course
teaches well. The full test suites are described in [Testing](../develop/testing.md).

If the problem persists, report the step, the expected result, the reduced error, the revision, your
platform and a minimal reproduction. Do not publish a whole data folder, and do not bypass a check or a
protection to get a green light.
