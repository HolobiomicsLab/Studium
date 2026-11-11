English · [Français](codex.fr.md)

# Connect Codex to Studium

Add the Studium server to Codex, so that Codex builds, plays and schedules your lessons through Studium's
tools.

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

## Limits

- A Codex profile with `approval_policy = "never"` refuses every call to a local stdio MCP server
  (`MCP tool call requires approval, but approval policy is never`).
- The Studium server writes only under its data folder; it never runs a capsule itself.
