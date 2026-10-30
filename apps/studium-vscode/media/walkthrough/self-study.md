# Learn a topic with your assistant

You do not need to write a lesson yourself.

1. In Codex or Claude Code, with the Studium MCP server connected, say **"I want to learn X with Studium"**.
2. Your assistant gathers sources on X and builds a lesson from them. Every question cites the passage it
   comes from, and the lesson is saved in your personal library, `~/.studium/library`.
3. Open it here:
   - right-click its `lesson.json` in the explorer and choose **Studium: Open this lesson**, or
   - follow the `vscode://holobiomicslab.studium-vscode/open?bundle=<path of lesson.json>` link your
     assistant gives you (it can run `code --open-url` for you), or
   - run **Studium: Pick a course**.

If you close VS Code in the middle of a lesson, the pane comes back when you reopen the window and
resumes where you stopped.

> The lesson was written by the AI from your sources and has not been checked by a teacher. Studium says
> so at the top of the first scene. If an answer key looks wrong, say so: you are meant to challenge it.
