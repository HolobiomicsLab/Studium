English · [Français](README.fr.md)

# Shared lesson panel

`@studium/lesson-panel` composes the same learner view for VS Code and other harnesses. It imports no VS Code, DOM or filesystem API. Images are read by an injected backend.

## Contract

`PanelViewSchema` and `PanelActionSchema` are Zod schemas with inferred TypeScript types. Views carry `schema: "studium/panel-view/2"`, session identity, public scene and ordered assets, locale and browser strings, progress, earned feedback, review cues, number-free calibration and completion. Mastery defaults to an empty object; when requested, unmeasured values remain null, matching the existing host rather than inventing a score. Explanation may be the existing structured explanation or text.

Version 2 adds, and retypes nothing: `orientation` (the step out of the total, the concept on screen, the minutes left, the reviews due, what is expected, why the lesson last adapted), `status_line` (the same in 80 characters at most), `voices` (who signs the lesson and whether it was reviewed; who assessed an answer), `help` (reread, hint, explanation, reference, each open or closed with its cost or reason), `prompts`, `attention` and `surface`. The backend computes the first four through `getOrientation` (see `packages/lesson-session-host/src/orientation.ts`); a backend without that method writes `studium/panel-view/1`, as does the notice of a forgotten session. `PanelViewSchema` reads both versions and refuses a version-2 view that lacks one of these fields.

The presenter calls the existing [publicScene projection](../lesson-session-host/src/public-scene.ts). Unexpected answer, correct, expected, key or solution fields in pre-answer scene content or assets are rejected recursively. Earned verdicts may carry correct after an answer. This validation is not a second redactor. Hints and turn results remain available when the host reads the view again.

## Backends and actions

`presentPanel(backend, ctx)` reads the current view. `applyPanelAction(backend, ctx, action)` validates and applies respond, turn, hint, rateRecall, reviewNow, restartLesson, end or pickCourse, and refuses an unknown or malformed action in one line. The host owns the mutable `PanelContext`: session identity, concept titles, modality and mastery options, review origins, earned transition and latest view. Serialize actions against that context. Review and restart can replace its session id; use the id returned in the view.

Four more actions, offered on a version-2 scene, change how the lesson is shown and never an answer:

| Action | Effect |
|---|---|
| `setLanguage {presentation_language}` | Shows the panel's own text (labels, status line) in French or English; a regional tag keeps its base language, `null` returns to the lesson's. The lesson's content stays in its own language: only the conversation translates it. The session notes the language asked for, whatever it is; for a language other than these two, the view says the panel has no text for it. |
| `setAttention {level}` | Sets `attention` to `quiet`, `normal` or `coached`: how much the session may propose. |
| `replan {minutes}` | Answers « I have N minutes » with a prompt (`prompts`, kind `replan`): the reviews due first, then whether the lesson ends in time. Nothing is cut; the prompt leaves with the scene. |
| `ask {text?}` | Hands over to the conversation: a `notice` view with the scene unchanged, nothing submitted. `text` is kept in the context (`question`). |

A view carries `strings`, the interface's phrase catalogue in the lesson's language (some 24 kB), for the
surface that draws it. The MCP server leaves it empty where nothing draws the view (forms, the conversation):
its reader is then a model.

A surface may send `client_ms` beside an action (`ClientMsSchema`, a whole number of milliseconds from 0 to 600000): the delay between the learner's previous action and the display of the view that answered it. It is never part of the action. `panel_action` validates it; nothing reads it yet, the interaction log will record it under consent.

The [MCP adapter](../../apps/lesson-mcp/src/panel-tools.ts) provides `hostBackend(SessionHost, bundlesRoot)`, with filesystem-confined image reads. It observes ordinary lesson transitions too, including a native reproduction run, so completion stays consistent. The [VS Code adapter](../../apps/studium-vscode/src/extension.ts) provides `mcpBackend(call, {bundlesRoot})` over the existing operation names. The extension normally consumes open_lesson_panel, get_panel_view and panel_action directly. The backend also reads get_next_reinforcement for the completion screen's due count.

## Add a host

1. Open a session through open_lesson_panel and retain the returned PanelView.
2. Render the public fields and offer the actions named in actions.
3. Send only the learner's own response or rating through panel_action; render the returned view.
4. Handle pickCourse locally (a host open item). Ask for native confirmation before end with confirmed:true, which erases progress. confirmed:false leaves the view unchanged. Closing a UI is separate from erasure.

P1 registers no MCP UI metadata. VS Code posts `{type:"view", view}` plus a temporary legacy message shim; the shared renderer and MCP Apps resource are P2's responsibility. The old helper paths remain re-exports for existing drivers. The completion compatibility helper is retained in VS Code because it is outside P1's write set.

## Verification

`pnpm --filter @studium/lesson-panel test` runs the fixture-backed action tests. `pnpm --filter @studium/lesson-panel build` checks TypeScript. MCP and VS Code integration checks live in their own packages. No model call is needed.
