English · [Français](cursor.fr.md)

# Connect Cursor to Studium

Add the Studium server to Cursor, so that Cursor plays your lessons through Studium's tools.

## Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server
  (`npx -y studium-mcp`, or `node` on a file from a checkout or a release), `/path/to/studium`,
  `BUNDLES_ROOT` and `LITELLM_BASE_URL`. The `npx` form needs only Node; see [Installation](installation.md).
- Read the [Cursor MCP documentation](https://cursor.com/docs/mcp), which explains how to enable the tools.

## Do the task

1. Merge this into `.cursor/mcp.json` (this project) or `~/.cursor/mcp.json` (every project). **With `npx`**
   (no checkout):

   ```json
   {
     "mcpServers": {
       "studium": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "studium-mcp"],
         "env": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

   **From a checkout**, use `"command": "node"` and
   `"args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. Enable the Studium tools as the Cursor documentation explains.

## What you get

The Studium tools are enabled in Cursor. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

## Limits

Cursor uses the `mcpServers` key, like Claude Code; VS Code uses `servers` (see
[Copilot in VS Code](copilot.md)).
