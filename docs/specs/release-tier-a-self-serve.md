# Spec — Tier-A release: a colleague can test Studium without the author

Status: **active** · Branch: `chore/release-tier-a` · Author: agentic session, 2026-07-10

## 1. Problem

Studium's substance works. The `atomistique-l1` lesson is complete, the VS Code
extension runs it key-free, the eval harness runs key-free via `--smoke`, `pnpm test`
exits 0 and `pytest` reports 107 passed. Yet **no colleague can get there unaided**,
because every documented on-ramp is broken:

| Symptom | Root cause | Evidence |
|---|---|---|
| Default clone gives stale software | `main` is 24 commits / 8,643 insertions behind `dev` | `git merge-base --is-ancestor origin/main origin/dev` → true |
| README's headline command dies | `eval/run_eval.py --corpus 04` needs `eval/corpus`, a gitignored symlink to a separate private repo | README.md:82 |
| The one working key-free eval path is undocumented | `--smoke` exists (`eval/run_eval.py:19`) but appears nowhere in README | — |
| The one working *interactive* path is unreachable | `fixtures/atomistique-l1/GUIDE-TEST-ELISE.md` (16 KB, complete) is linked from nothing | — |
| Toolchain guesswork | No `engines`, no `packageManager`, no `.nvmrc`; CI pins Node 20 / pnpm 9, dev machine runs Node 24 / pnpm 11 | package.json |
| `python -m venv` fails on a stock Mac | No `python` binary on macOS; no version floor stated | README.md:79 |
| CI red on all 47 runs | `pnpm lint` fails: 40 errors, mostly `no-unused-vars` firing on the underscore convention | `.eslintrc.json` has no `argsIgnorePattern` |
| The e2e lesson demo has never run in CI | `demo-m6` `needs: tauri-build` `needs: test`; `test` always fails at lint | `.github/workflows/ci.yml` |

Scope note: this is **Tier A** — share a private repo with 2–3 named colleagues.
Tier B (public release: LICENSE, vendored-lib attribution, CITATION.cff) is out of
scope here and tracked separately. The full-history secret scan is already clean,
so Tier B is not blocked on a history rewrite.

## 2. Goal

A colleague with a Mac, VS Code, and no knowledge of this repo runs **one command**
after cloning, then presses F5 and answers a chemistry lesson scene. They know what
feedback is wanted and where to send it. They never read `pnpm lint` output.

Non-goal: making `student-runtime` (Tauri) or `author-web` + `teacher-dashboard`
work for testers. VS Code is *the* interactive surface. The naive `pnpm -r build`
is known-red at `teacher-dashboard` and must never appear in tester docs.

## 3. Decisions

- **D1 — Branch.** Fast-forward `main` → `dev` rather than switching the GitHub
  default branch. `main` is a clean ancestor, so `git push origin origin/dev:main`
  is a fast-forward. Anyone who bookmarked `main` then gets current code. Performed
  **last**, after CI is green, so `main` never points at a red tree.
- **D2 — Toolchain pin.** Add `packageManager: "pnpm@9.x"` (exact latest 9.x, verified
  against the npm registry) and `engines: { node: ">=20" }` to the root `package.json`,
  plus `.nvmrc`. The lockfile is `lockfileVersion: '9.0'`, readable by pnpm 9, so this
  is safe. CI's `pnpm/action-setup` then **drops its hard-coded `version: "9"`** and
  reads `packageManager` — one source of truth.
- **D3 — Python floor.** `Python 3.12+`, invoked as `python3.12`, never bare `python`.
  Reconcile the README badge (3.13) and CLAUDE.md (3.12) to 3.12+.
  **Corrected during implementation:** a stock macOS `python3` is `/usr/bin/python3`
  = 3.9.6 (verified on the dev machine), so docs must not say "invoked as `python3`" —
  that silently builds a 3.9 venv. Docs name `python3.12`. Further, the tester's VS Code
  path needs **no** Python at all, and CI's `tester-path` job installs none, so
  `setup.sh` treats Python as **advisory** (warn, never fail).
- **D4 — Entry point.** `TESTING.md` at the repo root is the single tester door. The
  README's Quickstart leads with it. `GUIDE-TEST-ELISE.md` becomes the detailed
  French walkthrough it links to, not an orphan.
