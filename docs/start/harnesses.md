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

The answer should list 40 tools (25 lesson, 5 study, 3 authoring, 2 teacher tools, 1 form tool, 3 panel tools and 1 companion tool; see
[MCP tools](../reference/mcp-tools.md)) and `persistence.durable: true`. If `durable` is false, progress is
lost when the server stops. When the server connects, the assistant also receives Studium's instructions
(relay each `display_markdown` as it is, wait for your own answer, never answer or rate for you) and two
prompts, `learn` and `review`, in clients that support MCP prompts.

## Keep answers fast

Studium grades an answer and chooses the next screen in a few milliseconds. What you wait for is the
assistant that relays it. Three choices decide most of that wait:

- **A session for the lesson.** Play a lesson in a new, short session, not at the end of a long working
  conversation: every answer carries the whole conversation behind it.
- **A fast model.** Relaying needs no reasoning, since Studium grades and routes. Keep the larger model for
  a question that needs a real explanation.
- **The MCP connection** described on this page, not shell calls to the HTTP API: each shell call starts a
  process.

Measured on the demo lesson `atomistique-l1` with `tools/latency_bench.py` (Claude Code, medians over six
answers, 6 November 2026):

| Who relays | End of the reply | First word |
|---|---|---|
| a large model, through shell calls, at the end of a long working session (a real trial, desktop app) | 27 s | about 20 s |
| the same large model, short session, MCP tools | 8.2 s | 5.4 s |
| the fast model, short session, MCP tools | 5.4 s | 2.0 s |
| the lesson agent `studium-lesson` as the session (see [Claude Code](#claude-code)) | 5.5 s | 1.9 s |
| a large model handing every answer to that fast agent | 16.1 s | 13.5 s |

One run per line: a difference of a second between two lines is not established. The bench measures a
relay in Claude Code; it does not measure the other clients on this page, or what anyone learns. Lowering
the reasoning effort changed nothing measurable. The last line is the trap: an agent placed between you and
the server makes two models write every screen.

A prototype goes one step further: where the client can show forms (MCP elicitation), `play_in_forms` lets
Studium ask the questions itself. You read a screen or pick a choice in a form, the verdict opens the next
form, and no model writes anything in between; the conversation resumes when a step needs your own words or
when you close a form to ask something. Each form ends with the same line: for a hint, a question, the map
or a proposal, decline the form and say it in the conversation; a form never asks you to say "continue",
since nothing can be said in it. Ask your assistant to "play the next steps in forms". How each
client draws a long screen or a formula in such a form has not been tried yet.

With no model in between, the server's own part is small: an answer given in a form or on a panel gets its
verdict in under 20 ms at the 95th centile, transport included (same script, `--mode forms` and
`--mode panel`, three runs of 32 to 40 answers each, the learner's state saved to disk, 6 November 2026).
The time a client then takes to draw the screen is not in that figure and has not been measured.

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

### The lesson agent

The repository ships two agent definitions in `.claude/agents/`. `studium-lesson` plays a lesson or a review
as a strict relay on the fast model: it shows each screen as Studium wrote it, sends your words, and adds
nothing. `studium-explainer` is a stronger model it calls when your question needs a real explanation; the
lesson goes on while the explanation is written; its text opens with « Generated explanation », so that
you can tell it from the lesson's. The lesson agent opens a lesson on the best surface your client shows (a
panel or a pane, forms, or the conversation), and when you come back to it after playing there, it first
reads what you did, so that it does not show you a screen again. A client that renders MCP Apps may show
the panel even when the lesson is played in the conversation or in forms: the panel then says so (« This
lesson is played in the conversation », « The panel is not the surface negotiated for this session. ») and
draws no scene and no answer control, so you answer where the lesson is played. Its « Play here » button,
shown when your client can render the panel, asks the server to move the session to the panel. From the
checkout:

```bash
claude --agent studium-lesson
```

To use them from any folder, link them into your user agents once:

```bash
mkdir -p ~/.claude/agents
ln -s "$PWD/.claude/agents/studium-lesson.md" "$PWD/.claude/agents/studium-explainer.md" ~/.claude/agents/
```

In a folder you only use to study, `{"agent": "studium-lesson"}` in `.claude/settings.json` makes every
session there a lesson session. In a session that is already open, `/model haiku` for the time of the lesson
gives most of the same gain. Do not ask a large model to hand each answer to the agent (see
[Keep answers fast](#keep-answers-fast)).

### The status line

In durable mode, Studium notes where the lesson stands in `status.json`, in your learner folder, at each
screen and each answer. The script `tools/studium_statusline.mjs` prints its line, the one each screen ends
with:

```text
Les atomes · étape 2/3 · 3 min · à toi de répondre
```

The line holds 80 characters at most. A long lesson title is cut before its last separator that fits
("Atomistique L1 — Chapitre 1 (atomes, orbitales)" reads "Atomistique L1 — Chapitre 1"), so it does not
change from one screen to the next. While you answer the check questions of a concept you contested, the step
gives way to "check 1/2" ("contrôle 1/2" in a French lesson).

To show it in Claude Code's status line, add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/studium/tools/studium_statusline.mjs"
  }
}
```

The script needs no install and prints nothing when no lesson is being played: the session was closed, the
server stopped, or progress is kept in memory only (`STUDIUM_EPHEMERAL=1`), where nothing is written. It
finds the data folder as the server does (`STUDIUM_DATA_DIR`, else `<STUDIUM_HOME>/data`); `--data-dir=DIR`
names another. If you gave the server `STUDIUM_DATA_DIR` or `STUDIUM_HOME` in `.mcp.json`, give the script
the same. With several lessons open on one machine, it shows the one that moved last, in every Claude Code
window.

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

For scripts and custom clients, Studium also runs as a local JSON API. It serves 26 operations: the 25
lesson operations plus `rate_recall`, so a self-rating requested by an HTTP lesson transition can be
recorded. The other study tools (`get_study_plan`, `list_lessons`, `start_review_session`) and all authoring
and teacher tools are MCP-only in this version. Start it in a terminal you keep open:

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
`rate_recall` needs a `request_id` but no `expected_scene_id`: pass the requested scene as its
`arguments.scene_id`.
Routes, status codes and limits are in the [HTTP API reference](../reference/http-api.md). The older REST
service `apps/lesson-server` (port 8010, answer keys redacted) is a separate process whose session ids are
not interchangeable with this API's; use this API for a new harness integration.

To switch assistants in the middle of a lesson, keep the same server running and give the new assistant the
`session_id`, the language and any pending action; it reads `get_operator_context` before acting. Do not
restart the lesson. A server restart ends its sessions: a call on an old `session_id` answers `session not
found` and says how to resume. With durable storage, a new `start_lesson_session` for the same learner and
lesson resumes at the first unfinished step. On a panel or a pane, the learner's next action on the old
session replaces the scene with "Session lost (the server restarted or the session was closed). Reopen the
lesson: your progress is kept." and a reopen control: the MCP Apps panel's button and the Claude Code pane's
button open the same lesson for the same learner (the Claude Code pane also names `/studium <bundle_ref>`),
and the VS Code pane's button closes it and opens the lesson in a new pane. Nothing is retried on its own.

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
