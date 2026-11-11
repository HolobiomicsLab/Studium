English · [Français](testing.fr.md)

# Testing

Run these checks before you say a change is green. They are the same commands CI runs, so a local pass
predicts a CI pass. For a tester walking through a lesson rather than running suites, see
[TESTING.md](../../TESTING.md).

## Before you start

```bash
pnpm install
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
pnpm build:libs                # some packages resolve through ./dist, absent on a fresh checkout
export STUDIUM_EPHEMERAL=1     # keep learner state in memory, as CI does
```

Without `STUDIUM_EPHEMERAL=1`, anything that starts the stdio MCP server writes learner state under
`~/.studium`. Always use the virtualenv's Python, never the system one.

## The gates

| Command | What it covers |
|---|---|
| `pnpm lint` | ESLint over every `.ts` and `.tsx` file; zero errors expected |
| `pnpm build` | the whole workspace compiles |
| `pnpm test` | every TypeScript package and app (`pnpm -r test`), including the VS Code drivers, then the status-line script and the release tools (`pnpm test:tools`; no network, nothing is sent) |
| `.venv/bin/python tools/pytest_all.py` | every Python suite, one pytest process each |
| `bash tools/bundle_lint.test.sh` | contract tests of the lesson bundle linter |
| `node apps/lesson-mcp/scripts/headless_smoke.mjs` | a bare MCP client drives a real lesson over stdio |

A run of `tools/pytest_all.py` succeeds with exit code 0 and a last line of the form `N suites, 0 failing`.

## TypeScript suites

Each package and app has a `test` script; `pnpm test` runs them all. Most use Vitest, with tests next to
the code (`*.test.ts`). To run one unit:

```bash
pnpm --filter @studium/lesson-session-host test
pnpm --filter @studium/lesson-mcp test
pnpm --filter @studium/lesson-mcp exec tsc --noEmit
```

Notable suites:

| Suite | What it proves |
|---|---|
| `apps/lesson-mcp/src/learn-and-review.e2e.test.ts` | from "learn X" to the first question in six Studium tool calls, then a review a week later after a server restart |
| `packages/lesson-session-host` (`host.*.test.ts`, `public-scene.test.ts`) | redaction of answer keys, release of passages on leave, study plan, durable state |
| `apps/lesson-server` (`server.redaction.test.ts`) | the HTTP server never sends an answer key |
| `apps/teacher-dashboard` | dashboard pages and chart text alternatives (Vitest); `pnpm --filter @studium/teacher-dashboard test:e2e` runs Playwright integration tests |
| `packages/activity-presentation` | the viewer language helpers (`node --test` on `ui/activity-language.test.mjs`) |

### VS Code drivers

The extension is tested by **drivers**: plain TypeScript scripts under `apps/studium-vscode/src/*.driver.ts`,
run with `tsx`, that exercise the extension without launching VS Code. Some render the lesson pane in
jsdom and click its controls; `extension-host.driver.ts` runs the extension against a fake `vscode` module
and the real MCP server. The list of drivers that `pnpm test` runs is the `test` script of
[`apps/studium-vscode/package.json`](../../apps/studium-vscode/package.json). To run one:

```bash
pnpm --filter studium-vscode test                                   # typecheck, then every driver
node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/webview-pane.driver.ts
```

## Python suites

[`tools/pytest_all.py`](../../tools/pytest_all.py) exists because two services both import a module named
`tests.conftest`, so a single pytest process over `services/` aborts at collection. The wrapper runs one
process per suite. Suites are discovered, not listed: a top-level folder that holds test files directly is
one suite (`tools/`); otherwise each child folder holding tests is a suite (`services/planner`,
`packages/lesson-bundle-schema`, `eval/tests`, and so on). The run fails if any test file is reached by no
suite.

```bash
.venv/bin/python tools/pytest_all.py              # all suites
.venv/bin/python tools/pytest_all.py -- -x        # extra arguments go to every pytest process
.venv/bin/python -m pytest services/planner -q    # one suite
```

A bare `pytest` at the root only collects `packages/` (see `pytest.ini`): do not use it as a gate.

## Other checks

| Command | When |
|---|---|
| `node tools/bundle_lint.mjs <lesson.json>` | after editing a lesson by hand |
| `node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/drive_check.mjs` (and the other `*_check.mjs` there) | diagnostics of the reference lesson; they always exit 0, so read their output |
| `node design/scripts/build-tokens.mjs --check` and `node design/scripts/check-contrast.mjs` | after changing design tokens |
| `node apps/lesson-mcp/scripts/http-smoke.mjs <new folder>` | after changing the HTTP adapter; writes its report into a folder that must not exist yet |
| `tools/audit-*.mjs` | UI audits on synthetic fixtures; see [the audit record](../design-records/audits/live-ui-audits.md) |

The evaluation harness under [`eval/`](../../eval/README.md) measures lessons and runs; it is not a gate.

## CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every push and on pull requests to
`main`, with `STUDIUM_EPHEMERAL=1` for every job.

| Job | Runs | Steps |
|---|---|---|
| Lint + Test | every push | install with `--frozen-lockfile`, blocking audit of critical production advisories, lint, build, TypeScript tests, bundle lint, headless MCP smoke, Python suites, ASTRA validator, planner graph build, Observatory tests |
| Tester onboarding path | every push | `./setup.sh` from a fresh clone, then the VS Code driver suite |
| VSIX + standalone MCP server | every push | package and check the VSIX, start the bundled `lesson-mcp.cjs` over stdio, upload both (see [release](release.md)) |
| Tauri build, Demo M6 | manual dispatch only | the frozen desktop app on macOS and Linux, then the end-to-end demo |

Dependabot opens grouped weekly update pull requests for npm, pip and GitHub Actions.

## Rules for tests

Tests are part of the contract. Changing an existing test is a decision you state in the commit message,
never a side effect of a fix. A new behaviour comes with a test that fails without it.
