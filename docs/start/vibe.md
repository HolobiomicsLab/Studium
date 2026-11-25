English · [Français](vibe.fr.md)

# Connect Mistral Vibe to Studium

Add the Studium server to Mistral Vibe, the command-line assistant of Mistral AI, so that a Mistral model
builds and plays your lessons through Studium's tools.

## Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server
  (`npx -y studium-mcp`, or `node` on a file from a checkout or a release), `BUNDLES_ROOT` and
  `LITELLM_BASE_URL`. The `npx` form needs only Node; see [Installation](installation.md).
- Install Vibe and sign in following the [Mistral Vibe documentation](https://docs.mistral.ai/mistral-vibe/introduction).

## Do the task

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

## What you get

The check lists 40 tools. In the run described under Limits, Vibe read a file of course notes, built a
lesson of 8 steps on 4 concepts whose quotations Studium accepted at the first `create_lesson` call,
started it, relayed each step and passed a quiz answer to Studium, which graded it against the key. The
complete example is [vibe.toml](../examples/vibe.toml).

Since this run, a lesson ready to play is offered in your web browser first: Vibe shows the address of
Studium's [browser player](browser.md#from-your-assistant), on your computer, where each step answers at
once instead of waiting on the model; say "here" to play it in the chat. The address lives as long as the
Vibe session and plays the learner id Vibe passed. Your answers there are checked by Studium on your
computer and do not go to Mistral AI, as long as no judge model is configured. `STUDIUM_BROWSER_PLAYER=off`
in the server's `env` turns this off. Not yet tried with Vibe itself: only scripts have checked it.

## What leaves your machine

Studium itself sends nothing: lessons and progress stay in `~/.studium`. The assistant's model does
receive what it reads and relays: your sources, the lesson and your answers go to the provider of that
model, here Mistral AI, under the terms of your plan. Whether those terms suit your course material is for
you and your institution to decide; see [Privacy and limits](../concepts/privacy-and-limits.md).

## Limits

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
