English · [Français](README.fr.md)

# Shared lesson panel

The lesson and graph renderers serve VS Code and MCP Apps. The server supplies a public
`studium/panel-view/2` view (a `studium/panel-view/1` view is still read); the browser never grades
answers or reads learner files.
`src/artifact-pane.js` exports `renderView`, including full-state hint, discussion, rating and
completion replay. The classic build preserves the older message protocol for existing drivers.

For a version-2 view the lesson renderer draws, from top to bottom: one session line built from the view's
`orientation` (step, contest check, detour and where it returns, minutes left, reviews due), beside the
« ⋯ » menu, with the view's `status_line` as the text a screen reader reads; the progress rail, which follows
the server's step (a detour keeps the step it returns to, or the last step on the path, and is marked);
the scene's type and a short chip for who signs the lesson, which opens to the full sentence; the scene;
then a bar that stays at the bottom of the panel while the scene scrolls (`position: sticky`, so a host
that sizes the frame to its content sees no change of height), holding the confidence scale with the
meaning of its two ends, the expected act and one « Help » button. « Help » opens the help ladder in place,
right after it in reading order: one button per rung, each with its cost or the reason it is closed, and
« Ask a question », which sends the `ask` action. A closed rung is `aria-disabled`, not `disabled`: it takes
the keyboard focus, so its reason can be read, and pressing it sends nothing. A hint appears under the
question. The « ⋯ » menu holds « Settings », « Choose another course » when the view offers `pickCourse`,
and the right to be forgotten. « Settings » opens a closed section at the bottom of the pane, drawn from
the actions the view offers and nothing else: « Quiet », « Normal », « Coached » (`setAttention`, the view's
`attention` pressed), FR and EN (`setLanguage`, the view's `locale` pressed), and a minutes field with
« Replan » (`replan {minutes}`, 1 to 600). These controls answer nothing: they stay enabled while an answer
is owed, and the feedback already left is not shown again when their view comes back.
The feedback screen keeps the session line, says who assessed the answer, and shows the learner's own
answer, which the renderer keeps for the session and sends nowhere: a choice beside the right choice when
the view carries it, labelled with whose key it is, or a written answer quoted above the key points.
A replayed scene shows the feedback the server returned, which holds no reference; a reference the view
still carries is held back. A view's `content_language`, when present, marks the scene and its feedback
with that language. Every control is reached with Tab in reading order, and a control that has the focus
keeps it while an action is pending (`aria-disabled`).
Every answer carries `expected_scene_id`, the scene on screen; when the server refuses it because the scene
changed, the MCP App bridge reads `get_panel_view` again and the panel says the answer was not counted. The
explanation rung is labelled by `help.explains` (the last answer or the screen), and a detour is placed at
the main-path step the view gives (`progress.detour`).
An action error whose message starts with `session not found` (the server restarted, or the session was
closed; the tool's JSON envelope `{"error": …}` is opened first, and nothing after the prefix is read)
replaces the scene, settings included, with the « Session lost » notice and a « Reopen the lesson » button
that sends `reopen` once, on a click; nothing is retried on its own. The MCP App bridge answers `reopen`
with `open_lesson_panel` for the `bundle_ref`, `learner_id` and `surface` of the last view, in the
current locale; the VS Code bridge passes it to the extension. Any other action error keeps the scene
and the « Action failed » status line.
A view whose `surface.kind` is `text` or `form` (a host that renders MCP Apps shows the panel for any call
of `open_lesson_panel`, a conversation or forms surface included) is not drawn as a scene: the panel shows
« This lesson is played in the conversation » (or « …in forms »), « The panel is not the surface negotiated
for this session. » and the view's `status_line`, with no scene body, answer control, settings or map, so
no act is taken at a rank the server did not negotiate. When `surface.available` holds `panel`, a « Play
here » button sends `playHere` once, on a click; the MCP App bridge answers it with `open_lesson_panel` for
the view's `session_id`, `bundle_ref` and `learner_id` with `surface: "panel"`, which renegotiates the live
session's surface (the interaction log records the change of rank). A `pane` or `panel` view is drawn as
before.
The renderer measures the delay between an action and the display of the view that answers it, and hands
it once to the bridge with the next action (`window.__send(action, { client_ms })`); the MCP App bridge
passes it to `panel_action` as `client_ms`, the VS Code bridge to the extension, which does the same.

The MCP App bridge also keeps the host's assistant informed, where the host says it can
(`getHostCapabilities()`). After each `panel_action` it reads `get_companion_brief` with `peek: true` (the
cursor does not move) and puts the brief in the model's context with `updateModelContext`: one line of
note, then the brief as JSON. « Ask a question » opens a small form in the help ladder; the learner's words go to the host's
conversation with `sendMessage`, after a brief read without `peek`, and the `ask` action then marks the
hand-over. A host that takes no message gets the `ask` action alone, whose notice sends the learner to the
conversation. A brief that cannot be read never fails the panel.

Run `pnpm --filter @studium/lesson-panel-ui build` from the repository root. The build uses esbuild
and two small HTML templates, regenerates vendor files from installed packages, and writes
`dist/lesson-panel.html`, `dist/graph-panel.html`, the embedded JavaScript resource exports and
`dist/vscode/`. Each MCP HTML resource has a hard 1,500,000-byte build limit. The MCP bundle and
VS Code build call this automatically; run it before importing the source MCP server directly.
`pnpm --filter @studium/lesson-panel-ui test` checks renderer replay and bridge interactions.

The bridges are `bridge-vscode.js`, `bridge-mcp-app.js` and `bridge-standalone.js`. A new host needs
a bridge that supplies views and carries learner actions. MCP Apps honor host locale and theme,
report size, route links through the host, and draw the erase confirmation and the course picker inside the panel. Capsule
reproduction requires the VS Code terminal; the MCP pane explains that limitation.

MCP HTML inlines marked, KaTeX and mhchem. KaTeX CSS/fonts, Vega, Vega-Lite, Vega-Embed, 3Dmol,
Cytoscape and dagre use `https://cdn.jsdelivr.net`, with pinned versions and integrity hashes.
Missing scientific libraries retain the existing readable fallbacks. Remote lesson images remain
blocked. VS Code preserves its offline vendor mode. See [vendor licenses](VENDOR-LICENSES.md)
and [panel notes for developers](../../docs/develop/panels.md).
