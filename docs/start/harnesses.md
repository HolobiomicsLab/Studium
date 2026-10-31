English · [Français](harnesses.fr.md)

# Connect your assistant

Studium runs as an MCP server that your AI assistant starts on your computer. Once it is connected, you
can say "I want to learn X with Studium" and the assistant builds, plays and schedules your lessons through
Studium's tools. This page gives a ready configuration for each supported assistant (we call the
assistant's client a *harness*; see the [glossary](../concepts/glossary.md)), then the direct HTTP API and
the file channel for scripts.

## Before you start

Finish the [installation](installation.md). Every configuration below starts the built server
`apps/studium-vscode/dist/lesson-mcp.cjs` with `node`; replace `/path/to/studium` with the absolute path of
your checkout. The server talks over stdio: it opens no port and shows no web page.

| Setting | Effect |
|---|---|
| No `BUNDLES_ROOT` (recommended) | lessons live in `~/.studium/library`, progress in `~/.studium/data` |
| `BUNDLES_ROOT=/path/to/studium/fixtures` | play the demo lessons shipped with the repository; lessons your assistant builds still go to `~/.studium/library` |
| `LITELLM_BASE_URL=""` | no judge model, even if your shell defines one (see [Optional judge model](#optional-judge-model)) |
| `STUDIUM_EPHEMERAL=1` | keep progress in memory only, for a demo or a test |

The files in [docs/examples](../examples/) are complete examples that add `BUNDLES_ROOT` for the demo
lessons: [codex.toml](../examples/codex.toml), [mcp.claude.json](../examples/mcp.claude.json),
[mcp.vscode.json](../examples/mcp.vscode.json) and [opencode-v2.json](../examples/opencode-v2.json). Merge
them into your client's file; never overwrite other servers already configured there. All variables are
listed in [Configuration](../reference/configuration.md).

## Check the connection

A configuration entry, or a skill the client discovered, does not prove the server is connected. Ask:

```text
Call the Studium tool get_server_info and tell me the version, the build date, the number of tools and
whether my progress is durable. Then call get_study_plan.
```

The answer should list 34 tools (25 lesson, 4 study, 3 authoring, 2 teacher tools; see
[MCP tools](../reference/mcp-tools.md)) and `persistence.durable: true`. If `durable` is false, progress is
lost when the server stops. When the server connects, the assistant also receives Studium's instructions
(relay each `display_markdown` as it is, wait for your own answer, never answer or rate for you) and two
prompts, `learn` and `review`, in clients that support MCP prompts.

## Codex

Install and sign in following the [Codex quickstart](https://learn.chatgpt.com/docs/quickstart); MCP options are in [MCP in Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Then add the
server from your checkout:

```bash
codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
codex mcp list
```

or merge this into `~/.codex/config.toml`:

```toml
[mcp_servers.studium]
command = "node"
args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]

[mcp_servers.studium.env]
LITELLM_BASE_URL = ""
```

A Codex profile with `approval_policy = "never"` refuses every call to a local stdio MCP server
(`MCP tool call requires approval, but approval policy is never`). Answer the approval prompts in an
interactive session, or run non-interactively with `codex exec --approve-for-me` (not combinable with
`-s/--sandbox`). For a one-off run with another lesson folder, pass everything with `-c`:

```bash
codex exec --approve-for-me --skip-git-repo-check -C /path/to/workdir \
  -c 'mcp_servers.studium.command="node"' \
  -c 'mcp_servers.studium.args=["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
  -c 'mcp_servers.studium.env={BUNDLES_ROOT="/path/to/lessons",LITELLM_BASE_URL=""}' \
  - < prompt.md
```

The Studium server writes only under its data folder; it never runs a capsule itself.

## Claude Code

Install and sign in following the [Claude Code setup](https://code.claude.com/docs/en/setup). From your
checkout:

```bash
claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
claude mcp list
```

`--scope project` writes `.mcp.json` at the project root; its shape is:

```json
{
  "mcpServers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

Inside a session, `/mcp` shows the connection. For a non-interactive run, pass the configuration file and
allow the Studium tools explicitly:

```bash
claude -p --mcp-config .mcp.json --strict-mcp-config \
  --allowedTools "mcp__studium__*" --permission-mode dontAsk --max-budget-usd 2 \
  "Call get_server_info, then get_study_plan, and show me the result."
```

This configures Claude Code, not the Claude desktop app.

## Copilot in VS Code

Copilot Chat in agent mode reads MCP servers from `.vscode/mcp.json`. Open the checkout as the workspace and
merge:

```json
{
  "servers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

In the Command Palette, run **MCP: List Servers**, select `studium` and start it; its log shows errors.
VS Code uses `servers`, not the `mcpServers` key of Claude Code and Cursor. Reference:
[MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

Students can get Copilot through GitHub Education: request student verification
([GitHub Education for students](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
then activate Copilot Student in your Copilot settings
([set up Copilot for students](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
Verification and activation are two steps and the benefit can take days to appear; check the request
before paying. Verified teachers have their own path
([teachers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
Send supporting documents to GitHub only, never to a course repository. Plans, models and limits are set
by GitHub and change over time.

The Studium extension's lesson pane starts its own server. Copilot's MCP client and the pane do not share
the current scene: drive a lesson from one of them at a time. See [VS Code](vscode.md).

## OpenCode

Install OpenCode and configure a provider following the [OpenCode v2 documentation](https://opencode.ai/v2/docs) and its [MCP page](https://opencode.ai/v2/docs/mcp-servers).
For OpenCode v2, merge this into `opencode.jsonc` at the project root:

```json
{
  "mcp": {
    "servers": {
      "studium": {
        "type": "local",
        "command": ["node", "/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
        "environment": { "LITELLM_BASE_URL": "" }
      }
    }
  }
}
```

`opencode mcp list` shows the connection. Older OpenCode versions use another configuration shape. An open
model offered by your provider is neither free, local nor equal in quality by default.

## Cursor

Merge this into `.cursor/mcp.json` and enable the tools as the
[Cursor MCP documentation](https://cursor.com/docs/mcp) explains:

```json
{
  "mcpServers": {
    "studium": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

## Direct HTTP API

For scripts and custom clients, Studium also runs as a local JSON API. It serves the 25 lesson operations
only; the study, authoring and teacher tools are MCP-only in this version. Start it in a terminal you keep
open:

```bash
export STUDIUM_API_TOKEN="$(openssl rand -hex 32)"   # at least 32 characters, shared with your clients
pnpm --filter @studium/lesson-mcp api
```

It listens on `http://127.0.0.1:8130` only (`STUDIUM_API_PORT` changes the port), refuses browser requests
that carry an `Origin` header, and reads lessons from `BUNDLES_ROOT` (default: the checkout's `fixtures/`).
Progress is kept in memory unless `STUDIUM_DATA_DIR` is set, and the judge model stays off unless
`STUDIUM_API_LIVE=1`. Keep the token in your environment, never in a chat or in Git. Then, from the
checkout:

```bash
pnpm --silent --filter @studium/lesson-mcp api:call health
pnpm --silent --filter @studium/lesson-mcp api:call operations
pnpm --silent --filter @studium/lesson-mcp api:call start_lesson_session start.json
```

with `start.json`:

```json
{
  "request_id": "lesson-start-001",
  "arguments": { "bundle_ref": "capsule-judgment-demo/lesson.json", "learner_id": "local-student", "presentation_language": "en" }
}
```

Every mutation needs a unique `request_id`; resending the identical request with the same id returns the
first result instead of acting twice, which makes a retry after a network error safe. `submit_response`,
`submit_turn`, `request_hint`, `record_experiment` and `submit_run_result` also need `expected_scene_id`.
Routes, status codes and limits are in the [HTTP API reference](../reference/http-api.md). The older REST
service `apps/lesson-server` (port 8010, answer keys redacted) is a separate process whose session ids are
not interchangeable with this API's; use this API for a new harness integration.

To switch assistants in the middle of a lesson, keep the same server running and give the new assistant the
`session_id`, the language and any pending action; it reads `get_operator_context` before acting. Do not
restart the lesson. A server restart ends its sessions: a call on an old `session_id` answers `session not
found` and says how to resume. With durable storage, a new `start_lesson_session` for the same learner and
lesson resumes at the first unfinished step.

Export what you want to keep before stopping an in-memory server. With `context.json` holding
`{"arguments":{"session_id":"<id>"}}`:

```bash
pnpm --silent --filter @studium/lesson-mcp api:call get_experiment_journal context.json > journal.json
.venv/bin/python tools/learner_report.py export new-report --journal journal.json
```

See [Learner report](../learn/learner-report.md) for what the report contains.

## File channel

Without MCP or HTTP, a runner writes each step to `task.md` in a session folder and waits for
`response.json`, written atomically (`response.json.tmp`, then rename). Try it with a placeholder operator:

```bash
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=/path/to/new-session --stub
```

The folder must be new. Without `--stub`, the runner waits for real answers. The
[harness skill](../../skills/studium-harness/SKILL.md) describes the formats.

## Optional judge model

By default no model grades open answers: you get the reference to compare with, and no feedback claims a
coverage that nothing measured. A judge is an OpenAI-compatible endpoint (for example a LiteLLM proxy) set
with `LITELLM_BASE_URL` and, if needed, `LITELLM_API_KEY`. The MCP server uses it when the variable is not
empty; the HTTP API also requires `STUDIUM_API_LIVE=1`. Keep keys in your local secret store and check the
fallback flags of a live run: an HTTP 200 does not prove that a model answered. A proxy must route the
model aliases Studium calls: `studium/planner`, `studium/critic`, `studium/graph-builder`,
`studium/scene-synth`, `studium/teacher-review` and `studium/runtime-tutor`.
