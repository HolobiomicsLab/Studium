English · [Français](claude-code.fr.md)

# Connect Claude Code to Studium

Add the Studium server to Claude Code, play lessons with the lesson agent, and show where the lesson stands
in the status line.

## Before you start

- Finish the [installation](installation.md) and read [Connect your assistant](harnesses.md): it explains
  `/path/to/studium`, `BUNDLES_ROOT` and `LITELLM_BASE_URL`.
- Install and sign in to Claude Code following the [Claude Code setup](https://code.claude.com/docs/en/setup).

## Do the task

### Add the server

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

The repository ships two agent definitions in `.claude/agents/`. `studium-lesson` plays a lesson or a review
as a strict relay on the fast model: it shows each screen as Studium wrote it, sends your words, and adds
nothing. `studium-explainer` is a stronger model it calls when your question needs a real explanation; the
lesson goes on while the explanation is written; its text opens with « Generated explanation », so that
you can tell it from the lesson's. The lesson agent opens a lesson on the best surface your client shows (a
panel or a pane, forms, or the conversation), and when you come back to it after playing there, it first
reads what you did, so that it does not show you a screen again. A client that renders MCP Apps may show
the panel even when the lesson is played in the conversation or in forms: the panel then says so (« This
lesson is played in the conversation », « The panel is not the surface negotiated for this session. ») and
draws no scene and no answer control, so you answer where the lesson is played. Its « Play here » button,
shown when your client can render the panel, asks the server to move the session to the panel. From the
checkout:

```bash
claude --agent studium-lesson
```

To use them from any folder, link them into your user agents once:

```bash
mkdir -p ~/.claude/agents
ln -s "$PWD/.claude/agents/studium-lesson.md" "$PWD/.claude/agents/studium-explainer.md" ~/.claude/agents/
```

In a folder you only use to study, `{"agent": "studium-lesson"}` in `.claude/settings.json` makes every
session there a lesson session. In a session that is already open, `/model haiku` for the time of the lesson
gives most of the same gain. Do not ask a large model to hand each answer to the agent (see
[Keep answers fast](fast-answers.md)).

### Show the status line

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

`claude mcp list` and `/mcp` show `studium`. To prove the connection, run the check in
[Connect your assistant](harnesses.md#check-the-connection).

## Limits

This configures Claude Code, not the Claude desktop app.
