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
[browser player](browser.md#from-your-assistant), on your computer, where each step answers at once; say
"here" to play it in the chat instead. The address lives as long as the OpenCode session, and plays the
learner id OpenCode passed. Your answers there are checked by Studium on your computer and do not go to
the model, as long as no judge model is configured. `STUDIUM_BROWSER_PLAYER=off` in `environment` turns
this off. Not yet tried with OpenCode itself: only scripts have checked it.

## Limits

- One run supports the 1.x configuration and the Mistral model: OpenCode 1.19.6 on macOS, 25 November 2026,
  with `mistral/mistral-large-4` through `opencode run`, the command-line form. Asked where to start with an
  empty library, it showed the first step of the demo lesson shipped with Studium in 23 seconds; it built a
  lesson of 9 steps from course notes of about 2,400 characters, named by path, in 3 minutes 4 seconds. The web
  interface was started and its page answered, but no lesson was played in it. The v2 configuration above was
  not run that day.
- Older OpenCode versions use another configuration shape.
- An open model offered by your provider is neither free, local nor equal in quality by default.
