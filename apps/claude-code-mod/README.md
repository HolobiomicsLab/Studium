# Studium panel for Claude Code

This Claude Code plugin adds a native Studium lesson pane backed by the `studium-lesson` MCP server. It registers `/studium` when a session starts and opens no UI until requested.

## Load the plugin

From the repository root, start Claude Code with the plugin directory:

```sh
claude --plugin-dir "$PWD/apps/claude-code-mod"
```

The same directory can be added to an existing `CLAUDE_CODE_PLUGIN_DIRS` value:

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$PWD/apps/claude-code-mod${CLAUDE_CODE_PLUGIN_DIRS:+:$CLAUDE_CODE_PLUGIN_DIRS}"
claude
```

The session must have an MCP server named `studium-lesson`. Open a lesson with `/studium <bundle_ref>`. Once a lesson is active, `/studium` resumes its pane. Scenes that need free text use `/studium answer <text>`; choice, hint, review, restart, self-rating, and erasure actions use pane buttons. Erasure requires two presses.

## Surfaces and content

The pane uses native Claude Code elements on terminal, desktop, VS Code, and mobile surfaces. It shows the lesson title and progress, scene Markdown, choices and available actions, feedback and hints, sources, completion summaries, and notice or error states. While an MCP action is pending, the current pane is dimmed. PNG assets render inline in the terminal, the only current surface with the native `Image` element; every surface still shows each asset's title and kind.

The browser HTML panel remains the richer visual renderer. The native pane preserves Markdown and code blocks, but leaves `$…$` equations as text and does not render KaTeX, Vega plots, interactive graphs, 3D content, or arbitrary HTML. It uses `/studium answer` for free-text and discussion turns because mobile and VS Code do not currently share a native input element. The plugin accepts the versioned `studium/panel-view/1` and `studium/panel-view/2` contracts and declines incompatible stored or MCP views.

For a version-2 view the pane also shows, in this order: the status line under the title (step, minutes left, reviews due, what is expected); a line over the scene that says who signs the lesson and whether a teacher read this version; a line over a verdict that says who assessed the answer (the author's key or a judge model); the help ladder, one button per rung (read again, hint, explanation, reference), where a closed rung is greyed and carries its reason and an open hint carries its cost; and « Ask a question », which sends the `ask` action. The server answers `ask` with a notice that sends the learner to the conversation; the lesson stays on the same step. An open explanation sends `ask` with the request « Explain this screen to me. ». Pressing a closed rung, or a rung that needs no server call, shows its note as a toast. After the ladder come the learner's settings, each only where the view offers its action: « Quiet », « Normal », « Coached » (`setAttention`; the view's `attention` is the primary button), FR and EN (`setLanguage`; the view's `locale` is the primary button), and a « Minutes available » field whose Enter sends `replan` with a whole number from 1 to 600 (anything else is refused in a toast and sends nothing). The mobile app draws no text field: there the pane names `/studium replan <minutes>`, which does the same from the prompt. A version-2 view whose `attention` is not one of the three levels is refused whole.

Where the view offers it, « Concept map » asks for the concept map (`openMap`). The pane then shows the map as a list under the controls: each concept with its state in words, what it needs first, a check under way or the last one's outcome, what the state establishes and what it does not, and the answers behind it (day, who assessed, result, hints). Under the list, one claim button per concept the server lets the learner contest sends `contest`, with a line that says how many check questions will follow; « Close the map » sends `closeMap`. The pane draws no graph. A scene view's `message` (what a contest's check showed) is shown over the controls. What the session proposes (`prompts`) comes after the controls: the reason of each proposal or notice, then one button per answer the view offers, each sending `prompt` with `accept` or `dismiss`. While an answer or a self-rating is owed, only notices are shown. A proposal the view gives no action for is shown as text only, and a view whose `prompts` are malformed is refused whole.

## Development checks

```sh
pnpm --filter @studium/claude-code-mod test
pnpm --filter @studium/claude-code-mod typecheck
claude plugin validate --strict apps/claude-code-mod
claude plugin test apps/claude-code-mod
```

The portable test suite mocks only the Claude host boundary and runs without the Claude CLI. The native plugin test remains an explicit host SDK gate.
