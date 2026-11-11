English · [Français](README.fr.md)

# Studium for VS Code

Play a Studium adaptive lesson inside VS Code: read each scene with its figures, equations, plots and
molecules, answer in the pane, get feedback after your answer, and see which concepts are due for review.
The extension is a thin MCP client of [`apps/lesson-mcp`](../lesson-mcp/README.md); it adds no backend.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/vscode-pane-choices-dark.png">
  <img src="../../docs/assets/screenshots/vscode-pane-choices-light.png" width="420" alt="The Studium lesson pane in VS Code showing a multiple-choice question with its answer buttons">
</picture>

| | |
|---|---|
| Status | **supported** (decision D6) |
| Run (developer) | `pnpm --filter studium-vscode build`, then F5 in VS Code |
| Install | `pnpm --filter studium-vscode package`, then `code --install-extension apps/studium-vscode/studium.vsix` |
| Port | none: the server runs as a child process over stdio |
| Calls | the bundled lesson server (`dist/lesson-mcp.cjs`), or the source server in a checkout |
| Tests | `pnpm --filter studium-vscode test` (type check and 23 headless drivers) |

User guide: [Studium in VS Code](../../docs/start/vscode.md).

## Surfaces

- **Lesson pane** (`studium.openLesson`): a webview (`media/artifact-pane.{js,css}`) that renders each
  scene with its artifacts and collects the answer. Feedback is its own step; a completion screen offers
  the review actions.
- **Lesson notebook** (`studium.openLessonNotebook`): each run of the driver cell advances the lesson one
  turn and renders the scene as cell output.
- **Course picker** (`studium.pickLesson`): discovers a lessons folder, stores the workspace's chosen
  course and opens it, without editing `settings.json`.
- **Chat participant** (`@studium`): a lesson turn by turn in the chat panel, with `/hint` and `/discuss`.
  It shows the server's own text for each step and sends what you type as `{kind: "reply", text}`; the
  server maps it to the scene's input (a letter, a confidence, your words) or says it could not read it,
  and the chat then repeats how this scene is answered.

The pane, the chat and the notebook start the lesson server the same way, on the same learner storage.

```
 VS Code extension host ── MCP client ──▶ lesson-mcp (stdio) ──▶ lesson-session engine
        │                                                          (adaptive loop, mastery, graders)
        ├─▶ WebviewPanel  ◀── postMessage ──  media/artifact-pane.{js,css}
        └─▶ NotebookController ── cell output ──  src/notebook.ts
```

Each turn the extension pulls the current scene (redacted by the server) and `get_scene_artifacts`,
presents them, sends the answer back over `submit_response`, `submit_turn` or `request_hint`, and repaints
the next scene. The pane serializes learner actions, disables controls while a turn is pending, keeps
recoverable errors beside the current scene, and closes a connection that finishes opening after the panel
was dismissed. Start-up failures name the output channel and the command to retry. When an action reaches
a session the server no longer knows (`session not found`), the extension passes that reason to the pane,
which replaces the scene with « Session lost » and a « Reopen the lesson » button; the button closes the
pane and opens the same lesson in a new one (with durable storage the learner resumes where they were).

## Commands

Titles, setting descriptions and the view name follow VS Code's display language (English from
`package.nls.json`, French from `package.nls.fr.json`). The ids never change.

