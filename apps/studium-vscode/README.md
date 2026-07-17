# Studium for VS Code

Run a Studium **adaptive lesson inside VS Code**. The extension is a thin **MCP client** to
`apps/lesson-mcp` (no new backend) and offers two student-runtime surfaces that move **pair by
pair** with the tutoring loop:

- **Lesson pane** (`studium.openLesson`) — a `WebviewPanel` (`media/artifact-pane.{js,css}`) that
  renders each scene + its artifacts and collects the learner's answer.
- **Lesson notebook** (`studium.openLessonNotebook`) — a `NotebookController`; each run of the
  driver cell advances the lesson one turn and renders the scene as rich cell output.

```
 VS Code extension host ── MCP client ──▶ lesson-mcp (stdio) ──▶ lesson-session engine
        │                                                          (adaptive loop, mastery, graders)
        ├─▶ WebviewPanel  ◀── postMessage ──  media/artifact-pane.{js,css}
        └─▶ NotebookController ── cell output ──  src/notebook.ts
```

Each turn the extension pulls the current scene (server-redacted via `publicScene`) +
`get_scene_artifacts` and presents them; the learner answers in the surface; the response goes back
over `submit_response` / `submit_turn` / `request_hint`; the engine adapts; the next scene repaints.

## Scene coverage

Every scene type the bundle schema defines is wired on **both** surfaces — rendered **and** answered
with the exact response kind its grader requires (the graders dispatch by `scene.type` and reject a
mismatched kind, so a half-wired scene would hard-break the lesson):

| Scene type | What the learner does | Response |
|---|---|---|
| `intro`, `concept` | read | continue (`ack`) |
| `quiz` | pick a choice (+ ask for a hint) | `quiz_choice` |
| `meta_checkpoint` | declare confidence `0`–`4` | `confidence` |
| `reproduction` | follow the protocol steps; see the executed reference run | `ack` |
| `ai_critique` | critique an AI output (free text) | `critique` |
| `spot_the_flaw` | name the planted errors (free text) | `flaw_report` |
| `explain_back` | teach the idea back (free text) | `explanation` |
| `comparison` | name the differences between artifact A and B | `comparison` |
| `summary_audit` | audit an AI summary for omissions/distortions | `summary_audit` |
| `prompt_practice` | write/refine a prompt for the task | `prompt_submission` |
| `communication_sim` | write a professional message for the scenario | `communication` |
| `discussion` | multi-turn Socratic dialogue (scored reasoning + tutor reply) | `submit_turn` ×N, then `ack` |

Answer keys (`claims` / `key_points` / `correct` flags / `model_*` reveals) are stripped **at the
transport** by `publicScene` (server-side), so they never reach the surface to be DOM-leaked.

## Artifact rendering

The lesson pane renders the normalized `scene_assets[]` manifest **by kind**: `image`, `svg`,
`equation_latex` (KaTeX), `plot_spec` (Vega-Lite, interactive), `code`, `data_csv`, `protocol_md`,
the `executed_result` card (figure + graded checks + landmark + capsule provenance), and the
interactive scientific kinds `orbital` / `mol_3d` (3Dmol) and `spectrum` (Vega). If a render lib is
absent the **same renderer degrades gracefully** (equation → styled code; plot → inline-SVG bars;
3D → a labelled note). KaTeX/Vega/3Dmol/Cytoscape are **vendored into `media/vendor`** and load
locally by default (`studium.assets: "vendor"`, air-gap safe); `cdn` pulls them from jsdelivr.

## Adaptive & metacognitive surfaces

- **Modality preference** (`studium.modalityPreference`) — reorders + emphasises each scene's
  artifacts toward `visual` / `textual` (content-preserving; nothing is hidden).
