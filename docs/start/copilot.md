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
4. The first time Copilot calls a Studium tool, VS Code asks you to allow it. Open the arrow next to
   **Allow Once** and choose **Allow Tools from Studium in this Session**, or **Always Allow Tools from Studium**
   if you will come back. Otherwise VS Code asks again at each tool, and a lesson being built or played waits
   for your click. These are the labels of VS Code 1.139; a server you added by hand is named `studium`.

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
3. At the first tool call, allow the server's tools for the session, as in step 4 above.

VS Code uses `servers`, not the `mcpServers` key of Claude Code and Cursor. Reference:
[MCP servers in VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## What you get

**MCP: List Servers** shows **Studium** (from the extension) or `studium` (added by hand) running. To prove
the connection, run the check in [Connect your assistant](harnesses.md#check-the-connection), then ask
"I want to learn … with Studium" and name your sources.

Building the lesson takes a few minutes; it is done once, and you can then play the lesson as often as you
want. With the Studium extension installed, VS Code shows where the build is:

| When | What VS Code shows |
|---|---|
| The assistant has prepared its sources | the status bar says **Studium · preparing a lesson…**; its tooltip names the source and says to answer the assistant in the chat if it asks to allow a step |
| The lesson is written to your library | **Studium: your lesson “…” is ready (n steps).** with **Open**, **Later** and **Don't show again** (it turns off the `studium.notifyLessonReady` setting); the lesson appears in the **Lessons** view. If you were in another window, the notice waits until you come back to VS Code |

Meanwhile, you can try the demo lesson (**Studium: Try the demo lesson**). The extension watches your
library, `~/.studium/library` (or `<STUDIUM_HOME>/library`), the folder the Studium server writes lessons to;
it creates that folder at startup if it is missing. **Open** plays the lesson in the pane and changes no
setting.

With the server from the extension, Copilot then offers the lesson in the Studium pane first: its message
ends with **Open it in the Studium pane**, a link that opens the lesson in the pane, where each step answers
at once. The first time, VS Code asks whether Studium may open the link. Say "here" instead to play the
lesson in the chat. When you ask Copilot what to study next, the lesson to start or continue comes with the
same link. In VS Code before about 1.120 the link shows as text: open the lesson from the **Lessons** view.

## Limits

- The built-in server has not been tried in a real VS Code session with Copilot. What was checked: the
  extension's tests, against a stand-in for VS Code, register it, start the server it describes and read
  its lessons folder and data folder back; and VS Code 1.139's own runtime, with no Node on the path,
  started the bundled server, listed its 40 tools and wrote a source set to the library.
- VS Code's documentation says that eligible server definitions from extensions can be forwarded to Copilot
  sessions; whether Copilot's own agent sessions receive this one has not been checked.
- Editors without this interface (VS Code before 1.101, and possibly Cursor or other forks, not tried) get
  no built-in server; the output channel says so. Add the server by hand there.
- Copilot and the pane play the same learner, the `studium.learnerId` setting (`vscode-learner` by default),
  and keep progress in the same folder: a lesson started in one goes on in the other at the step you reached,
  and reviews done in the chat show in the status bar at its next refresh. They do not follow each other
  live: finish or close the lesson in one before going on in the other. An answer given in the chat after you
  went on in the pane is refused rather than saved over your progress, and Copilot starts the lesson again
  where you are. After changing `studium.learnerId`, restart **Studium** in **MCP: List Servers**.
- Progress Copilot kept before this version, under the learner id it chose (`anonymous` by default), stays
  under that id: it is not moved to the pane's learner.
- A Studium server added by hand gets neither the pane's learner nor the pane's link: it offers its
  [browser player](browser.md#from-your-assistant) instead. Remove that entry to use the built-in server, or set `STUDIUM_LEARNER_ID` and `STUDIUM_OPEN_LINK`
  (`vscode://holobiomicslab.studium-vscode/open?bundle=`) in its `env`.
- The link and the shared learner were checked against a stand-in for VS Code: Copilot's link, handed over
  the way VS Code's own code does, opens the pane at the learner's step. Clicking it in a real Copilot chat
  has not been tried.
- **Studium: Forget my data** closes the servers the extension started for the pane, the chat and the
  notebook, not the one VS Code started for Copilot. Stop **Studium** in **MCP: List Servers** first.
- The preparing state and the ready notice were checked against a stand-in for VS Code, with the real server
  writing the files. Whether VS Code reports the writes in `~/.studium/library` when that folder is not open
  in the window has not been seen in a real session. Without a notice, the **Lessons** view is read again when
  you show it or come back to the window.
- The preparing state ends when the lesson built from those sources arrives, or after 20 minutes. If the
  assistant has stopped, the lesson may not come.
- Plans, models and limits are set by GitHub and change over time.
