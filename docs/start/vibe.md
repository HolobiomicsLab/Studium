English · [Français](vibe.fr.md)

# Connect Mistral Vibe to Studium

Add the Studium server to Mistral Vibe, the assistant of Mistral AI (in VS Code, on the desktop or in a terminal), so
that a Mistral model builds and plays your lessons through Studium's tools.

## In VS Code or Vibe Desktop: one click, no Node

With the Studium extension for VS Code installed, you need no terminal and no Node:

1. In VS Code, run **Studium: Connect Mistral Vibe** from the Command Palette (when Vibe is installed, the extension
   also offers it once in a notification, and the empty **Lessons** view has the link).
2. Reload the VS Code window (the notice has a **Reload Window** button): the Vibe extension reads its configuration
   when it starts, and a new chat is not enough. Quit and restart Vibe Desktop too (Cmd+Q on macOS), if it is open.
3. Ask Vibe: "I want to learn … with Studium", naming your sources, for example a file of course notes. In VS Code,
   the lesson opens in the Studium pane by itself when it is ready.

The command writes one entry, `studium`, into Vibe's configuration (`~/.vibe/config.toml`, or `$VIBE_HOME/config.toml`)
and nothing else; the previous file is kept as `config.toml.studium-backup`. The entry runs the Studium server the
extension carries, with VS Code's own executable, so Node is not needed. It uses the same lessons folder, progress and
learner as the Studium pane: a lesson built with Vibe appears in the **Lessons** view. When Vibe runs inside VS Code,
the lesson is offered in the Studium pane; when it runs elsewhere (Vibe Desktop, Vibe in a terminal), in your
[browser](browser.md#from-your-assistant). If Vibe already has a `studium` entry you wrote yourself, the command asks
before replacing it. Each Studium update rewrites the entry (the server's path changes with the version);
**Studium: Disconnect Mistral Vibe** removes it, and uninstalling the extension removes it too, as far as VS Code runs
its uninstall step.

What was checked, on 26 November 2026 with Vibe 3.1.3 (command line, headless) and Mistral Large 4 on macOS: with the
entry the command writes, Vibe started the server, built a two-step lesson from a notes file in about 3.5 minutes and
gave the browser address; started from VS Code's executable, it gave the pane link. The same day, in the Vibe extension
for VS Code (1.30.0): after a window reload, Vibe saw Studium's 40 tools and built the lesson; its chat showed the
`vscode://` link as text rather than as a link, which is why the lesson now opens by itself. In a second run with that change, the lesson opened by itself as a tab of the editor area. Vibe Desktop 1.3.0, quit and
started again after the command, started the server from the same entry. On Windows the server cannot tell whether VS Code started it and always offers the browser. In a remote VS Code
window (SSH, WSL, containers) the command does not run.

## Vibe in a terminal, without the extension

### Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server
  (`npx -y studium-mcp`, or `node` on a file from a checkout or a release), `BUNDLES_ROOT` and
  `LITELLM_BASE_URL`. The `npx` form needs only Node; see [Installation](installation.md).
- Install Vibe and sign in following the [Mistral Vibe documentation](https://docs.mistral.ai/mistral-vibe/introduction).

### Do the task

1. Add the server to your Vibe configuration (`~/.vibe/config.toml`). **With `npx`** (no checkout):

   ```bash
   vibe mcp add studium --transport stdio --command npx --arg=-y --arg studium-mcp --env LITELLM_BASE_URL=
   ```

   The command writes this entry, which you can also add by hand:

   ```toml
   [[mcp_servers]]
   name = "studium"
   transport = "stdio"
   command = "npx"
   args = ["-y", "studium-mcp"]

   [mcp_servers.env]
   LITELLM_BASE_URL = ""
   ```

   **From a checkout**, use `command = "node"` and `args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

   To connect Studium in one folder only, put the same entry in `.vibe/config.toml` in that folder and
   start Vibe there; Vibe asks you to trust the folder first.

2. Start `vibe` and run the check in [Connect your assistant](harnesses.md#check-the-connection).
3. Ask: "I want to learn … with Studium", and name your sources, for example a file of course notes in
   the folder.

### What you get

The check lists 40 tools. In the run described under Limits, Vibe read a file of course notes, built a
lesson of 8 steps on 4 concepts whose quotations Studium accepted at the first `create_lesson` call,
started it, relayed each step and passed a quiz answer to Studium, which graded it against the key. The
complete example is [vibe.toml](../examples/vibe.toml).

Since this run, a lesson ready to play is offered in your web browser first: Vibe shows the address of
Studium's [browser player](browser.md#from-your-assistant), on your computer, where you answer each step
without going through the chat; say "here" to play it in the chat. The address lives as long as the
Vibe session and plays the learner the server plays (`STUDIUM_LEARNER_ID`, else `anonymous`). Your answers there are checked by Studium on your
computer and do not go to Mistral AI, as long as no judge model is configured. `STUDIUM_BROWSER_PLAYER=off`
in the server's `env` turns this off. Checked with Vibe 3.1.3 headless on 26 November 2026 (above): Vibe gave the address.

### What leaves your machine

Studium itself sends nothing: lessons and progress stay in `~/.studium`. The assistant's model does
receive what it reads and relays: your sources, the lesson and your answers go to the provider of that
model, here Mistral AI, under the terms of your plan. Whether those terms suit your course material is for
you and your institution to decide; see [Privacy and limits](../concepts/privacy-and-limits.md).

### Limits

- One run supports this page: Vibe 3.1.3 with the model Mistral Large 4 on macOS, `studium-mcp` 0.6.3,
  25 November 2026, in Vibe's headless mode (`vibe -p`), from French course notes of about 2,400
  characters. Building the lesson took about 6 minutes from the request to the first step; each later
  step took 23 to 28 seconds, a figure that includes restarting Vibe and the server at every headless
  call. Other models, longer sources and the interactive mode were not measured.
- No judge model was configured. Mistral's API has not been tried as a judge. Its chat endpoint follows
  the OpenAI format, so `LITELLM_BASE_URL` and `LITELLM_MODEL` should reach it for the audit steps, but
  the discussion steps send the fixed model name `studium/runtime-tutor`, which only a proxy can map
  to a Mistral model; see [Choose your model](models.md#the-judge-model). This was read, not run.
- Le Chat, Mistral's web and desktop assistant, has not been tried: Studium's server talks over stdio on
  your machine and is not offered as a remote connector.
- If the server does not appear the first time, `npx` may still be downloading the package: add
  `--startup-timeout-sec 60` to the command, or `startup_timeout_sec = 60` to the entry.
- [Lesson panels](harness-panels.md) were not tried in Vibe.
