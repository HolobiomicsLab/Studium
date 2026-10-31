English · [Français](README.fr.md)

# Shared UI assets

Plain CSS and JavaScript shared by several surfaces, with no build step: the contextual help catalogue and
its renderer, the scientific renderer for formulas, diagrams and media, the activity-language helper, and
the Observatory's stylesheets. The canonical visual identity lives in [`design/`](../design/README.md);
this folder holds the copies and helpers that must load without it.

| | |
|---|---|
| Status | **maintained** |
| Run | nothing to run; imported by the apps and packaged by [`@studium/activity-presentation`](../packages/activity-presentation/README.md) |
| Tests | `node --test ui/activity-language.test.mjs`; `.venv/bin/python -m pytest tools` covers the help catalogue |

## Files

| File | Role | Used by |
|---|---|---|
| `context-help.json`, `context-help.mjs`, `context-help.css`, `context-help-runtime.js`, `context-help.d.mts` | authored help topics (French and English, student and teacher) and their escaped HTML renderer | `@studium/activity-presentation` (teacher dashboard, author-web, student runtime), VS Code pane, `tools/contextual_help.py` |
| `scientific-support.mjs`, `scientific-support.css` | render prepared formulas, diagrams, molecules and media assets with local libraries | `@studium/activity-presentation`, activity viewers |
| `activity-language.mjs` | translate presentation text of an activity viewer without touching its controls or data | activities exported by `tools/experience_templates.py` |
| `studium-tokens.css` | offline copy of the design tokens | Observatory |
| `studium-theme.css` | frozen compatibility theme | Observatory, exported activities and learner reports |
| `studium-theme-current.css` | token-native Observatory override | Observatory |
| `sync-studium-tokens.mjs` | regenerates `studium-tokens.css` from `design/tokens.css` | maintainers |

## Design tokens for the Observatory

`design/tokens.css` is the canonical token build. The Observatory cannot serve or import that repository
path at runtime, so `studium-tokens.css` is a deterministic offline copy:

```bash
node ui/sync-studium-tokens.mjs --check
node ui/sync-studium-tokens.mjs --write
```

The generator removes leading zeroes from fractional CSS values (`0.5rem` becomes `.5rem`); the computed
value is unchanged. This keeps withheld telemetry values out of the rendered page text, because the
Observatory privacy checks search the complete HTML, inline styles included.

The Observatory loads three layers in this order:

1. `studium-tokens.css`, generated from the canonical tokens;
2. `studium-theme.css`, the frozen compatibility theme;
3. `studium-theme-current.css`, the token-native Observatory override.

Do not rewrite `studium-theme.css` in place. Portable learner-report verification reconstructs old HTML
exactly, including that stylesheet. A new portable theme needs a new renderer generation while the old
renderer and CSS are kept. The current override can change freely because it is not embedded in those
historical exports.

All three files are local and contain no font or asset URL. The current override uses the dark token
palette through `prefers-color-scheme`, forces the light palette for print, keeps a visible keyboard focus
and includes forced-colour fallbacks.
