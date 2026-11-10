English · [Français](copilot.fr.md)

# Connect Copilot in VS Code to Studium

Add the Studium server to Copilot Chat in agent mode, so that Copilot plays your lessons through Studium's
tools. This page is about Copilot's own MCP client; the extension's lesson pane is in [VS Code](vscode.md).

## Before you start

- Finish the [installation](installation.md) and read [Connect your assistant](harnesses.md): it explains
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`.
- Open the checkout as the workspace. Copilot Chat in agent mode reads MCP servers from `.vscode/mcp.json`.
- Students can get Copilot through GitHub Education: request student verification
  ([GitHub Education for students](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
  then activate Copilot Student in your Copilot settings
  ([set up Copilot for students](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
  Verification and activation are two steps and the benefit can take days to appear; check the request
  before paying. Verified teachers have their own path
  ([teachers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
  Send supporting documents to GitHub only, never to a course repository.

## Do the task

1. Merge this into `.vscode/mcp.json`:

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

2. In the Command Palette, run **MCP: List Servers**, select `studium` and start it. Its log shows errors.

VS Code uses `servers`, not the `mcpServers` key of Claude Code and Cursor. Reference:
[MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## What you get

**MCP: List Servers** shows `studium` running. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

## Limits

- The Studium extension's lesson pane starts its own server. Copilot's MCP client and the pane do not share
  the current scene: drive a lesson from one of them at a time. See [VS Code](vscode.md).
- Plans, models and limits are set by GitHub and change over time.
