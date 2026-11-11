English · [Français](claude-code.fr.md)

# Connect Claude Code to Studium

Add Studium to Claude Code with the plugin or as a server alone, play lessons with the lesson agent, and
show where the lesson stands in the status line.

## Before you start

- Read [Connect your assistant](harnesses.md): it explains the two ways to start the server,
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`. The plugin and the `npx` form need only Node;
  the checkout form needs the [installation from a checkout](installation.md#install-from-a-checkout).
- Install and sign in to Claude Code following the [Claude Code setup](https://code.claude.com/docs/en/setup).

## Do the task

### Install the plugin

The plugin is the recommended route. It brings the server (started with `npx -y studium-mcp`), the twelve
skills of `skills/` and the two lesson agents in one step. With Claude Code 2.1.275 or later:

```bash
claude plugin install studium --marketplace HolobiomicsLab/studium
```

Inside a session: `/plugin install studium --marketplace HolobiomicsLab/studium`. The same in two steps:

```bash
claude plugin marketplace add HolobiomicsLab/studium
claude plugin install studium@holobiomicslab
```

| Task | Command |
|---|---|
| Update | `claude plugin marketplace update holobiomicslab`, then `claude plugin update studium@holobiomicslab` |
| Remove | `claude plugin uninstall studium@holobiomicslab` |

According to the Claude Code plugin documentation, a plugin's skills and agents carry the plugin's name:
the skills are invoked as `/studium:<skill-name>` (for example `/studium:studium-harness`), and the agents
are named `studium:studium-lesson` and `studium:studium-explainer`. If the plugin cannot be installed yet,
see [If a package is not published yet](installation.md#if-a-package-is-not-published-yet).

### Add the server only

Skip this step if you installed the plugin: it already declares the server.

**With `npx`** (no checkout), for every project of your user account:

```bash
claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp
claude mcp list
```

**From a checkout**, for that project only:

1. From your checkout, run:

   ```bash
   claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   claude mcp list
   ```

2. `--scope project` writes `.mcp.json` at the project root; its shape is:

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

3. Inside a session, `/mcp` shows the connection. For a non-interactive run, pass the configuration file and
   allow the Studium tools explicitly:

   ```bash
   claude -p --mcp-config .mcp.json --strict-mcp-config \
     --allowedTools "mcp__studium__*" --permission-mode dontAsk --max-budget-usd 2 \
     "Call get_server_info, then get_study_plan, and show me the result."
   ```

### Use the lesson agent

The plugin installs two agents; a checkout also has their definitions in `.claude/agents/`.
`studium-lesson` plays a lesson or a review as a strict relay on the fast model: it shows each screen as Studium wrote it, sends your words, and adds
nothing. `studium-explainer` is a stronger model it calls when your question needs a real explanation; the
lesson goes on while the explanation is written; its text opens with « Generated explanation », so that
you can tell it from the lesson's. The lesson agent opens a lesson on the best surface your client shows (a
panel or a pane, forms, or the conversation), and when you come back to it after playing there, it first
reads what you did, so that it does not show you a screen again. A client that renders MCP Apps may show
the panel even when the lesson is played in the conversation or in forms: the panel then says so (« This
lesson is played in the conversation », « The panel is not the surface negotiated for this session. ») and
draws no scene and no answer control, so you answer where the lesson is played. Its « Play here » button,
shown when your client can render the panel, asks the server to move the session to the panel.

With the plugin:

```bash
claude --agent studium:studium-lesson
```

From the checkout:

```bash
claude --agent studium-lesson
```

Without the plugin, to use them from any folder, link them into your user agents once:

```bash
mkdir -p ~/.claude/agents
ln -s "$PWD/.claude/agents/studium-lesson.md" "$PWD/.claude/agents/studium-explainer.md" ~/.claude/agents/
```

In a folder you only use to study, `{"agent": "studium-lesson"}` in `.claude/settings.json` makes every
session there a lesson session (`studium:studium-lesson` with the plugin). In a session that is already open, `/model haiku` for the time of the lesson
gives most of the same gain. Do not ask a large model to hand each answer to the agent (see
[Keep answers fast](fast-answers.md)).

### Show the status line

The status line needs a checkout: the script is a file of the repository, and neither the plugin nor the
npm package ships it.

In durable mode, Studium notes where the lesson stands in `status.json`, in your learner folder, at each
screen and each answer. The script `tools/studium_statusline.mjs` prints its line, the one each screen ends
with:

```text
Les atomes · étape 2/3 · 3 min · à toi de répondre
```

The line holds 80 characters at most. A long lesson title is cut before its last separator that fits
("Atomistique L1 — Chapitre 1 (atomes, orbitales)" reads "Atomistique L1 — Chapitre 1"), so it does not
change from one screen to the next. While you answer the check questions of a concept you contested, the step
gives way to "check 1/2" ("contrôle 1/2" in a French lesson).

To show it in Claude Code's status line, add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/studium/tools/studium_statusline.mjs"
  }
}
```

The script needs no install and prints nothing when no lesson is being played: the session was closed, the
server stopped, or progress is kept in memory only (`STUDIUM_EPHEMERAL=1`), where nothing is written. It
finds the data folder as the server does (`STUDIUM_DATA_DIR`, else `<STUDIUM_HOME>/data`); `--data-dir=DIR`
names another. If you gave the server `STUDIUM_DATA_DIR` or `STUDIUM_HOME` in `.mcp.json`, give the script
the same. With several lessons open on one machine, it shows the one that moved last, in every Claude Code
window.

## What you get

Inside a session, `/mcp` shows the Studium server; `claude mcp list` shows `studium` when you added it with
`claude mcp add`. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

## Limits

This configures Claude Code, not the Claude desktop app; for the app, see
[Claude Desktop](harnesses.md#claude-desktop).
