English · [Français](opencode.fr.md)

# Connect OpenCode to Studium

Add the Studium server to OpenCode, so that OpenCode plays your lessons through Studium's tools.

## Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server
  (`npx -y studium-mcp`, or `node` on a file from a checkout or a release), `/path/to/studium`,
  `BUNDLES_ROOT` and `LITELLM_BASE_URL`. The `npx` form needs only Node; see [Installation](installation.md).
- Install OpenCode and configure a provider following the [OpenCode v2 documentation](https://opencode.ai/v2/docs)
  and its [MCP page](https://opencode.ai/v2/docs/mcp-servers).

## Do the task

1. For OpenCode v2, merge this into `opencode.jsonc` at the project root. **With `npx`** (no checkout):

   ```json
   {
     "mcp": {
       "servers": {
         "studium": {
           "type": "local",
           "command": ["npx", "-y", "studium-mcp"],
           "environment": { "LITELLM_BASE_URL": "" }
         }
       }
     }
   }
   ```

   **From a checkout**, use `"command": ["node", "/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. Run `opencode mcp list` to see the connection.

## What you get

`opencode mcp list` shows `studium`. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection). The complete example is
[opencode-v2.json](../examples/opencode-v2.json).

## Limits

- Older OpenCode versions use another configuration shape.
- An open model offered by your provider is neither free, local nor equal in quality by default.
