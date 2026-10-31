# Studium design system

Paper, ink and a path through knowledge. Open [preview.html](preview.html) from
disk to explore both themes with local files and example data.

## Six principles

1. **Give reasoning room:** open margins, short labels, a readable measure.
2. **Show the evidence:** name the evaluation source; keyword feedback says **Not certified**.
3. **Pair colour with meaning:** every status also has a label, shape or symbol.
4. **Respect the reader:** follow web preferences and the actual VS Code theme.
5. **Keep controls dependable:** native inputs, labels, keyboard access, 44 px targets and 3 px focus rings.
6. **Limit motion:** brief transitions; static, written feedback under reduced motion.

## Palette and contrast

[`tokens.json`](tokens.json) owns the values. Regenerate CSS after editing it:

```sh
node design/scripts/build-tokens.mjs
node design/scripts/build-tokens.mjs --check
node design/scripts/check-contrast.mjs
```

Components consume semantic `--st-` properties. Generated `--st-palette-*`
snapshots support host fallbacks. Light canvas/surface: `#f5f2eb` / `#fffdf8`;
dark: `#13252c` / `#1a3038`.

| Role and background | Light ink | Ratio | Dark ink | Ratio |
| --- | --- | ---: | --- | ---: |
| Text / canvas | `#172d38` | 12.79 | `#f2f2e9` | 14.04 |
| Muted / canvas | `#52646b` | 5.53 | `#b2c4c7` | 8.74 |
| Accent / canvas | `#176b60` | 5.68 | `#8bd5c4` | 9.34 |
| Accent 2 / canvas | `#85531c` | 5.78 | `#edc184` | 9.45 |
| Primary button / accent | `#fffdf8` | 6.24 | `#13252c` | 9.34 |
| Success / success-soft | `#25654a` | 5.73 | `#a2d8b7` | 7.18 |
| Warning / warning-soft | `#85531c` | 5.25 | `#edc184` | 7.09 |
| Danger / danger-soft | `#a33c31` | 5.21 | `#ffb4a6` | 7.18 |
| Info / info-soft | `#245e86` | 5.86 | `#a9d1ef` | 7.11 |
| Focus / surface | `#21688e` | 6.01 | `#b4dcfa` | 9.55 |
| Essential border / surface | `#748184` | 3.96 | `#829b9e` | 4.68 |

Ratios are *n*:1. Normal text requires 4.5:1; essential UI and large text require
3:1. Large means 24 CSS px regular or approximately 18.67 px bold. The checker
uses unrounded values for every declared pair. Use `border-strong` for input
boundaries; `border` is decorative. The original `#b87927` ochre is decorative;
text uses darker `accent-2`. Do not fade semantic text with opacity.

| Key class | Family | Meaning |
| --- | --- | --- |
| `ungraded` | Slate | Introduction, concept, confidence checkpoint |
| `author_keyed` | Ochre | Quiz or spot the flaw; open book in self-study |
| `production` | Blue | Reasoning/communication; show model or keyword provenance |
| `externally_grounded` | Green | Reproduction with an executed reference result |

A class is not a verdict. Graph **kinds** are concept (circle) and task (rounded
square); mastered (check) and due (clock) are **states** that keep the node shape.

## Type, space and motion

- **Display:** Georgia, Iowan Old Style, Palatino Linotype, Book Antiqua, serif.
  **Text:** Avenir Next, Avenir, Segoe UI, system-ui, sans-serif.
  **Mono:** ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace.
  Use mono for identifiers/values. All fonts are local fallbacks.
- **Scale:** 12/14/16/18/22/28/36/48/72 px at a 16 px root. Body 16 px;
  secondary UI 14 px; compact labels 12 px. Leading 1.6; titles 1.15–1.35.
- **Space:** 4 px base; 8/12 within controls, 16/24 within groups, 32/48/64
  between sections. Measure 65ch; pane up to 46rem. Narrow groups wrap.
- **Shape:** 4/8/16 px corners, pills for short labels, thin lines and pale fills.
  Reserve shadows for raised surfaces.
- **Motion:** 120/180/240 ms with `cubic-bezier(0.2, 0, 0, 1)`.
  `prefers-reduced-motion: reduce` removes transitions, animations and smooth
  scrolling within `.st-scope`. Loading remains named in text.

## Surface integration

| Surface | Consumption |
| --- | --- |
| VS Code panes | Load `tokens.css`, `components.css`, then `vscode-bridge.css`. Put `.st-scope` on the body; retain the host's `vscode-*` class. Do not add descendant `data-theme` attributes. Editor backgrounds, text, inputs, buttons and focus win; brand values are fallbacks. |
| Teacher dashboard / Observatory | Load `tokens.css` and `components.css`, then apply `.st-scope`. Root `data-theme="light"` or `"dark"` forces a choice; omit it to follow the OS. |
| Documentation | Use `docs/assets/brand/`, `hero-*.svg` and `docs/assets/diagrams/`. A theme suffix names the intended canvas. Use a `picture` dark-media source with a light fallback where supported, and contextual alt text. |

The bridge pairs button colours separately from link accents. High-contrast
themes preserve host borders, focus, words and shapes. The contrast report
covers the shipped palettes; custom themes need checking in their actual host.
Chip and verdict-heading words use `--st-text`; their status ink paints only the
border and the symbol, because a host status colour can fail 4.5:1 as text
(VS Code Light Modern warning ink reads 3.11:1 on white). The bridge also resets
`--st-tracking-display` to `normal`, since the display face becomes the editor's UI font.
Wiring into existing applications remains with the caller.

## Icons and components

The original **S-path mark** connects three nodes. Use the colour mark on light
canvases, the matching theme wordmark, and `currentColor` mono for the activity
bar or inline SVG. Keep 4 units clear around its 24-unit viewBox. Do not stretch,
rotate or add ornament. The 256 px PNG is ready for VSIX wiring. See the
[brand notes](../docs/assets/brand/README.md) and
[diagram sources](../docs/assets/diagrams/README.md).

Reuse the preview's labelled radio groups, textarea, 0–4 confidence range,
`details`, `meter` and buttons. Progress exposes a step count. Announce new
feedback in one polite status region; use alerts for urgent new errors.
Keep toasts dismissible and restore focus. Applications supply actual progress,
verdicts, mastery, due state and `authoring.notice`; the preview does not grade
or save answers. Keyword feedback uses a dashed border, ≈ and **Not certified**.

| Do | Don't |
| --- | --- |
| Explain the next action plainly | Expose grader internals or answer keys |
| Show authoring/evaluation provenance | Treat completion or keywords as mastery |
| Use one main action and labelled statuses | Colour every container or rely on colour alone |
| Preserve editor colours and focus | Paint over the user's theme |
| Name empty/loading/error states | Leave a silent pane or use motion alone |

[Verification evidence and limits](evidence/verification.md).
