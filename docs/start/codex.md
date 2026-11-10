English · [Français](codex.fr.md)

# Connect Codex to Studium

Add the Studium server to Codex, so that Codex builds, plays and schedules your lessons through Studium's
tools.

## Before you start

- Finish the [installation](installation.md) and read [Connect your assistant](harnesses.md): it explains
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`.
- Install and sign in to Codex following the [Codex quickstart](https://learn.chatgpt.com/docs/quickstart).
  MCP options are in [MCP in Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Do the task

1. Add the server from your checkout:

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   codex mcp list
   ```

2. Or merge this into `~/.codex/config.toml`:

   ```toml
   [mcp_servers.studium]
   command = "node"
   args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]

   [mcp_servers.studium.env]
   LITELLM_BASE_URL = ""
   ```

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
