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

The browser HTML panel remains the richer visual renderer. The native pane preserves Markdown and code blocks, but leaves `$…$` equations as text and does not render KaTeX, Vega plots, interactive graphs, 3D content, or arbitrary HTML. It uses `/studium answer` for free-text and discussion turns because mobile and VS Code do not currently share a native input element. The plugin accepts only the versioned `studium/panel-view/1` contract and declines incompatible stored or MCP views.

## Development checks

```sh
pnpm --filter @studium/claude-code-mod test
pnpm --filter @studium/claude-code-mod typecheck
claude plugin validate --strict apps/claude-code-mod
claude plugin test apps/claude-code-mod
```

The portable test suite mocks only the Claude host boundary and runs without the Claude CLI. The native plugin test remains an explicit host SDK gate.