- **Spaced-repetition cue** — an "À réviser / Due for review" banner from the FSRS scheduler
  (`src/review-fsrs.ts`, a read-side mirror of the engine's `fsrs.ts`).
- **Calibration verdict** — a number-free "sur/sous-calibré·e" nudge (`src/calibration.ts`, a
  verbatim port of the engine's `calibrationVerdict`); only the actionable bands are shown.
- **Live Learning-Workflow-Graph** (`studium.showGraph`) — a companion Cytoscape pane
  (typed-graph-lens) that repaints each turn; `student` ego-view or `teacher` full-view.
- **Community contributions** (`studium.communityContributions`) — open peer-authored, teacher-
  approved bundles discovered under the course's `community/` dir; the canonical course is immutable.
- **Right to be forgotten** — the pane's "🗑 M'oublier" control (or the notebook `forget` directive)
  calls `end_session` to purge the durable per-learner state. Closing a panel/notebook only drops the
  transport, so saved progress survives a resume.

## Settings

| setting | default | meaning |
|---|---|---|
| `studium.repoRoot` | *(extension's monorepo root)* | where `lesson-mcp` + the pnpm `tsx` live |
| `studium.bundlesRoot` | *(repo `fixtures/`)* | `BUNDLES_ROOT` the server resolves `bundleRef` against |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | the course to open (the L1 atomistique demo) |
| `studium.communityBundlesRoot` | *(= `bundlesRoot`)* | root the community-contributions picker scans |
| `studium.assets` | `vendor` | `vendor` (offline, `media/vendor`) or `cdn` (jsdelivr) |
| `studium.learnerId` | `vscode-learner` | salts the RGPD pseudonym |
| `studium.telemetryConsent` | `false` | opt in to consented, pseudonymized class telemetry |
| `studium.showGraph` | `true` | open the companion live workflow-graph pane |
| `studium.graphView` | `student` | graph scope: `student` ego-graph or `teacher` full graph |
| `studium.showMastery` | `false` | show the per-concept mastery bar (teacher demo only — can leak quiz answers) |
| `studium.modalityPreference` | `balanced` | `visual` / `textual` / `balanced` artifact ordering |

## Commands

- **Studium: Open Lesson** (`studium.openLesson`) — the webview lesson pane.
- **Studium: Open Lesson as Notebook** (`studium.openLessonNotebook`) — the notebook surface.
- **Studium: Contributions de la classe / Community contributions** (`studium.communityContributions`).

Notebook driver-cell directives: empty/`next` → continue · a choice id (`a`,`b`,…) → quiz answer ·
`0`–`4` → confidence · free text → answer an active-learning scene / a discussion turn · `hint` →
ask for a hint · `forget` → erase your session data.

## Run it (developer / F5)

1. Vendor the render libs once (offline KaTeX/Vega/3Dmol/Cytoscape → `media/vendor`):
   `pnpm --filter studium-vscode vendor`.
2. Build the bundle: `pnpm --filter studium-vscode build` (esbuild → `dist/extension.js`).
3. Open this folder in VS Code and press **F5** (Extension Development Host).
4. Run **"Studium: Open Lesson"** (or **"… as Notebook"**) from the Command Palette, or click the
   **Studium** icon in the Activity Bar. It runs zero-config against the repo's `fixtures/atomistique-l1`
   demo; point `studium.bundlesRoot` / `studium.bundleRef` elsewhere for another course.

## Install it (packaged VSIX — for a colleague test round)

For testers who don't want to F5 a dev host, build an installable `.vsix`:

```
pnpm --filter studium-vscode package        # vendor+build already done? just: builds → studium.vsix
code --install-extension apps/studium-vscode/studium.vsix
```

Requires VS Code **≥ 1.95** (the chat participant + Language Model APIs). Engine 1.101+ is only needed
for the (not-yet-shipped) editor-agent MCP integration.

> **Honest boundary — the VSIX still needs the cloned repo.** The extension does not execute the science
> itself; it spawns `lesson-mcp` (`apps/lesson-mcp`, via `tsx`) from the monorepo. So a tester must also
> **clone this repo + `pnpm install`**, then set **`studium.repoRoot`** to their clone. The `tsx` path is
> now resolved tolerantly (pnpm / npm / yarn / PATH), but full self-containment — bundling `lesson-mcp`
> into the VSIX so no repo is required — is a follow-up. `studium.vsix` is a build artifact (git-ignored);
> attach it to a GitHub release for distribution.

## Use it in chat (`@studium`)

With Copilot Chat (or another chat provider) installed, type **`@studium`** in the chat panel to run a
lesson turn-by-turn, plus **`/hint`** and **`/discuss`**. The verdict deck works there via numbers
(reply `1,3`). Rich artifacts (3D / equations) still open in the **Studium — Lesson** webview — chat is a
companion, not a replacement. No answer key reaches the chat: the scene is redacted server-side.

## Tests

The extension ships a headless verification suite (no VS Code host needed) — **12 drivers, 300+
assertions** (`pnpm --filter studium-vscode test`):

```
pnpm --filter studium-vscode test          # tsc --noEmit + all 6 drivers
```

- `scene-io.driver` — the scene→response-kind contract (must match the graders) + a text-parity
  guard that the webview posts the same kinds + the calibration port.
- `webview-pane.driver` — **live** render of `media/artifact-pane.js` in **jsdom**: every scene type
  renders its fields, and clicking a control posts the correct host message (`respond`/`turn`/`end`);
  asserts no `model_*` answer key leaks to the DOM.
- `lesson-walk.driver` — **live e2e**: spawns the real `lesson-mcp` server over stdio and walks
  `src/fixtures/wave-scenes.json` (every active-learning type, un-gated) + `all-scene-types.json`
  (the discussion turn loop) through the real graders to `complete`.
- `community`, `modality`, `review-fsrs` — picker discovery, modality reordering, FSRS parity.

> Scope note: the **webview** front-end is executed live (jsdom). The **notebook** controller uses
> `vscode.*` APIs that only run inside a real Extension Host, so its input mapping is covered live
> (it shares `src/scene-io.ts` with `lesson-walk`) but its cell-output rendering is type-checked
> only — exercise it by hand via F5.
