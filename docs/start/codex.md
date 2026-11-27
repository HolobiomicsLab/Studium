English · [Français](codex.fr.md)

# Connect Codex to Studium

Add the Studium server to Codex, so that Codex builds, plays and schedules your lessons through Studium's
tools.

## With the VS Code extension: one click, no Node

With the Studium extension for VS Code installed, you need no terminal and no Node:

1. In VS Code, run **Studium: Connect an Assistant…** from the Command Palette and tick **Codex** (the empty
   **Lessons** view has the link too).
2. Reload the VS Code window for Codex in VS Code (the notice has a **Reload Window** button); in a terminal, start a new `codex` session.
3. Ask Codex: "I want to learn … with Studium", naming your sources.

The command writes one `studium` entry into `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), and nothing else; the previous file is kept beside it as
`<file>.studium-backup`. The entry runs the Studium server the extension carries, with VS Code's own executable, and
uses the same lessons folder, progress and learner as the Studium pane. When Codex runs inside VS Code, a lesson is
offered in the Studium pane and opens there by itself when it is ready; elsewhere, in your
[browser](browser.md#from-your-assistant). A `studium` entry you wrote yourself is replaced only if you say yes. Each
Studium update rewrites the entry; **Studium: Disconnect an Assistant…** removes it, and so does uninstalling the
extension, as far as VS Code runs its uninstall step.

Checked on 26 November 2026 on macOS: Codex (codex-cli 0.170.0) read the entry (`codex mcp get studium`), and the entry started the server with its 40 tools. A conversation in Codex with this entry was not tried yet.

The sections below set the server up by hand.

## Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server
  (`npx -y studium-mcp`, or `node` on a file from a checkout or a release), `/path/to/studium`,
  `BUNDLES_ROOT` and `LITELLM_BASE_URL`. The `npx` form needs only Node; see [Installation](installation.md).
- Install and sign in to Codex following the [Codex quickstart](https://learn.chatgpt.com/docs/quickstart).
  MCP options are in [MCP in Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Do the task

1. Add the server. **With `npx`** (no checkout):

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp
   codex mcp list
   ```

   **From a checkout**, in its root folder:

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   ```

2. Or merge this into `~/.codex/config.toml`:

   ```toml
   [mcp_servers.studium]
   command = "npx"
   args = ["-y", "studium-mcp"]

   [mcp_servers.studium.env]
   LITELLM_BASE_URL = ""
   ```

   From a checkout, use `command = "node"` and
   `args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

3. Answer the approval prompts in an interactive session, or run non-interactively with
   `codex exec --approve-for-me` (not combinable with `-s/--sandbox`). For a one-off run with another
   lesson folder, pass everything with `-c`:

   ```bash
   codex exec --approve-for-me --skip-git-repo-check -C /path/to/workdir \
     -c 'mcp_servers.studium.command="node"' \
     -c 'mcp_servers.studium.args=["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
     -c 'mcp_servers.studium.env={BUNDLES_ROOT="/path/to/lessons",LITELLM_BASE_URL=""}' \
     - < prompt.md
   ```

## What you get

`codex mcp list` shows `studium`. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

A Codex that announces MCP Apps (Codex Desktop) is offered a lesson ready to play in Studium's panel first:
the assistant opens it with `open_lesson_panel`. Your web browser comes second and the chat third, on
"here". A Codex that announces no MCP Apps gets the browser first. See
[Where a lesson is offered first](harness-panels.md#where-a-lesson-is-offered-first). Not yet tried in
Codex Desktop: automated tests only.

## Limits

- A Codex profile with `approval_policy = "never"` refuses every call to a local stdio MCP server
  (`MCP tool call requires approval, but approval policy is never`).
- The Studium server writes only under its data folder; it never runs a capsule itself.
