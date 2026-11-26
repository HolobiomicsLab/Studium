English · [Français](cursor.fr.md)

# Connect Cursor to Studium

Add the Studium server to Cursor, so that Cursor plays your lessons through Studium's tools.

## With the VS Code extension: one click, no Node

With the Studium extension for VS Code installed, you need no terminal and no Node:

1. In VS Code, run **Studium: Connect an Assistant…** from the Command Palette and tick **Cursor** (the empty
   **Lessons** view has the link too).
2. Restart Cursor, then enable the Studium tools as the Cursor documentation explains.
3. Ask Cursor: "I want to learn … with Studium", naming your sources.

The command writes one `studium` entry into `~/.cursor/mcp.json` (every project), and nothing else; the previous file is kept beside it as
`<file>.studium-backup`. The entry runs the Studium server the extension carries, with VS Code's own executable, and
uses the same lessons folder, progress and learner as the Studium pane. A lesson is offered in your
[browser](browser.md#from-your-assistant). A `studium` entry you wrote yourself is replaced only if you say yes. Each
Studium update rewrites the entry; **Studium: Disconnect an Assistant…** removes it, and so does uninstalling the
extension, as far as VS Code runs its uninstall step.

Checked on 26 November 2026 on macOS: Cursor was not installed on the test computer: the entry has the shape this page gives below, and the extension's tests check it, but it was not tried in Cursor yet.

The sections below set the server up by hand.

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
