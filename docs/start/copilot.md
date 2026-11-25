English · [Français](copilot.fr.md)

# Connect Copilot in VS Code to Studium

Give Copilot Chat in agent mode the Studium server, so that Copilot builds and plays your lessons through
Studium's tools. With the Studium extension installed there is nothing to add: the extension offers its own
server to Copilot. This page is about Copilot's MCP client; the extension's lesson pane is in
[VS Code](vscode.md).

## Before you start

- Students can get Copilot through GitHub Education: request student verification
  ([GitHub Education for students](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
  then activate Copilot Student in your Copilot settings
  ([set up Copilot for students](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
  Verification and activation are two steps and the benefit can take days to appear; check the request
  before paying. Verified teachers have their own path
  ([teachers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
  Send supporting documents to GitHub only, never to a course repository.
- For the route without the extension, read [Connect your assistant](harnesses.md): it explains the two
  ways to start the server (`npx -y studium-mcp`, or `node` on a file from a checkout or a release),
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`. The `npx` form needs Node; see
  [Installation](installation.md).

## Do the task

### With the Studium extension: no Node, no command

1. Install the Studium extension in VS Code 1.101 or later (the **About** dialog gives the version).
2. Open Copilot Chat and choose the agent mode.
3. In the Command Palette, run **MCP: List Servers**. **Studium** is in the list, provided by the
   extension. Start it if it is stopped; VS Code may ask you to trust it first.

The extension runs the server it carries with VS Code's own runtime, the same server as its lesson pane:
no Node install and no terminal. That server reads the lessons folder of the `studium.bundlesRoot` setting
(empty: your personal library, `~/.studium/library`), writes the lessons it builds to that library, and
keeps progress in the extension's storage. It calls no judge model, unless `LITELLM_BASE_URL` is set in the
environment VS Code was started from. To turn this off, set `studium.registerMcpServer` to `false`.

**If you already added `studium` yourself**, with `code --add-mcp` or in an `mcp.json`, the extension
does not add a second one: the output channel **Studium — lesson-mcp** names the file that holds yours.
Copilot keeps using your entry. To switch to the built-in server, remove your entry; the extension
then offers its own. It looks in your user profile's `mcp.json`, in each workspace folder's
`.vscode/mcp.json` and `.mcp.json`, in Copilot's `~/.copilot/mcp-config.json` (or under `COPILOT_HOME`),
and in the older `mcp.servers` setting. A server added in another VS Code profile is not seen.

### Without the extension

1. Add the server. **With `npx`** (no checkout), in one command:

   ```bash
   code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'
   ```

   or merge this into `.vscode/mcp.json`:

   ```json
   {
     "servers": {
       "studium": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "studium-mcp"],
         "env": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

   **From a checkout** opened as the workspace, use `"command": "node"` and
   `"args": ["${workspaceFolder}/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. In the Command Palette, run **MCP: List Servers**, select `studium` and start it. Its log shows errors.

VS Code uses `servers`, not the `mcpServers` key of Claude Code and Cursor. Reference:
[MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## What you get

**MCP: List Servers** shows **Studium** (from the extension) or `studium` (added by hand) running. To prove
the connection, run the check in [Connect your assistant](harnesses.md#check-the-connection), then ask
"I want to learn … with Studium" and name your sources.

## Limits

- The built-in server has not been tried in a real VS Code session with Copilot. What was checked: the
  extension's tests, against a stand-in for VS Code, register it, start the server it describes and read
  its lessons folder and data folder back; and VS Code 1.139's own runtime, with no Node on the path,
  started the bundled server, listed its 40 tools and wrote a source set to the library.
- VS Code's documentation says that eligible server definitions from extensions can be forwarded to Copilot
  sessions; whether Copilot's own agent sessions receive this one has not been checked.
- Editors without this interface (VS Code before 1.101, and possibly Cursor or other forks, not tried) get
  no built-in server; the output channel says so. Add the server by hand there.
- The lesson pane starts its own server. Copilot and the pane do not share the current step: drive a lesson
  from one of them at a time. The built-in server keeps progress in the same folder as the pane, under the
  learner id Copilot gives (`anonymous` by default), so the pane's reviews do not count it.
- **Studium: Forget my data** closes the servers the extension started for the pane, the chat and the
  notebook, not the one VS Code started for Copilot. Stop **Studium** in **MCP: List Servers** first.
- Plans, models and limits are set by GitHub and change over time.
