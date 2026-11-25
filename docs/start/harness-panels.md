English · [Français](harness-panels.fr.md)

# Lesson panels in your assistant

Studium can show a lesson in a panel next to the conversation, with the lesson text, the answer controls, the feedback, your review dates and the completion screen. This page says where a panel appears and how to open one. Developers who check a host or add one use [Lesson panels for developers](../develop/panels.md).

## Where a panel appears

| Where you work | What you see | How it has been tested |
|---|---|---|
| VS Code with the Studium extension | A pane | Automated tests of the pane |
| Codex Desktop with MCP Apps support | A panel | Automated handshake and action test; not yet tried in the application |
| Claude Code (terminal, Code tab, extension) | A native pane from the Claude Code mod in `apps/claude-code-mod` (a mod is an add-on for Claude Code) | Automated tests of the mod; not yet tried in the application |
| claude.ai or Claude Desktop, as a remote connector | A panel over Streamable HTTP | Not offered: the remote service and its exposure are the owner's decision |
| An assistant that shows text only | The conversation | The panel tools exist but no panel is drawn |

The same renderer draws the panel in VS Code and in MCP Apps. The Claude Code mod shows the same lesson view with native components. No panel has been tried in the real Codex Desktop or Claude applications yet.

## Before you start

- Install and connect the Studium server as in [Connect your assistant](harnesses.md). Its server file `apps/studium-vscode/dist/lesson-mcp.cjs` carries the panels.
- After an update, build it again with `./setup.sh`, or only the server with `pnpm --filter studium-vscode build`.

## Open a lesson in a panel

1. Ask your assistant to open the lesson in a panel. The assistant calls `open_lesson_panel`.
2. Studium picks the best surface your client can draw and says which in the view it returns (`surface`: `rank`, `kind` and the kinds `available`).
3. Answer in the panel. While it is open, the assistant waits for you.

## Where a lesson is offered first

When a lesson is ready to play (one the assistant has just built, or the one the study plan says to start or continue), Studium offers it on the surfaces your assistant and its server give, in this order:

1. The surface your assistant draws itself: the Claude Code mod's pane, once the mod has opened a lesson in this session, for the learner the server plays by default (the one `/studium` opens lessons for); Studium's panel, when the client announces `io.modelcontextprotocol/ui` (the assistant then opens it with `open_lesson_panel`); the VS Code pane, on the Studium extension's server.
2. The [browser player](browser.md#from-your-assistant), when no VS Code extension serves Studium.
3. The conversation: say "here".

Studium then follows your choice, without asking. It notes where you last answered a step (the browser, the VS Code pane, a panel, the Claude Code pane, or the conversation, forms included), and the next offer puts that surface first when your assistant gives it; otherwise the order above applies. When you last answered in the conversation, the offer says the lesson goes on here and gives one link to the faster surface. The note is kept with your progress and erased with it ([Privacy and limits](../concepts/privacy-and-limits.md)).

A lesson the assistant starts in the conversation ends its first step, and its first step after a resume, with one line that names the faster surface, such as _For immediate answers, follow it in your web browser: <address>_. Later steps do not carry it, and no step does when you last answered in the conversation.

| Where you work | Offered first |
|---|---|
| Codex Desktop, or another client that announces MCP Apps | the panel, then the browser |
| VS Code, with Copilot and Studium added by hand | the browser: VS Code 1.139 announces MCP Apps, but the panel inside Copilot waits for a trial |
| VS Code with the Studium extension | the Studium pane |
| OpenCode (1.19.6 announces no MCP Apps), Mistral Vibe | the browser |
| Claude Code with the mod | the browser, then the mod's pane (`/studium <lesson>`) once the mod has opened a lesson in this session, for the default learner |

Claude Code gives the server no sign of the mod: the same name and capabilities with it or without it, and the mod calls the server only when you type `/studium`. Hence the browser first until then. Studium takes a pane asked for by Claude Code's client (named `claude-code`) for the mod, and forgets it when that lesson is taken back to the conversation; a pane asked for by any other client is not counted, since a model with no pane may ask for one before it plays in the conversation. This order has automated tests only; it has not been tried in Codex Desktop, Copilot or Claude Code.

## The surface a lesson plays on

| Rank | Surface | Studium uses it when |
|---|---|---|
| 3 | `panel`, an MCP Apps panel | the client announces `io.modelcontextprotocol/ui` |
| 3 | `pane`, a native pane | the client asks for `surface: "pane"` (the Claude Code mod and the VS Code extension do) |
| 2 | `form`, forms the client shows | the client declares elicitation |
| 1 | `text`, the conversation | always |

To stay in the conversation, ask for `surface: "text"`. A surface the client cannot draw falls to the best one below it. At ranks 2 and 1, the summary written for the model says how to continue: `play_in_forms`, or relaying the text of `get_current_scene`. `get_panel_view` takes the same `surface` field; without it, a session keeps the surface it was opened on.

## What the MCP panel offers

- A course selector, and an erasure of your data after an explicit confirmation.
- A graph of the neighbourhood of your current concept; selecting a node shows its label locally.
- For a capsule reproduction, a message that the VS Code terminal is needed.

## Limits

- Studium opens no public endpoint and installs no connector. The remote-connector route is not available to users.
- The panels have automated checks only, as the table says.
