English · [Français](README.fr.md)

# Studium student runtime (Tauri)

The first learner surface: a desktop app (Tauri 2 and React) that plays a lesson bundle from a local
library. It still builds but is no longer developed. New learner features land in the
[VS Code pane](../studium-vscode/README.md) and in the chat harness ([`apps/lesson-mcp`](../lesson-mcp/README.md)).
It will be retired once one of them covers the learner who has no IDE.

| | |
|---|---|
| Status | **frozen** (decision D6) |
| Run | `pnpm --filter @studium/student-runtime tauri:dev` (needs a Rust toolchain) |
| Port | 1420 (Vite dev server inside the app window) |
| Depends on | [`@studium/lesson-session`](../../packages/lesson-session) and the shared engine packages |
| Calls | nothing over the network |
| Tests | `pnpm --filter @studium/student-runtime test` |

## What it still does

- Plays a lesson bundle (`.zip`) from a local library, with the shared lesson engine
  (`@studium/lesson-session`).
- Runs the seven scene types it implements. The six active-learning types (`spot_the_flaw`,
  `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim`) show a card
  that names the scene and lets the learner continue; they are playable only in the VS Code pane
  (`UNSUPPORTED_ON_WEB` in [`src/components/scenes/SceneRouter.tsx`](src/components/scenes/SceneRouter.tsx)).

## What it does not do

- It does not show the authorship notice of self-study lessons (`metadata.authoring`): a self-study
  bundle played here loses its honesty notice. Use the VS Code pane or the harness.
- It has no locale handling: the interface strings are fixed in the source.
- Directory bundles are not read, only `.zip` files.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STUDIUM_BUNDLES_DIR` | `<cwd>/bundles` | library folder of `.zip` bundles |
| `TAURI_DEV_HOST` | unset | host for the Vite dev server when developing on another device |
| `STUDIUM_RUNTIME_BIN` | `src-tauri/target/release/student-runtime` | binary used by the WebdriverIO tests |

## Develop and build

```bash
pnpm --filter @studium/student-runtime test       # unit tests
pnpm --filter @studium/student-runtime tauri:dev  # needs a Rust toolchain
```

CI no longer builds this app on every push. The `tauri-build` and `demo-m6` jobs run only from
*Actions > CI > Run workflow*; do not rely on them being green.
