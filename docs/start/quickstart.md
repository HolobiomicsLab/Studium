English · [Français](quickstart.fr.md)

# Quickstart

In about fifteen minutes you can ask an AI assistant to teach you a topic from sources you choose, answer
the first question of a lesson built for you, and come back days later to review what you are about to
forget. This page takes the shortest path. Each step links to the page with the details.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/self-learner-journey-dark.svg">
  <img src="../assets/diagrams/self-learner-journey-light.svg" alt="Self-learner journey: a request in an AI assistant, references and their licences, exact passages, an agent-drafted lesson, an outline review, play with the authoring notice visible, then reviews when concepts fall due.">
</picture>

## What you need

| Item | Why |
|---|---|
| Node 22 (20 at least) and pnpm 9.15.9 | build and run the Studium server |
| Git, with access to the repository | the repository is private for now |
| An AI assistant that speaks MCP: Codex, Claude Code, Copilot in VS Code, OpenCode or Cursor | it relays the lesson to you |
| VS Code (optional) | the lesson pane with figures, equations and reviews |

No model API key is needed by Studium itself. Your assistant keeps its own account and terms.
MCP (Model Context Protocol) is the standard way an assistant calls outside tools; see the
[glossary](../concepts/glossary.md).

## 1. Install and build

```bash
gh auth login                      # once: the repository is private
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
./setup.sh
```

`setup.sh` installs the workspace, builds the libraries and the VS Code extension, and checks the result.
It produces `apps/studium-vscode/dist/lesson-mcp.cjs`, the Studium server your assistant will start. Details
and the manual equivalent: [Installation](installation.md).

## 2. Connect your assistant

Register the server once. With Claude Code, from the checkout:

```bash
claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
claude mcp list
```

With Codex:

```bash
codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
codex mcp list
```

`LITELLM_BASE_URL=` (empty) tells Studium to use no judge model, even if your shell defines one; step 3 relies on it. Copilot, OpenCode and Cursor have their own pages, listed in [Connect your assistant](harnesses.md); the direct HTTP API is in the [HTTP API reference](../reference/http-api.md).
Without further settings the server keeps your lessons in `~/.studium/library` and your progress in
`~/.studium/data`, so it survives a restart.

## 3. Ask to learn something

Open a new conversation in your assistant and write, in your own words:

```text
I want to learn how a hash table handles collisions with Studium.
```

Clients that support MCP prompts also offer the server's `learn` prompt. The assistant then:

1. reads your study plan (`get_study_plan`), which says what to do next;
2. asks you for sources (a web page, a PDF, notes) if no lesson covers the topic yet;
3. builds a lesson from them (`get_authoring_guide`, `prepare_sources`, `create_lesson`): every quote is
   checked character for character against your sources before the lesson is written;
4. starts it (`start_lesson_session`) and shows the first question.

The first screen says the lesson was drafted by an agent and not checked by a teacher. Answer in your own
words; the assistant sends your text (`submit_response`) and shows the feedback. Without a judge model,
open answers are not scored: you get the reference to compare with yourself. The full walk-through is the
tutorial [Learn a topic in a conversation](../tutorials/learn-a-topic-in-a-conversation.md).

## 4. Come back to review

A few days later, ask:

```text
What should I review today with Studium?
```

The assistant calls `get_study_plan`, then `start_review_session` to play every review that is due, across
your lessons. When you rate how well you recalled an answer (again, hard, good, easy), only the next review
date moves; your measured mastery does not. See [Review over time](../learn/review-over-time.md).

## Prefer a visual pane

To play the same lessons in VS Code, install the extension (see [VS Code](vscode.md)), then run
**Studium: Pick a course** or right-click a `lesson.json` and choose **Studium: Open this lesson**. Your
assistant can also hand a lesson over with a `vscode://` link.

## Next steps

| You are | Go to |
|---|---|
| A self-learner | [Learn with your assistant](../learn/learn-with-your-assistant.md) |
| A student given a course | [Student guide](../learn/student-guide.md) |
| A teacher | [Teacher guide](../teach/teacher-guide.md) |
| Stuck | [Troubleshooting](troubleshooting.md) |
