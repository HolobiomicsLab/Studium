# Learn a topic with your assistant

You do not need to write a lesson yourself.

1. In your assistant (Copilot in agent mode, Codex or Claude Code), with the Studium server connected, say **"I want to learn X with Studium"**.
   Copilot in VS Code 1.101 or later gets the server from this extension, with no Node and no command in a
   terminal (run **MCP: List Servers** to see **Studium**). Codex and Claude Code need Node and one command.
2. In Copilot, the first time it calls a Studium tool, VS Code asks you to allow it. Open the arrow next to
   **Allow Once** and choose **Allow Tools from Studium in this Session**, or **Always Allow Tools from Studium**.
   Otherwise VS Code asks again at each tool, and the lesson waits for your click.
3. Your assistant gathers sources on X and builds a lesson from them. Every question cites the passage it
   comes from, and the lesson is saved in your personal library, `~/.studium/library`. Building it takes
   a few minutes; it is done once, and you can then play the lesson as often as you want. Meanwhile the
   status bar says **Studium · preparing a lesson…**, and you can try the demo lesson.
4. When the lesson is ready, VS Code tells you, with **Open**, and the lesson appears in the Lessons view.
   If you were in another window, the notice waits until you come back. You can also follow the
   `vscode://holobiomicslab.studium-vscode/open?bundle=<path of lesson.json>` link your assistant gives you, or
   run **Studium: Pick a course**.

If you close VS Code in the middle of a lesson, the pane comes back when you reopen the window and
resumes where you stopped.

> The lesson was written by the AI from your sources and has not been checked by a teacher. Studium says
> so at the top of the first scene. If an answer key looks wrong, say so: you are meant to challenge it.
