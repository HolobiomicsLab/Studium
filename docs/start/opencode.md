English · [Français](opencode.fr.md)

# Connect OpenCode to Studium

Add the Studium server to OpenCode, so that OpenCode plays your lessons through Studium's tools.

## With the VS Code extension: one click, no Node

With the Studium extension for VS Code installed, you need no terminal and no Node:

1. In VS Code, run **Studium: Connect an Assistant…** from the Command Palette and tick **OpenCode** (the empty
   **Lessons** view has the link too).
2. Quit and restart OpenCode: its desktop app, `opencode` or `opencode web`.
3. Ask OpenCode: "I want to learn … with Studium", naming your sources.

The command writes one `studium` entry into `~/.config/opencode/opencode.json` (or `opencode.jsonc`, under `$XDG_CONFIG_HOME` when it is set), under `mcp`, or `mcp.servers` when the file already nests its servers that way, and nothing else; the previous file is kept beside it as
`<file>.studium-backup`. The entry runs the Studium server the extension carries, with VS Code's own executable, and
uses the same lessons folder, progress and learner as the Studium pane. When OpenCode runs inside VS Code, a lesson is
offered in the Studium pane and opens there by itself when it is ready; elsewhere, in your
[browser](browser.md#from-your-assistant). A `studium` entry you wrote yourself is replaced only if you say yes. Each
Studium update rewrites the entry; **Studium: Disconnect an Assistant…** removes it, and so does uninstalling the
extension, as far as VS Code runs its uninstall step.

Checked on 26 November 2026 on macOS: `opencode mcp list` (OpenCode 2.3.0) reported the server connected; the file keeps its comments. The desktop app and a conversation with this entry were not tried yet.

The sections below set the server up by hand.

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

   **OpenCode 1.x** (the version `npm` installs today, 1.19.6 on 25 November 2026) takes the server directly
   under `mcp`, in `opencode.json`:

   ```json
   {
     "mcp": {
       "studium": {
         "type": "local",
         "command": ["npx", "-y", "studium-mcp"],
         "environment": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

2. Run `opencode mcp list` to see the connection.

## In a web browser, with a Mistral model

OpenCode has a web interface: `opencode web` starts a server on your machine (127.0.0.1) and opens a
conversation page in your browser, with the Studium tools of the folder's configuration. It is a way to
build and play lessons without a terminal conversation and without VS Code.

1. Give OpenCode a model provider. For Mistral, set `MISTRAL_API_KEY` in your environment, then choose the
   model `mistral/mistral-large-4` (`opencode models mistral` lists the others).
2. In the folder that holds the configuration above, run `opencode web`. Set `OPENCODE_SERVER_PASSWORD`
   first: without it, OpenCode warns that its server is unsecured.
3. Ask "I am new to Studium, where do I start?" or "I want to learn … with Studium" and name a file of the
   folder as your source.

As with any assistant, what the model reads and relays goes to its provider, here Mistral AI, under the
terms of your plan; see [Connect Mistral Vibe](vibe.md#what-leaves-your-machine).

## What you get

`opencode mcp list` shows `studium`. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection). The complete example is
[opencode-v2.json](../examples/opencode-v2.json).

A lesson ready to play is offered in your web browser first: the assistant shows the address of Studium's
[browser player](browser.md#from-your-assistant), on your computer, where you answer each step without
going through the chat; say "here" to play it in the chat instead. The address lives as long as the OpenCode session, and plays the
learner the server plays (`STUDIUM_LEARNER_ID`, else `anonymous`). Your answers there are checked by Studium on your computer and do not go to
the model, as long as no judge model is configured. `STUDIUM_BROWSER_PLAYER=off` in `environment` turns
this off. Tried once in `opencode web` (see Limits).

OpenCode 1.19.6 announces no MCP Apps at connection, so the browser comes first. In a run of 25 November
2026, the model started a lesson in the chat at once, as asked, and relayed its first step without the
offer: a lesson started in the chat now ends its first step with one line that gives the address. When you
answered in the chat after that line, the next offer says the lesson plays in the chat and gives the
address once ([Where a lesson is offered first](harness-panels.md#where-a-lesson-is-offered-first)).

## Limits

- One run supports the 1.x configuration and the Mistral model: OpenCode 1.19.6 on macOS, 25 November 2026,
  with `mistral/mistral-large-4` through `opencode run`, the command-line form. Asked where to start with an
  empty library, it showed the first step of the demo lesson shipped with Studium in 23 seconds; it built a
  lesson of 9 steps from course notes of about 2,400 characters, named by path, in 3 minutes 4 seconds. The v2 configuration above was not run that day.
- One run of the web interface: OpenCode 1.19.6 on macOS, 26 November 2026, `opencode web` with
  `mistral/mistral-large-4`. The two requests were sent through the server's API, the one its page uses, and
  the page was read in a headless browser. Asked in French to learn from the same notes, named by path, the
  assistant announced the wait after 12 seconds, showed a sketch and built a lesson of 13 steps in 2 minutes
  45 seconds (one refusal, resent with only the scenes it named). Its last message gave the browser player's
  address, which the page showed as a link. Two steps answered in the browser, then "ici" in the chat: the chat
  resumed at step 3 of 13. Both messages together cost about 0.09 USD.
- Older OpenCode versions use another configuration shape.
- An open model offered by your provider is neither free, local nor equal in quality by default.
