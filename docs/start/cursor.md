English · [Français](cursor.fr.md)

# Connect Cursor to Studium

Add the Studium server to Cursor, so that Cursor plays your lessons through Studium's tools.

## Before you start

- Finish the [installation](installation.md) and read [Connect your assistant](harnesses.md): it explains
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`.
- Read the [Cursor MCP documentation](https://cursor.com/docs/mcp), which explains how to enable the tools.

## Do the task

1. Merge this into `.cursor/mcp.json`:

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

2. Enable the Studium tools as the Cursor documentation explains.

## What you get

The Studium tools are enabled in Cursor. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

## Limits

Cursor uses the `mcpServers` key, like Claude Code; VS Code uses `servers` (see
[Copilot in VS Code](copilot.md)).