- **D5 — One command.** `./setup.sh` performs preflight version checks, then
  `pnpm install && pnpm --filter studium-vscode vendor && pnpm --filter studium-vscode build`,
  and prints the F5 instruction. It must **never** call `pnpm -r build`.
  **Corrected during implementation:** that sequence is not sufficient. The extension
  spawns the `lesson-mcp` server over stdio (`extension.ts:157,183`), and the server
  imports `@studium/llm-client`, which resolves to its **built** `dist/index.js`. A
  fresh clone has none, so F5 died with `ERR_MODULE_NOT_FOUND` — invisible from the
  dev machine, whose `dist/` was left over from earlier work. `setup.sh` therefore
  also runs `pnpm --filter "@studium/lesson-mcp^..." run build` (the `^...` filter is
  *dependencies-only*, so a future dist-backed dependency needs no script edit) and
  asserts `packages/llm-client/dist/index.js` exists before declaring success.
  This is why acceptance #4 must be run from a real clone, not the dev tree.
  **The same contamination hid a CI blocker:** `pnpm test` (the `test` job) also failed on a
  clean checkout — `vitest` resolves `@studium/llm-client` through package.json `main` too, so
  six `lesson-session` test files died. Since `tester-path`, `tauri-build` and `demo-m6` all
  declare `needs: test`, CI would have gone red and skipped the very job that proves the tester
  path. Fixed by a root `build:libs` script (`pnpm --filter "./packages/**" run build`) invoked
  by **both** `setup.sh` and CI, so the two cannot drift. Never `pnpm -r build` — that is the
  apps, including the known-red `teacher-dashboard`.
- **D6 — Eval path is secondary.** The README's eval quickstart leads with `--smoke`
  (works on any clone) and marks `--corpus NN` as requiring the separate corpus repo.
- **D7 — Lint fix is config-first.** Add `argsIgnorePattern`/`varsIgnorePattern`/
  `caughtErrorsIgnorePattern: "^_"` to `.eslintrc.json`; that clears the underscore
  errors. The residual genuinely-dead symbols and 7 `prefer-const` are fixed in
  source. No new eslint plugin is introduced: the two
  `react-hooks/exhaustive-deps` errors are "rule definition not found" raised by
  disable-comments for a plugin that was never installed — delete the comments.
  **Corrected during implementation:** 7 of the "dead" symbols are **not** dead —
  `scene_id`, `missed`, `is_revision`, `question_id`, `synthesis_id`
  (`telemetry-events/tests/round-trip.test.ts`), `validated_by`
  (`lesson-bundle-schema/tests/lesson-bundle.test.ts`) and `_correct`
  (`lesson-session-host/src/public-scene.ts`) are **rest-sibling destructures that
  deliberately omit a field** (`const { scene_id, ...rest } = valid`), which is the
  entire point of those negative tests. Deleting them would have silently inverted
  the assertions. The correct fix is `ignoreRestSiblings: true`, not source edits.
- **D8 — CI must prove the tester path.** Decouple `demo-m6` from `tauri-build`
  (the e2e harness does not need a signed desktop bundle), and add a job that runs
  the *actual* tester sequence — `setup.sh` then the `studium-vscode` driver suite —
  so the onboarding path is regression-tested, not just asserted.
  **Extended after the first real run:** CI should also stop proving what we do *not* ship.
  `tauri-build` and `demo-m6` both exercise `student-runtime`, the Tauri desktop app that
  the Non-goal above and `TESTING.md` §8 place out of scope — `demo-m6` literally runs
  `pnpm tauri:build --debug` and drives it with `tauri-driver` + WDIO. On push they cost
  ~20 min (Ubuntu, rebuilding `cargo-tarpaulin` from source) plus a macOS runner billed at
  10×, while the two jobs that gate the shipped surface, `test` and `tester-path`, take 2
  and 1 minute. Both Tauri jobs are therefore `workflow_dispatch`-only. Push CI now runs
  exactly what a colleague depends on.
- **D9 — Python deps in CI come from `requirements.txt`**, not a bare
  `pip install pydantic pytest fastapi httpx`, so CI and a colleague's venv agree.
  **Corrected after the first real CI run (the third dev-tree contamination):** that alone
  is not enough. `packages/telemetry-events/tests` imports `telemetry_events`, which exists
  only once the package is installed (its module maps to `src/`, so pytest's `pythonpath`
  cannot substitute). It was present in the dev `.venv` from earlier work, so bare `pytest`
  passed locally and failed CI collection. Two fixes: `requirements.txt` now installs
  `-e ./packages/telemetry-events`, and that package's `requires-python` was relaxed from
  `>=3.13` (a stale over-pin — it imports only `typing` and `pydantic`) to `>=3.12`, the
  repo's declared floor, since the `>=3.13` pin made it uninstallable on CI's Python 3.12.
  Verified in a throwaway `python3.12 -m venv`: `pip install -r requirements.txt && pytest`
  → 107 passed.
