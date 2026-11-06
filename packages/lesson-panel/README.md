English · [Français](README.fr.md)

# Shared lesson panel

`@studium/lesson-panel` composes the same learner view for VS Code and other harnesses. It imports no VS Code, DOM or filesystem API. Images are read by an injected backend.

## Contract

`PanelViewSchema` and `PanelActionSchema` are Zod schemas with inferred TypeScript types. Views carry `schema: "studium/panel-view/1"`, session identity, public scene and ordered assets, locale and browser strings, progress, earned feedback, review cues, number-free calibration and completion. Mastery defaults to an empty object; when requested, unmeasured values remain null, matching the existing host rather than inventing a score. Explanation may be the existing structured explanation or text.

The presenter calls the existing [publicScene projection](../lesson-session-host/src/public-scene.ts). Unexpected answer, correct, expected, key or solution fields in pre-answer scene content or assets are rejected recursively. Earned verdicts may carry correct after an answer. This validation is not a second redactor. Hints and turn results remain available when the host reads the view again.

## Backends and actions

`presentPanel(backend, ctx)` reads the current view. `applyPanelAction(backend, ctx, action)` validates and applies respond, turn, hint, rateRecall, reviewNow, restartLesson, end or pickCourse. The host owns the mutable `PanelContext`: session identity, concept titles, modality and mastery options, review origins, earned transition and latest view. Serialize actions against that context. Review and restart can replace its session id; use the id returned in the view.

The [MCP adapter](../../apps/lesson-mcp/src/panel-tools.ts) provides `hostBackend(SessionHost, bundlesRoot)`, with filesystem-confined image reads. It observes ordinary lesson transitions too, including a native reproduction run, so completion stays consistent. The [VS Code adapter](../../apps/studium-vscode/src/extension.ts) provides `mcpBackend(call, {bundlesRoot})` over the existing operation names. The extension normally consumes open_lesson_panel, get_panel_view and panel_action directly. The backend also reads get_next_reinforcement for the completion screen's due count.

## Add a host

1. Open a session through open_lesson_panel and retain the returned PanelView.
2. Render the public fields and offer the actions named in actions.
3. Send only the learner's own response or rating through panel_action; render the returned view.
4. Handle pickCourse locally (a host open item). Ask for native confirmation before end with confirmed:true, which erases progress. confirmed:false leaves the view unchanged. Closing a UI is separate from erasure.

P1 registers no MCP UI metadata. VS Code posts `{type:"view", view}` plus a temporary legacy message shim; the shared renderer and MCP Apps resource are P2's responsibility. The old helper paths remain re-exports for existing drivers. The completion compatibility helper is retained in VS Code because it is outside P1's write set.

## Verification

`pnpm --filter @studium/lesson-panel test` runs the fixture-backed action tests. `pnpm --filter @studium/lesson-panel build` checks TypeScript. MCP and VS Code integration checks live in their own packages. No model call is needed.
