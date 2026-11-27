English · [Français](harnesses.fr.md)

# Connect your assistant

Studium runs as an MCP server that your AI assistant starts on your computer. Once it is connected, you
can say "I want to learn X with Studium" and the assistant builds, plays and schedules your lessons through
Studium's tools. This page helps you pick the page for your client, then shows how to check the connection.

## Before you start

The assistant's client is called a *harness* (see the [glossary](../concepts/glossary.md)). The server
talks over stdio: it opens no port and shows no web page. A configuration starts it in one of two ways:

| Way | Command | When |
|---|---|---|
| From npm | `npx -y studium-mcp` | the usual way; needs only Node 20 or later (see [Installation](installation.md#add-the-server-to-your-assistant)) |
| From a file | `node /path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs` | from a checkout after `pnpm --filter studium-vscode build`, or with a `lesson-mcp.cjs` downloaded from a release (use its own path) |

Each client page gives the `npx` form first and the checkout form second. Replace `/path/to/studium` with
the absolute path of your checkout. If `npx` cannot reach npm, see
[Where the packages are](installation.md#where-the-packages-are).

You meet two environment variables first:

| Setting | Effect |
|---|---|
| `BUNDLES_ROOT` | Leave it unset (recommended): lessons live in `~/.studium/library`, progress in `~/.studium/data`. Set `BUNDLES_ROOT=/path/to/studium/fixtures` to play the demo lessons shipped with the repository; lessons your assistant builds still go to `~/.studium/library`. |
| `LITELLM_BASE_URL=""` | No judge model, even if your shell defines one (see [Judge model](../reference/configuration.md#judge-model-optional)). |

`STUDIUM_EPHEMERAL=1` keeps progress in memory only, for a demo or a test. All variables are listed in
[Configuration](../reference/configuration.md).

The files in [docs/examples](../examples/) are complete examples, in the checkout form, that add
`BUNDLES_ROOT` for the demo lessons: [codex.toml](../examples/codex.toml), [mcp.claude.json](../examples/mcp.claude.json),
[mcp.vscode.json](../examples/mcp.vscode.json) and [opencode-v2.json](../examples/opencode-v2.json). Merge
them into your client's file; never overwrite other servers already configured there.

## Choose your client

With the Studium extension for VS Code, **Studium: Connect an Assistant…** connects Mistral Vibe, Codex, Claude Code,
Claude Desktop, Cursor and OpenCode in one click, with no Node and no terminal: it writes one `studium` entry into each
assistant's own file, running the server the extension carries. Copilot in VS Code has the server already. Each page
below starts with that route, then gives the manual one. When the assistant already runs Studium under another
name (a development entry, an older hand-written one), the command says so after writing its own entry: the assistant
would list each Studium tool twice, so keep one. It never removes an entry it did not write.

| Client | Where its configuration lives | Page |
|---|---|---|
| Codex | **Studium: Connect an Assistant…** in VS Code (no Node), or `~/.codex/config.toml`, or `codex mcp add` | [Connect Codex](codex.md) |
| Claude Code | **Studium: Connect an Assistant…** in VS Code (no Node), the `studium` plugin, `claude mcp add`, or `.mcp.json` at the project root | [Connect Claude Code](claude-code.md) |
| Copilot in VS Code | `.vscode/mcp.json` | [Connect Copilot in VS Code](copilot.md) |
| OpenCode | **Studium: Connect an Assistant…** in VS Code (no Node), or `opencode.jsonc` at the project root | [Connect OpenCode](opencode.md) |
| Cursor | **Studium: Connect an Assistant…** in VS Code (no Node), or `.cursor/mcp.json` or `~/.cursor/mcp.json` | [Connect Cursor](cursor.md) |
| Mistral Vibe | **Studium: Connect an Assistant…** or **Studium: Connect Mistral Vibe** in VS Code (no Node), or `~/.vibe/config.toml`, or `vibe mcp add` | [Connect Mistral Vibe](vibe.md) |
| Claude Desktop | **Studium: Connect an Assistant…** in VS Code (no Node), or `claude_desktop_config.json` | [below](#claude-desktop) |
| A script or a custom client | no MCP configuration | [HTTP API](../reference/http-api.md) and [file channel](../reference/agentic-session-protocol.md) |

## Claude Desktop

**From Studium 0.6.8, the simplest way:** download `studium-vX.Y.Z.mcpb` from the
[latest release](https://github.com/HolobiomicsLab/Studium/releases/latest), double-click it, and choose **Install** in
Claude Desktop. Claude Desktop runs the server with the Node it ships: no Node, no VS Code, no file to edit. The bundle
carries « Discover Studium »; ask Claude « I want to learn X with Studium ». Its manifest and the server it starts are
checked by the release build; installing it in Claude Desktop was not tried yet.

Otherwise, Claude Desktop reads `claude_desktop_config.json`, in `~/Library/Application Support/Claude/` on macOS and
in `%APPDATA%\Claude\` on Windows. With the Studium extension for VS Code, **Studium: Connect an Assistant…** with
**Claude Desktop** ticked writes the entry for you, with no Node; then quit and reopen Claude Desktop. Checked on
26 November 2026 on macOS: the entry it writes started the server with its 40 tools; Claude Desktop itself was not
tried yet. By hand, merge this into the file, then restart the app:

```json
{
  "mcpServers": {
    "studium": {
      "command": "npx",
      "args": ["-y", "studium-mcp"],
      "env": { "LITELLM_BASE_URL": "" }
    }
  }
}
```

From a checkout, use `"command": "node"` and `"args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

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
