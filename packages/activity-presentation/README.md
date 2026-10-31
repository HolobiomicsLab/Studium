English · [Français](README.fr.md)

# @studium/activity-presentation

Shared presentation pieces for Studium's web surfaces. It provides a React `ContextHelp` component that shows authored, contextual help in a native disclosure, and builds `dist/support.js`, one self-contained script that renders formulas (KaTeX), diagrams (Mermaid) and molecules (SmilesDrawer) offline in the HTML activity viewer. See [media and visual support](../../docs/teach/media-and-visual-support.md).

## Where it sits

A thin package over shared files in [`ui/`](../../ui/README.md): the help catalogue and renderer (`ui/context-help.json`, `ui/context-help.mjs`) and the scientific renderer (`ui/scientific-support.mjs`). The teacher dashboard, the student runtime and author-web import the component; `tools/experience_templates.py` inlines the built script into exported activities. See [architecture](../../docs/develop/architecture.md).

## Public API

| Entry | Purpose |
|---|---|
| `@studium/activity-presentation/react` → `ContextHelp({ topic, audience?, language? })` | Help for a catalogue topic; `audience` is `student` (default) or `teacher`, `language` is `fr` (default) or `en`. Escape closes an open tip and returns focus to its toggle. |
| `dist/support.js` (built) | Sets `window.StudiumSupport` with `render(container, assets)` and `renderMath(element)`. |

## Example

```tsx
import { ContextHelp } from "@studium/activity-presentation/react";

export function Header() {
  return <ContextHelp topic="confidence" audience="student" language="en" />;
}
```

`topic` is a key of `ui/context-help.json` (for example `confidence`, `evidence`, `provenance`, `mastery`). Build the offline renderers with:

```bash
pnpm --filter @studium/activity-presentation build
```

## Invariants

- Opening help neither submits nor records an answer.
- The built script works without network access: KaTeX fonts are inlined, and the licences of the bundled renderers are kept in its header.
- Math rendering ignores `script`, `style`, `textarea`, `pre` and `code`, and runs KaTeX with `trust: false`.
- An exported activity that needs formulas or render assets fails with a clear message until the script is built.

## Test

```bash
pnpm --filter @studium/activity-presentation test
```

This runs `ui/activity-language.test.mjs`, the language switch of the activity viewer, with jsdom.

## Depends on / used by

- Depends on: React 18 (peer); build-time `esbuild`, `katex`, `mermaid`, `smiles-drawer`; test-time `jsdom`.
- Used by: `apps/teacher-dashboard`, `apps/student-runtime`, `apps/author-web`, `tools/experience_templates.py`.

## Status

Active. Private workspace package, not published to npm.
