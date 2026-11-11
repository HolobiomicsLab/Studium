# studium-mcp

The Studium lesson server for AI assistants. Studium turns sources you trust into lessons you answer
yourself: the assistant shows each question and relays your words, and Studium checks them against the
author's key, adapts what comes next and brings each concept back on later days. Every answer says who
wrote the key and whether anything assessed it.

This package is the server alone, as one file with no dependency. Any assistant that speaks the Model
Context Protocol (MCP) starts it over stdio: Claude Code, Codex, GitHub Copilot in VS Code, Cursor,
OpenCode, Claude Desktop. It calls no model by default and keeps your lessons and progress on your
machine.

Studium is a research prototype. Documentation, in English and French:
<https://github.com/HolobiomicsLab/studium/blob/main/docs/index.md>.

## Add it to your assistant

You need Node 20 or later. Nothing else to install: `npx` fetches the server the first time.

| Assistant | Command or file |
|---|---|
| Claude Code | `claude mcp add --scope user studium -- npx -y studium-mcp` |
| Codex | `codex mcp add studium -- npx -y studium-mcp` |
| VS Code (Copilot) | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"]}'` |
| Cursor | in `~/.cursor/mcp.json`, the JSON below |
| Claude Desktop | in `claude_desktop_config.json`, the JSON below |
| OpenCode | in `opencode.jsonc`, under `mcp.servers`: `"studium": {"type": "local", "command": ["npx", "-y", "studium-mcp"]}` |

```json
{
  "mcpServers": {
    "studium": { "command": "npx", "args": ["-y", "studium-mcp"] }
  }
}
```

If your shell already defines `LITELLM_BASE_URL` for another tool, give the server an empty one so that
Studium calls no model: `-e LITELLM_BASE_URL=` in Claude Code, `--env LITELLM_BASE_URL=` in Codex,
`"env": {"LITELLM_BASE_URL": ""}` in a JSON configuration.

Each assistant has its own page, with how to check the connection:
[Connect your assistant](https://github.com/HolobiomicsLab/studium/blob/main/docs/start/harnesses.md).
In Claude Code, the Studium plugin adds the server, the skills and two lesson agents in one step; see
[Installation](https://github.com/HolobiomicsLab/studium/blob/main/docs/start/installation.md).

To see what you have:

```bash
npx -y studium-mcp --version
npx -y studium-mcp --help
```

## First use

Ask your assistant, in your own words:

```text
I want to learn how binary search works, with Studium. Here is the page I trust: <link>.
```

The assistant fetches the page, drafts a short lesson from it, and Studium checks every quote before the
lesson is played. You answer; the assistant relays. On a later day:

```text
What should I review today with Studium?
```

Clients that support MCP prompts also offer `learn` and `review`. A lesson a teacher gave you (a folder
holding `lesson.json`) is played from the folder named by `BUNDLES_ROOT`.

## What it keeps, and where

| What | Default | Variable |
|---|---|---|
| Lessons built for you | `~/.studium/library` | `STUDIUM_HOME` |
| Progress and reviews | `~/.studium/data` | `STUDIUM_DATA_DIR` |
| A folder of lessons looked up first | none | `BUNDLES_ROOT` |
| Keep everything in memory, write nothing | off | `STUDIUM_EPHEMERAL=1` |
| The learner id when a call names none | `anonymous` | `STUDIUM_LEARNER_ID` |
| A judge model for written answers | none | `LITELLM_BASE_URL` |

Nothing leaves your machine unless you set `LITELLM_BASE_URL`: that route calls a model you pay for.
Without it, written answers are recorded and you rate your own recall against the reference.
[Privacy and limits](https://github.com/HolobiomicsLab/studium/blob/main/docs/concepts/privacy-and-limits.md)
says what is stored and how to erase it.

## What it offers

40 tools, two prompts and server instructions that tell the assistant to wait for your own answers:
play a lesson, review over days, build a lesson from sources you chose, show the concept map, and, for
teachers, review a lesson draft and read a class report. The full list is in the
[MCP tools reference](https://github.com/HolobiomicsLab/studium/blob/main/docs/reference/mcp-tools.md).

The VS Code extension ships this same server with a lesson panel. Teachers who prepare and approve
courses use the tools of the repository:
[Teacher guide](https://github.com/HolobiomicsLab/studium/blob/main/docs/teach/teacher-guide.md).

## Report a problem

When Studium fails or cannot do what you need, your assistant is told to say so and to help you report
it. You can also open an issue yourself:
<https://github.com/HolobiomicsLab/studium/issues/new/choose>. What a report holds and leaves out:
[Report a problem or contribute](https://github.com/HolobiomicsLab/studium/blob/main/docs/start/report-and-contribute.md).

## Licence

Apache-2.0. Developed by the [HolobiomicsLab](https://holobiomicslab.cnrs.fr/), eDIAM team, Institut de
Chimie de Nice, Université Côte d'Azur and CNRS.