- **D10 — Feedback channel.** A GitHub issue form (`.github/ISSUE_TEMPLATE/`) plus an
  explicit "email the maintainer" line. Testers have `write` access already
  (`elisejdumont`, `taojiang9914`), so issues are open to them.

## 4. Deliverables

New files:
- `TESTING.md` — the tester door (English, links the French guide).
- `setup.sh` — preflight + install + vendor + build, executable.
- `.nvmrc`
- `.github/ISSUE_TEMPLATE/tester-feedback.yml`, `.github/ISSUE_TEMPLATE/config.yml`

Modified:
- `package.json` — `engines`, `packageManager`
- `README.md` — Quickstart rewritten (VS Code first, `--smoke` second), Documentation
  and License sections corrected
- `.eslintrc.json` — unused-vars ignore patterns
- ~15 source files — remove dead symbols, `prefer-const`, stale disable-comments
- `.github/workflows/ci.yml` — read `packageManager`; `requirements.txt`; decouple
  `demo-m6`; add the tester-path job
- `CLAUDE.md` — pytest invocation reconciled to bare `pytest` (`pytest.ini` already scoped
  `testpaths` to `packages`, so it needed no edit), and `python3.12 -m venv`
- `docs/user/student-guide.md`, `docs/user/teacher-guide.md` — dated banner pointing
  at `TESTING.md`, since both predate the judgment loop

## 5. Acceptance criteria

Each is a command with an expected exit code, not a claim.

1. `pnpm lint` → exit 0.
2. `pnpm test` → exit 0 (no regression from the lint source edits).
3. `.venv/bin/python -m pytest` → exit 0, and the invocation printed in `CLAUDE.md`
   is byte-identical to the one CI runs.
4. From a **fresh clone of this branch into an empty directory**: `./setup.sh` exits 0
   and leaves `apps/studium-vscode/dist/extension.js` and `apps/studium-vscode/media/vendor/`
   populated.
5. Every command block in `TESTING.md` has been executed verbatim from that fresh
   clone and exits 0 (except the F5 step, which is manual).
   **Scoped during implementation:** #4/#5 were verified against a clone of *this branch*.
   The §3 block clones the **default branch**, which today is `main` and carries neither
   `setup.sh` nor `TESTING.md`, so that block only becomes verbatim-green once D1
   fast-forwards `main` → `dev`. Re-run it once after D1 to close the criterion literally.
6. `pnpm -r build` never appears as a runnable instruction. It may appear only in prose
   that warns against it, so the check is
   `grep -n "pnpm -r build" TESTING.md setup.sh | grep -viE "do not|does not|never"` → 0 lines.
7. `git merge-base --is-ancestor origin/main HEAD` → true (fast-forward stays legal).

## 6. Risks

- **The F5 step cannot be automated here.** Acceptance #4/#5 prove everything up to
  the Extension Development Host. The owner must do one manual F5 before inviting anyone.
- **Pinning pnpm 9 via corepack changes the maintainer's local `pnpm`.** Intended, but
  it will surprise. Documented in TESTING.md.
- **Removing "dead" symbols can break a test that imports them.** Acceptance #2 is the
  guard; any symbol whose removal breaks a test stays, with an `_` prefix instead.
- **`demo-m6` may fail the moment it is allowed to run**, having never executed. That
  is a discovery, not a regression; if it fails, it gets its own fix and does not
  block Tier A (the tester path job in D8 is the one that gates onboarding).
  **Outcome:** it did fail, at *Install Python dependencies*, and the cause is that its
  setup has never been valid — `services/planner` has no `pyproject.toml`/`setup.py` yet is
  editable-installed; `scene-synth` and `analytics-collector` pin `requires-python >=3.13`
  against CI's 3.12; and `analytics-collector` declares
  `telemetry-events @ file:../../packages/telemetry-events`, a relative path that escapes the
  repo root. Rather than leave the repo permanently red (the confidence problem this release
  exists to fix) or mask it with `continue-on-error`, `demo-m6` is now `workflow_dispatch`-only
  with the reason recorded in the workflow. Repairing it is a separate task.
