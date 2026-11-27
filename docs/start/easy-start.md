English · [Français](easy-start.fr.md)

# Start without a terminal

The shortest way into Studium for someone who does not use a terminal: VS Code, one extension, and the AI
assistant you already use. No command line and no Node. Allow about twenty minutes, including the demo
lesson.

## Before you start

| You need | Why |
|---|---|
| [VS Code](https://code.visualstudio.com/) 1.95 or later (1.101 or later for Copilot) | it shows the lessons and connects your assistant |
| An AI assistant you can already use: Copilot in VS Code, Claude Code, Codex, Mistral Vibe, Claude Desktop, Cursor or OpenCode | it builds lessons from your sources, with your own account; Studium has no account and calls no model |

The demo lesson, and any lesson someone already made, play with no assistant and no account.

## 1. Install the extension

In VS Code, open the Extensions view (the icon with four squares on the left, or `Cmd+Shift+X` on macOS,
`Ctrl+Shift+X` elsewhere), search for **Studium** and choose **Install** on the extension published by
HolobiomicsLab. A **Studium** icon appears in the activity bar.

If Studium was already installed: version 0.6.6 did not start, and every Studium command answered
« command 'studium.…' not found ». Update the extension to 0.6.8 or later, then run **Developer: Reload
Window** from the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).

## 2. Try « Discover Studium »

Select the **Studium** icon, then **Discover Studium**. This lesson ships with the extension: about twelve
minutes, in English or French, with no AI account. You learn Studium by using it (a quiz with its confidence
scale, a hint, a written answer compared with a reference, the concept map), and you see where else Studium
plugs in and what it offers students and teachers. The progress bar takes you back to a step you already
did. An AI agent drafted this lesson from Studium's documentation; the project's owner approved it, under the
name beta-testeur, without reading it.

## 3. Connect your assistant

| Your assistant | What to do |
|---|---|
| Copilot in VS Code, agent mode | nothing: the extension gives it the Studium server. At its first Studium tool, open the arrow next to **Allow Once** and choose **Always Allow Tools from Studium** |
| Claude Code, Codex or Mistral Vibe (their VS Code extension, app or command line), Claude Desktop, Cursor, OpenCode | in the Studium view, select **Connect an assistant**, or run **Studium: Connect an Assistant…** from the Command Palette; tick your assistant, then confirm |

Then restart the assistant: reload the VS Code window for one that runs inside VS Code (the notification has a
**Reload Window** button); quit and reopen
Claude Desktop, Cursor or OpenCode; start a new session of a command-line assistant. The next time you open
the list, your assistant is marked « connected ».

The command writes one `studium` entry into the assistant's own configuration file and keeps a backup next to
it. That entry starts the server inside the extension, run by VS Code's own program: this is why no Node is
needed. If the assistant already had a Studium server under another name, VS Code says so: keep one of the
two, or the assistant lists each Studium tool twice. Each assistant has its own page under
[Connect your assistant](harnesses.md).

## 4. Ask for a lesson

In a new conversation with your assistant, in your own words:

> I want to learn how the water cycle works with Studium. Use these two pages: (two links you trust).

The assistant shows you an outline, then builds the lesson. Building takes a few minutes, once: the status
bar says **Studium · preparing a lesson…**, VS Code tells you when the lesson is ready, and it appears in the
**Lessons** view. Play it there or in the conversation; the steps are in
[Learn with your assistant](../learn/learn-with-your-assistant.md).

## Check that it works

Ask your assistant:

> Call the Studium tool get_server_info and tell me the version and the number of tools.

It should answer with a version, 0.6.8 or later, and 40 tools. If the assistant does not know the tool, see
[Troubleshooting](troubleshooting.md#connecting-an-assistant).

## Without VS Code: Claude Desktop

Download `studium-vX.Y.Z.mcpb` from the
[latest release](https://github.com/HolobiomicsLab/Studium/releases/latest), double-click it and choose
**Install** in Claude Desktop, which runs it with the Node it ships. The bundle carries « Discover Studium »;
then ask Claude « I want to learn X with Studium ». Each release checks the bundle's manifest and the server it
starts; installing it in Claude Desktop itself has not been tried yet.

## When you need Node

Only for these routes, each described on its own page:

- connecting an assistant from a terminal with `npx -y studium-mcp` ([Installation](installation.md#add-the-server-to-your-assistant));
- the Claude Code plugin, which also brings the skills ([Connect Claude Code](claude-code.md));
- the [browser player](browser.md), which plays a lesson in a web browser;
- preparing and approving courses from a checkout ([Quickstart](quickstart.md)).

## Limits

- **Studium: Connect an Assistant…** connects assistants on this computer only, not from a remote window
  (SSH, container, Codespaces).
- The entry names VS Code's program and the extension's folder. After an update of the extension, open VS Code
  once: it updates the entries it wrote. If you uninstall VS Code, connect your assistant another way.
