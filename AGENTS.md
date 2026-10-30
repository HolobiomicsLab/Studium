# AGENTS.md — entry point for coding agents (any harness)

Most agent harnesses read `AGENTS.md` at the repository root and nothing else. The repository's
conventions are in [`CLAUDE.md`](CLAUDE.md) (written in French) and apply whatever the model or tool: the
file name is an accident of tooling, not a scope. Read it before you write anything; this file does not
replace it, it adds what changes when the harness is not Claude Code.

The remote is `HolobiomicsLab/studium`; a local directory named `prototype-build` is the same repository
under its historical name.

## Reading order

1. `CLAUDE.md` — toolchain, virtualenv, test commands, Python module naming.
2. [`docs/develop/architecture.md`](docs/develop/architecture.md) — units, data flow, authoring routes.
3. [`docs/develop/testing.md`](docs/develop/testing.md) — every suite and what CI runs.
4. [`docs/internal/agent-log.md`](docs/internal/agent-log.md) — the journal of significant commits; add an
   entry at each significant commit.
5. [`docs/design-records/`](docs/design-records/index.md) — specifications and decisions, when the change
   touches one.

### Optional, for maintainers with the development hub

The project is steered from a private hub cloned next to this repository as `../studium_dev/`. If you have
it, also read `../studium_dev/MANIFEST.yaml` (the repositories of the project), `../studium_dev/STATUS.md`
(the current state, which this repository deliberately does not carry) and `../studium_dev/HANDOFF.md` (what
to do next and what not to do). `../Studium/AGENTS.md`, from the earlier design repository, still states
the working protocol (source claims, no silent decision, Pydantic validation of every model call, human
review before anything reaches students, atomic commits); its phase framing is out of date. Without the
hub, this repository and its `docs/` are enough to build, test and change the code.

## What Claude Code enforced and other harnesses do not

Hooks enforced some of these rules mechanically. Elsewhere nothing enforces them: hold them yourself.

| Rule | What to do |
| --- | --- |
| Explicit staging | never `git add -A` or `git add .`; name each file |
| No history rewriting | no `rebase`, `push --force`, branch deletion or bare `stash`; move forward by adding commits |
| Push only on approval | ask the owner before every push; pull requests, releases and tags are not yours to create |
| Test edits are decisions | tests are part of the contract: changing one is a decision you state, never a side effect of a fix |
| Stay in this repository | do not write into sibling repositories (for maintainers: `studium_manuscript`, `LabOS`) |

Two more, which never depended on a hook: never inspect or copy a secret value; never accept a `Draft`
intent on the owner's behalf. An agent proposes; only the owner accepts.

## Gates (pass them before you say "green")

```bash
export STUDIUM_EPHEMERAL=1                    # learner state in memory; nothing written under ~/.studium
pnpm build:libs                               # packages that resolve through ./dist, on a fresh checkout
pnpm lint                                     # zero errors
pnpm test                                     # every TypeScript package, app and VS Code driver
.venv/bin/python tools/pytest_all.py          # success: exit 0, "N suites, 0 failing"
bash tools/bundle_lint.test.sh
node tools/docs/check.mjs                     # when you touched documentation, a tool or the bundle schema
pnpm --filter @studium/<pkg> exec tsc --noEmit
```

Anything that starts the stdio MCP server (`pnpm --filter @studium/lesson-mcp start`, the smoke scripts,
the drivers) must run with `STUDIUM_EPHEMERAL=1` in tests and demos, or it writes into the user's home.

The diagnostics in `fixtures/atomistique-l1/` (`*_check.mjs`, run with
`node_modules/.pnpm/node_modules/.bin/tsx`) always exit 0: they report, they do not guard. A change in
their numbers is a signal to read, not a test failure.

## Traps

- **Fetch before you compare branches.** The local ref of a branch you never check out does not move by
  itself. Compare with `git fetch origin` then `origin/<branch>`, or with `git ls-remote origin main dev`.
  Ongoing work lands on `dev` (or a feature branch); `main` receives batched integrations.
- **Sibling worktrees may exist.** A branch held by another worktree cannot be checked out here. Run
  `git worktree list` before you are surprised.
- **`fixtures/data/` is regenerated** by `fixtures/atomistique-l1/teacher_check.mjs` at each run and is
  ignored by Git: it is the runtime's layout, not what the analytics collector reads.
- **Two Python services import a module named `tests.conftest`**, so one pytest process over `services/`
  fails at collection. Use `tools/pytest_all.py`, which runs one process per suite.