| Command | Id | What it does |
|---|---|---|
| Studium: Pick a course | `studium.pickLesson` | choose a discovered course or another lessons folder, save both in the workspace, open the lesson |
| Studium: Open lesson | `studium.openLesson` | the lesson pane |
| Studium: Open lesson as notebook | `studium.openLessonNotebook` | the notebook surface |
| Studium: Open this lesson | `studium.openThisLesson` | also in the explorer and editor-tab menus on a `lesson.json`; opens it without touching the settings |
| Studium: Community contributions | `studium.communityContributions` | open peer-authored, teacher-approved bundles under the course's `community/` folder |
| Studium: Run reproduction (current scene's capsule) | `studium.runReproduction` | run the current scene's capsule, after confirmation |
| Studium: Refresh the lessons view | `studium.refreshLessons` | rescan courses and reviews |
| Studium: Getting started | `studium.openWalkthrough` | the walkthrough |
| Studium: Forget my data | `studium.forgetMyData` | after confirmation, erase what this extension keeps in VS Code |

**Forget my data** first closes every lesson server the extension started (lesson panes, the chat, notebook
sessions, a status refresh) and waits for them to exit, so none writes its state back; a new lesson asked for
meanwhile waits until the erase is over. It then erases the progress and review state in the extension's
storage folder, the courses you chose to trust and the remembered last lesson. The data an assistant (Claude Code, Codex) keeps in
`<STUDIUM_HOME>/data` (default `~/.studium/data`) is named in the confirmation and left untouched. Inside a
lesson, **Forget me** in the pane's *Lesson options* menu (or the notebook `forget` directive) calls
`forget_session` after a confirmation. `end_session` closes a session and keeps its state; closing a panel
or notebook only drops the connection, so saved progress survives.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `studium.repoRoot` | the extension's monorepo root | where `lesson-mcp` and the pnpm `tsx` live |
| `studium.bundlesRoot` | a checkout's `fixtures/`, else `~/.studium/library` | `BUNDLES_ROOT` the server resolves `bundleRef` against; `STUDIUM_HOME` moves the library |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | the current course; with nothing stored yet, Open lesson starts the picker |
| `studium.communityBundlesRoot` | the value of `bundlesRoot` | root the community picker scans |
| `studium.assets` | `vendor` | `vendor` (offline, `media/vendor`) or `cdn` (jsdelivr) |
| `studium.learnerId` | `vscode-learner` | salts the learner pseudonym |
| `studium.telemetryConsent` | `false` | opt in to sending consented, pseudonymized class telemetry; progress and reviews stay on the device either way |
| `studium.showGraph` | `true` | open the companion live workflow-graph pane |
| `studium.graphView` | `student` | graph scope: `student` (ego view) or `teacher` (full graph) |
| `studium.showMastery` | `false` | show the per-concept mastery bar (teacher demo only: it can leak quiz answers) |
| `studium.modalityPreference` | `balanced` | `visual`, `textual` or `balanced` artifact ordering |

## Scenes and artifacts

Every scene type of the bundle schema is wired on both surfaces, rendered and answered with the response
kind its grader requires (graders dispatch on `scene.type` and reject a mismatched kind).

| Scene type | What the learner does | Response |
|---|---|---|
| `intro`, `concept` | read | continue (`ack`) |
| `quiz` | pick a choice, ask for a hint | `quiz_choice` |
| `meta_checkpoint` | declare confidence `0` to `4` | `confidence` |
| `reproduction` | follow the protocol; see the executed reference run | `ack` |
| `ai_critique` | critique an AI output (free text) | `critique` |
| `spot_the_flaw` | name the planted errors | `flaw_report` |
| `explain_back` | teach the idea back | `explanation` |
| `comparison` | name the differences between artifact A and B | `comparison` |
| `summary_audit` | audit an AI summary for omissions and distortions | `summary_audit` |
| `prompt_practice` | write or refine a prompt for the task | `prompt_submission` |
| `communication_sim` | write a professional message for the scenario | `communication` |
| `discussion` | multi-turn Socratic dialogue | `submit_turn` several times, then `ack` |

Answer keys (`claims`, `key_points`, `correct` flags, `model_*`) are stripped by the server before the
scene reaches the pane.

Letter and number shortcuts work while the focus is in the list of choices; the pane says so under the
choices ("In the list of choices: A–C or 1 to 3 to choose, Enter to submit.", or "On the scale: 0 to 4" for
a confidence check).

The pane renders the `scene_assets[]` manifest by kind: `image`, `svg`, `equation_latex` (KaTeX),
`plot_spec` (Vega-Lite), `code`, `data_csv`, `protocol_md`, the `executed_result` card (figure, graded
checks, landmark, capsule provenance), and `orbital`, `mol_3d` (3Dmol) and `spectrum` (Vega). If a library
is absent the renderer degrades (equation to styled code, plot to inline SVG bars, 3D to a labelled note).
marked, KaTeX, Vega, 3Dmol and Cytoscape are vendored into `media/vendor` and load locally by default.

Lesson prose uses GFM Markdown and passes through a local DOM allowlist. Inline and display mathematics
(`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) and mhchem are rendered with KaTeX; code gets offline colouring for
Python, JavaScript/TypeScript, SQL, Bash and JSON. Relative Markdown images show an explicit
unresolved-image caption for now.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/vscode-pane-feedback-dark.png">
  <img src="../../docs/assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="Feedback shown as its own step after a written answer: marked not certified because no judge assessed it, with the key points, the model answer, the cited source and the four self-rating buttons">
</picture>

## Feedback, reviews and adaptation

- **Feedback** comes after the answer. ✓ appears only on an answer marked right, ✗ only on one marked
  wrong; an answer nobody assessed is shown as recorded. Without a judge model, an open answer is shown with
  the reference to compare with; self-rating ("I didn't know", "Hard", "Good", "Easy") schedules reviews but
  never moves mastery. After a wrong quiz answer, the right choice appears under "The right answer" once you
  leave the question. A cited source shows its licence after its title when the lesson records one.
- **Reviews**: at start-up, when a lesson closes or completes, and on Refresh, the extension asks the
  server what is due (`get_next_reinforcement`). The status bar then reads **Studium · 2 to review** when
  every concept waiting is a due review, else **Studium · 3 to work on**; its tooltip and the sidebar keep
  the groups apart (to review, to take up again, not measured yet) or give the next review date. Clicking
  opens the Studium sidebar. With no history, nothing is shown.
- **Completion screen**: the concepts consolidated, the concepts practised (with their number of graded
  answers) and those not measured yet, then the next review date and the review actions.
- **Modality preference** reorders and emphasises each scene's artifacts toward `visual` or `textual`;
  nothing is hidden.
- **Calibration verdict**: a number-free over- or under-confidence nudge ([`src/calibration.ts`](src/calibration.ts)).
- **Live workflow graph** (`studium.showGraph`): a companion Cytoscape pane that repaints each turn.

## From a conversation to the pane

A lesson an assistant builds for you lands in your personal library (`~/.studium/library`, or
`STUDIUM_HOME/library`), the default lessons folder of an installed extension. To open it the assistant
can run

```bash
code --open-url "vscode://holobiomicslab.studium-vscode/open?bundle=<percent-encoded path of lesson.json>"
```

or you can right-click the `lesson.json` and choose **Studium: Open this lesson**. A link must name an
absolute path, without `..`, to an existing `.json` file; anything else is refused and nothing opens. If
the window reloads while a lesson is open, the pane is restored and the lesson resumes.

## Your data, and what runs

- **Where it is.** Progress and review state are written under VS Code's per-user extension storage
  (`globalStorageUri`), never into the lessons folder, whatever the telemetry setting.
- **Size limits.** To name concepts by their titles, the extension reads a `lesson.json` of at most 8 MB,
  or a community `.zip` of at most 32 MB whose `lesson.json` inflates to at most 8 MB; past those sizes it
  reads nothing and the pane shows concept ids. The lesson server applies the same 8 MB cap to a zipped
  `lesson.json`.
- **Running a reproduction.** Before a bundle's command runs, a modal shows the exact command, the
  packages to install and the folder; nothing starts until you choose **Run** or **Run and trust this
  course** (remembered for that exact bundle version, by fingerprint). A `working_dir` that is absolute
  or contains `..` is refused. A `landmark_pattern` is bounded before it is compiled, and every match runs
  under a 50 ms time limit.

Notebook driver-cell directives: empty or `next` continues; a choice id (`a`, `b`…) answers a quiz;
`0` to `4` sets confidence; free text answers an active-learning scene or a discussion turn; `hint` asks
for a hint; `forget` erases your session data.

## Develop

1. Vendor the render libraries once: `pnpm --filter studium-vscode vendor`.
2. Build: `pnpm --filter studium-vscode build` (writes `dist/extension.js` and `dist/lesson-mcp.cjs`).
3. Open this folder in VS Code and press F5 (Extension Development Host).
4. Run **Studium: Pick a course**, or use the **Courses** node of the Studium activity bar. Discovery
   accepts `<bundlesRoot>/<course>/lesson.json` and bare `*.json` files at the root.

## Package a VSIX

```bash
pnpm --filter studium-vscode package        # vendors, builds, then packages with a pinned @vscode/vsce
code --install-extension apps/studium-vscode/studium.vsix
```

The extension requires VS Code 1.95 or later. The VSIX includes `dist/lesson-mcp.cjs` and the vendored
renderers, so it runs without a checkout or a global `tsx`. Lessons are not inside the VSIX: without a
checkout the extension reads your personal library; otherwise set `studium.bundlesRoot` and
`studium.bundleRef`, or use **Studium: Pick a course**. In a checkout it prefers the source server and the
checkout's `fixtures/`. `studium.vsix` is a local build artifact, not a Marketplace release. A native MCP
client and the extension pane create separate server sessions; they do not share the current scene.
Installation is described in the [installation guide](../../docs/start/installation.md).

The page the Marketplace and Open VSX show is [`MARKETPLACE.md`](MARKETPLACE.md), written for the person
who installs the extension, in English then French; `package` hands it to `vsce` and this README stays out
of the VSIX. A registry page cannot follow a relative link: link to this repository's `main` branch by
full address, images included (the `contributes` driver checks it). The files of a release are built by
[`tools/release/build.sh`](../../tools/release/build.sh); see [Release](../../docs/develop/release.md).

## Tests

```bash
pnpm --filter studium-vscode test          # tsc --noEmit and the 23 registered drivers
```

| Driver | Covers |
|---|---|
| `extension-host` | the extension host against a fake `vscode` module and the real `lesson-mcp`: link and "Open this lesson", pane restoration, storage with consent off, run confirmation and trust memory, `working_dir` refusal, navigation, self-rating, completion, review and restart actions, forget my data |
| `run-trust`, `lesson-uri`, `study-status`, `data-paths`, `host-phrases`, `pane-messages` | the pure pieces behind it (fingerprint and consent text, link parsing, review shaping, default lesson folder, fr/en parity, message validation) |
| `contributes` | the manifest: every `%key%` resolves in both nls files, walkthrough, activation events, menus, welcome view, icon |
| `scene-io` | the scene-to-response-kind contract (must match the graders) and the calibration port |
| `webview-pane` | live render of `media/artifact-pane.js` in jsdom: every scene type, posted messages, no `model_*` key in the DOM, and an axe-core pass (WCAG 2.x A/AA) |
| `lesson-walk` | end to end: spawns the real `lesson-mcp` and walks every scene type through the real graders to `complete` |
| `community`, `modality`, `review-fsrs`, `lesson-tree`, `lesson-picker` | picker discovery, modality ordering, FSRS parity, course tree |
| `panel-lifecycle`, `mcp-connect`, `chat-format`, `context-help`, `asset-path`, `run-task` | late-close cleanup, exclusive actions, failed-connect cleanup, chat output, help, asset paths, run tasks |
| `completion` | the end-of-lesson split (consolidated, practised, not measured yet) and the next review date after a rating |

Drivers that start `lesson-mcp` never write into your home folder: [`src/driver-isolation.ts`](src/driver-isolation.ts)
points `STUDIUM_HOME` at a temporary folder, sets `STUDIUM_EPHEMERAL=1`, points `HOME` at an empty sentinel
folder, and fails if anything appeared there. jsdom does not paint, so colour contrast is checked separately
by `node design/scripts/check-contrast.mjs`; a custom editor theme still needs a look in VS Code. The
notebook controller's cell output is type-checked only; try it by hand with F5.
