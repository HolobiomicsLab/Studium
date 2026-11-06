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

Two actions show the concept map, from forms upwards and for a lesson (a review session has none):

| Action | Effect |
|---|---|
| `openMap` | Adds `map` to every view until `closeMap`: nothing is submitted and the scene stays. A session without a map (fewer than two concepts) answers with a `notice`. |
| `closeMap` | Removes `map`. A session that starts again opens with its map closed. |
| `prompt {id, outcome}` | The learner's answer to a proposal of `prompts`: `accept` or `dismiss`. The backend keeps the outcome (`settlePrompt`). Accepted, a due review starts the review session and the map offer opens the map; a break, forms and the next lesson answer with a `notice` that says how. Dismissed, the scene stays. An answer to a prompt that is not open is an error in one line. |

`map` (`MapViewSchema`, built by `mapView(record, locale)`) is drawn from the session's record
`studium/concept-map-record/v1`, which a backend gives through `getConceptMapRecord`; a backend without
that method offers no map. For each concept it holds the state, the evidence (one entry per answer on that
concept: scene, calendar day, who assessed it, the result, the hints taken before it) and two sentences of
the catalogue, `establishes` and `does_not_establish`. `assessed_by` is `key`, `judge`, `self` (the learner
rated their own recall; the result is then `rated`) or `none` (nobody assessed the answer and the learner
has not rated it; the result is `recorded`). `edges` go from a prerequisite to the concept that needs it.
The view quotes no passage and carries none of the learner's words. A closed map is not read.

With the map open, `contest {concept_id, claim}` is the learner's declaration on a concept: `known`
(« I know it ») of a concept not acquired, `unsure` (« I am not sure ») of an acquired one. The claim
changes no mastery and skips no scene. The backend (`contestConcept`) moves the session to check
questions on that concept, taken from scenes graded against the author's key: two, or one when the lesson
has a single such scene, the outcome then being `partial`. Each answer is graded as any answer; its verdict
carries no reference, since the question may come again in the lesson. After the last one the lesson
resumes on the scene the learner was on, and the view's `message` says what the check showed. Each concept
of `map` carries `contest`: `allowed` (it can be contested now), `claim` (the one its state takes),
`questions` (how many check questions follow), `check_pending` while its check is under way, and `outcome`
(`confirmed`, `refuted` or `partial`) once one was settled. A contest refused by the backend (a claim the
state does not take, no key-graded question, another contest under way) is an error in one line.

Two surfaces draw `map`, both as a list in words and neither as a graph: the lesson panel
([`apps/lesson-panel-ui`](../../apps/lesson-panel-ui/src/artifact-pane.js)) and the Claude Code pane
([`apps/claude-code-mod`](../../apps/claude-code-mod/README.md)). Their words are the `pane_map_*` phrases.

`prompts` holds what the session proposes now. A backend with `getPrompts` is asked at each view, with the
attention level and the surface: the rules are the server's (nothing while an answer or a self-rating is
owed, a budget per session of 0, 3 or 6 proposals for `quiet`, `normal` and `coached`, each proposal made
once; see [`prompts.ts`](../lesson-session-host/src/prompts.ts)). The view gives each proposal two
actions, both `prompt` actions: the first accepts, the second refuses. A notice (`adaptation_notice`,
`resume_notice`) has no action. The view offers `prompt` only when a proposal can be answered. The
learner's own `replan` prompt is added after the server's and is not counted. No surface draws `prompts`
yet: a model reads them in the view of a lesson played in the conversation.

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
