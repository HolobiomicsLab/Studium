# Studium for VS Code

Run a Studium adaptive lesson **inside VS Code**, with an **artifact pane** that renders each
scene's figures, equations, interactive plots, and *executed* reference runs — **pair by pair**
with the tutoring loop.

## How it works

```
 VS Code extension host ── MCP client ──▶ lesson-mcp (stdio)  ──▶ lesson-session engine
        │  (the same server VS Code Copilot connects to)              (adaptive loop, mastery)
        ▼
 WebviewPanel  ◀── postMessage ──  media/artifact-pane.{js,css}   (the artifact pane)
```

- The extension is an **MCP client** to `apps/lesson-mcp` (no new backend).
- Each turn it pulls the current scene + **`get_scene_artifacts`** (the normalized
  `scene_assets[]` render manifest) and posts them to the webview.
- The pane renders the artifacts **by kind** — `image`, `svg`, `equation_latex` (KaTeX),
  `plot_spec` (Vega-Lite, interactive), `code`, `data_csv`, `protocol_md`, and the
  `executed_result` card (figure + graded checks + landmark + capsule provenance).
- The learner answers / asks for a hint **in the pane**; responses go back over
  `submit_response` / `request_hint`, the engine adapts, and the next scene + its artifacts
  repaint the pane. That is the *pair-by-pair* loop.

Equations and plots are rendered rich by KaTeX + Vega, which are **vendored into `media/vendor`
and load locally by default** (`studium.assets: "vendor"`) — so it works **air-gapped**, with no
CDN in the CSP. Set `studium.assets: "cdn"` to pull them from jsdelivr instead. If neither loads,
the **same renderer degrades gracefully** (equation → styled code; plot → an inline-SVG bar chart).

## Run it (developer / F5)

1. Vendor the render libs once (offline KaTeX/Vega → `media/vendor`): `pnpm --filter studium-vscode vendor`.
2. Build the bundle: `pnpm --filter studium-vscode build` (esbuild → `dist/extension.js`).
3. Make sure a course exists at `studium.bundlesRoot` (default `/tmp/studium_live/11-enriched.json`,
   which carries the live artifacts — author + enrich it with
   `eval/author_one.py 11 /tmp/studium_live --claude` then
   `eval/enrich_bundle_artifacts.py /tmp/studium_live/11-bundle.zip /tmp/studium_live/11-enriched.json`).
4. Open this folder in VS Code and press **F5** (Extension Development Host).
5. Run **“Studium: Open Lesson”** from the Command Palette.

## Settings

| setting | default | meaning |
|---|---|---|
| `studium.repoRoot` | *(extension's monorepo root)* | where `lesson-mcp` + the pnpm `tsx` live |
| `studium.bundlesRoot` | `/tmp/studium_live` | `BUNDLES_ROOT` the server resolves `bundleRef` against |
| `studium.bundleRef` | `11-enriched.json` | the course to open (carries live artifacts) |
| `studium.assets` | `vendor` | `vendor` (offline, `media/vendor`) or `cdn` (jsdelivr) |
| `studium.learnerId` | `vscode-learner` | salts the RGPD pseudonym |
| `studium.telemetryConsent` | `false` | opt in to consented, pseudonymized class telemetry |

## Production notes

- **Air-gap is the default**: KaTeX + Vega are vendored in `media/vendor` (~2.2 MB) and the CSP
  allows no external origin. `pnpm vendor` re-copies them from `node_modules`. Use
  `studium.assets: "cdn"` only if you prefer jsdelivr.
- The webview is vanilla JS so it embeds anywhere; alternatively point it at a built
  `student-runtime` (React `SceneRouter`) for full parity with the desktop runtime — both consume
  the same `sceneRenderAssets()` manifest.
