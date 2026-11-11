English · [Français](CONTRIBUTING.fr.md)

# Contributing to Studium

Thank you for helping. This page tells you how to set up a checkout, which checks a change must pass, and what a pull request needs before review. Everyone taking part agrees to the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the [security policy](SECURITY.md), never in a public issue.

## Before you start

- For anything larger than a small fix, open an issue first and describe the problem, not only the solution. Some choices (licence, publication, releases) belong to the project owner.
- Current work lands on the `dev` branch; `main` receives integrations in batches. Branch from `dev`.
- Agents and humans follow the same conventions: [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md).
- Your contribution is licensed like the files it changes: Apache-2.0 for code, CC BY 4.0 for documentation and project lessons (see [NOTICE](NOTICE)). Do not paste third-party text whose licence you do not know.

## Set up a checkout

Toolchain: Node 22 (`.nvmrc`; the tests need 22.22.2 or newer, or 24.15 or newer, because of jsdom 31, and packaging the VSIX needs Node 22 or newer because of vsce 4; Node 20 no longer runs either), pnpm 9.15.9 (pinned in `package.json`, provided by `corepack enable`), Python 3.12. Rust is needed only for the frozen Tauri app.

```bash
corepack enable
pnpm install
pnpm build:libs                     # workspace libraries resolve through their dist/
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Always use the `.venv` interpreter, never the system Python. When you start the MCP server or run a driver by hand, set `STUDIUM_EPHEMERAL=1` so nothing is written to your own `~/.studium`.

## Checks a change must pass

Run these before you say a change is ready. CI runs the same steps with `STUDIUM_EPHEMERAL=1`.

```bash
pnpm lint
pnpm build                          # the whole workspace compiles
pnpm test                           # every TypeScript package and the extension drivers
.venv/bin/python tools/pytest_all.py  # every Python suite, one process each; success = exit 0, "N suites, 0 failing"
pnpm --filter @studium/<package> exec tsc --noEmit
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_lint.mjs
bash tools/bundle_lint.test.sh
STUDIUM_EPHEMERAL=1 node apps/lesson-mcp/scripts/headless_smoke.mjs
```

If you changed the design tokens, also run `node design/scripts/check-contrast.mjs`. The diagnostics under `fixtures/atomistique-l1/` report numbers and always exit 0; a change in their numbers is a signal to explain, not a test failure. [Testing](docs/develop/testing.md) describes every suite.

## Tests first

- Write the failing test before the code (rule 002). Each new behaviour has a test that fails without it.
- Every call to a language model validates its output against a schema (Pydantic on the Python side, Zod on the TypeScript side).
- Tests are part of the contract. Changing or deleting an existing test is a decision you state in the pull request, with the reason; it is never a side effect of making a fix pass. Never weaken an assertion to get a green run.
- Use an injected clock, not the wall clock, for anything that depends on time (spaced review in particular).

## Teaching and learner data

- No lesson reaches students without a teacher's review and approval (rule 003). Do not add a path that bypasses it.
- Never commit learner data, telemetry, the evaluation corpus (`eval/corpus/`, third-party material), API keys or tokens.
- A feature that computes a class figure keeps the minimum of five learners and never narrows to one person.

## Documentation

- English and French pages are sibling files: `page.md` is English, `page.fr.md` is French, each starting with a language switch line. A user-facing change updates both. Generated reference pages stay in English with a French introduction; design records keep their original language.
- Document only what the code does at that revision; remove what no longer exists.
- Follow the [documentation style](docs/develop/docs-style.md).

## Commits

- Conventional style: `type(scope): subject`, for example `fix(vscode): keep the scene after a failed submit`. Types in use: `feat`, `fix`, `test`, `docs`, `ci`, `chore`. The subject is imperative and says what changes; the body says why and how it was verified.
- One coherent change per commit. Stage files by name; avoid `git add -A` and `git add .`.
- Do not rewrite shared history: no rebase of published branches, no force-push.
- A significant commit adds an entry to the agent log ([`docs/internal/agent-log.md`](docs/internal/agent-log.md)). Past session handoffs are archived in [`docs/internal/handoff-history.md`](docs/internal/handoff-history.md).

## Pull requests

Open the pull request against `dev`. The [template](.github/PULL_REQUEST_TEMPLATE.md) asks for:

- what changed and why, with the linked issue;
- the checks you ran and their result;
- every existing test you changed, and why;
- English and French documentation updated together;
- no learner data, key or third-party material in the diff;
- screenshots in light and dark themes for a visible change to the VS Code pane or a web page.

A maintainer reviews for correctness, privacy and the contracts above. Merging, releases and tags are done by the maintainers.
