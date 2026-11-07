English · [Français](README.fr.md)

# Shared lesson panel

The lesson and graph renderers serve VS Code and MCP Apps. The server supplies a public
`studium/panel-view/2` view (a `studium/panel-view/1` view is still read); the browser never grades
answers or reads learner files.
`src/artifact-pane.js` exports `renderView`, including full-state hint, discussion, rating and
completion replay. The classic build preserves the older message protocol for existing drivers.

For a version-2 view the lesson renderer also shows: an orientation line over the progress rail (the
view's `status_line`; the rail keeps its segments and drops its own label, so the step is said once); who
signs the lesson, over the scene, and who assessed the answer, over a verdict (a key verdict says whose
key: the AI-drafted key, the key the learner wrote, or the author's key for a teacher's lesson); the help ladder under the
answer controls, one button per rung, each with its cost or the reason it is closed; and « Ask a question »,
which sends the `ask` action. A closed rung is `aria-disabled`, not `disabled`: it takes the keyboard focus,
so its reason can be read, and pressing it sends nothing. Last comes a « Settings » region, drawn from the
actions the view offers and nothing else: « Quiet », « Normal », « Coached » (`setAttention`, the view's
`attention` pressed), FR and EN (`setLanguage`, the view's `locale` pressed), and a minutes field with
« Replan » (`replan {minutes}`, 1 to 600). These controls answer nothing: they stay enabled while an answer
is owed, and the feedback already left is not shown again when their view comes back.
Every control is reached with Tab in reading order.
An action error whose message starts with `session not found` (the server restarted, or the session was
closed; the tool's JSON envelope `{"error": …}` is opened first, and nothing after the prefix is read)
replaces the scene, settings included, with the « Session lost » notice and a « Reopen the lesson » button
that sends `reopen` once, on a click; nothing is retried on its own. The MCP App bridge answers `reopen`
with `open_lesson_panel` for the `bundle_ref`, `learner_id` and `surface` of the last view, in the
current locale; the VS Code bridge passes it to the extension. Any other action error keeps the scene
and the « Action failed » status line.
The renderer measures the delay between an action and the display of the view that answers it, and hands
it once to the bridge with the next action (`window.__send(action, { client_ms })`); the MCP App bridge
passes it to `panel_action` as `client_ms`, the VS Code bridge to the extension, which does the same.

The MCP App bridge also keeps the host's assistant informed, where the host says it can
(`getHostCapabilities()`). After each `panel_action` it reads `get_companion_brief` with `peek: true` (the
cursor does not move) and puts the brief in the model's context with `updateModelContext`: one line of
note, then the brief as JSON. « Ask a question » opens a small form; the learner's words go to the host's
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
report size, route links through the host, confirm erasure and provide a course picker. Capsule
reproduction requires the VS Code terminal; the MCP pane explains that limitation.

MCP HTML inlines marked, KaTeX and mhchem. KaTeX CSS/fonts, Vega, Vega-Lite, Vega-Embed, 3Dmol,
Cytoscape and dagre use `https://cdn.jsdelivr.net`, with pinned versions and integrity hashes.
Missing scientific libraries retain the existing readable fallbacks. Remote lesson images remain
blocked. VS Code preserves its offline vendor mode. See [vendor licenses](VENDOR-LICENSES.md)
and [harness setup](../../docs/start/harness-panels.md).
