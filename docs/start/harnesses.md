English · [Français](harnesses.fr.md)

# Connect your assistant

Studium runs as an MCP server that your AI assistant starts on your computer. Once it is connected, you
can say "I want to learn X with Studium" and the assistant builds, plays and schedules your lessons through
Studium's tools. This page helps you pick the page for your client, then shows how to check the connection.

## Before you start

The assistant's client is called a *harness* (see the [glossary](../concepts/glossary.md)). Finish the
[installation](installation.md): it builds the server file `apps/studium-vscode/dist/lesson-mcp.cjs` with
this command.

```bash
pnpm --filter studium-vscode build
```

Every configuration starts that file with `node`; replace `/path/to/studium` with the absolute path of
your checkout. The server talks over stdio: it opens no port and shows no web page.

You meet two environment variables first:

| Setting | Effect |
|---|---|
| `BUNDLES_ROOT` | Leave it unset (recommended): lessons live in `~/.studium/library`, progress in `~/.studium/data`. Set `BUNDLES_ROOT=/path/to/studium/fixtures` to play the demo lessons shipped with the repository; lessons your assistant builds still go to `~/.studium/library`. |
| `LITELLM_BASE_URL=""` | No judge model, even if your shell defines one (see [Judge model](../reference/configuration.md#judge-model-optional)). |

`STUDIUM_EPHEMERAL=1` keeps progress in memory only, for a demo or a test. All variables are listed in
[Configuration](../reference/configuration.md).

The files in [docs/examples](../examples/) are complete examples that add `BUNDLES_ROOT` for the demo
lessons: [codex.toml](../examples/codex.toml), [mcp.claude.json](../examples/mcp.claude.json),
[mcp.vscode.json](../examples/mcp.vscode.json) and [opencode-v2.json](../examples/opencode-v2.json). Merge
them into your client's file; never overwrite other servers already configured there.

## Choose your client

| Client | Where its configuration lives | Page |
|---|---|---|
| Codex | `~/.codex/config.toml`, or `codex mcp add` | [Connect Codex](codex.md) |
| Claude Code | `.mcp.json` at the project root | [Connect Claude Code](claude-code.md) |
| Copilot in VS Code | `.vscode/mcp.json` | [Connect Copilot in VS Code](copilot.md) |
| OpenCode | `opencode.jsonc` at the project root | [Connect OpenCode](opencode.md) |
| Cursor | `.cursor/mcp.json` | [Connect Cursor](cursor.md) |
| A script or a custom client | no MCP configuration | [HTTP API](../reference/http-api.md) and [file channel](../reference/agentic-session-protocol.md) |

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

## Where to go next

- [Keep answers fast](fast-answers.md): the choices that decide how long you wait for each screen.
- [Skills](skills.md) and [lesson panels](harness-panels.md) for your assistant.
- [VS Code](vscode.md) for the extension's own lesson pane.
- [Troubleshooting](troubleshooting.md) when the check fails.
