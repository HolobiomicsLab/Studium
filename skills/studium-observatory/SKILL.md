---
name: studium-observatory
description: Run and read the Studium Observatory — the read-only localhost view over emitted ASTRA provenance, evaluation runs and validity suites. Use when asked to inspect, demo or debug what Studium produced (course decisions, findings, evidence, validator verdict, persona sessions, scorecards), or to build a course to look at when none exists on disk.
---

# studium-observatory — one read-only window on what Studium emitted

The Observatory (`services/observatory/`, port 8004) renders artifacts that already
exist on disk. It is an operator tool, not a learner surface. Three invariants shape
every step below:

- **It only reads.** Every route is a GET; a full crawl changes no file. The one
  subprocess it ever spawns is the ASTRA validator, and only on the two validation
  routes.
- **It shows nothing about a person.** No learner id, pseudonym or free-text
  telemetry field is copied into any view — the readers filter before the templates
  see the data (`observatory_evaluation.FORBIDDEN_KEYS`). Eval personas are synthetic
  and labelled so on screen.
- **It renders what is there, and says what is not.** A broken file yields
  `(unreadable <file>: <TypeName>)` or `(missing <file>)` and a 200; only a missing
  course root stops start-up.

Read `services/observatory/README.md` for the service contract and
`docs/guides/observatory.md` for the operator page. This skill is the part that is
neither: what actually happens when you try to run it on a fresh checkout.

## 1. The first trap: there is nothing to look at

Both default course roots (`services/planner/.lwg`, `<repo>/.lwg`) are **absent on a
clean checkout**, so the README's own start command exits 2 before binding a port.
Nothing is wrong with the tool — no course has been emitted. Build one first (§2),
or pass `--course-root` at a directory that holds one.

`--eval-root` is different: `eval/reports/` is committed and full (about 45 real
runs), so the runs and validity tabs work immediately.

## 2. Make a course to look at

| Want | Command | Cost |
| --- | --- | --- |
| A validator-green course, no model call | `.venv/bin/python tools/astra_validate_check.py --out $S/course-demo` | free, ~1 s |
| A course with **real findings and evidence** | §3 | one paid call |

The validator fixture uses a deterministic StubAgent and emits structural findings
without a paid call. These are synthetic fixture findings, not a live-model result.
The ordinary GraphAgent mock can still produce an empty graph; inspect the actual
`n_findings` before claiming the evidence surface was exercised. The dedicated
`tools/audit-mystra-fixtures.py` also emits explicit synthetic quotations and two
bundle reviews for the viewer audit.

## 3. A live course (paid — ask first)

Verified 2026-09-04: exactly **one** paid call, and it produced 2 findings, 2
evidence anchors and 1 model-derived structural decision.

```bash
# the shim reads ANTHROPIC_API_KEY, which exists only in a login shell -> zsh -lic
PORT=8799 node apps/lesson-mcp/anthropic_shim.mjs &     # inside zsh -lic, killed after
STUDIUM_LLM_MODE=litellm LITELLM_BASE_URL=http://127.0.0.1:8799 LITELLM_API_KEY=shim \
PYTHONPATH=<repo>/services/planner/tests \
.venv/bin/python -c 'import astra_course_fixture as F; ...'   # GraphBuilder -> emit_astra -> write_astra_set
```

Four things to get right:

- `STUDIUM_LLM_MODE` is read **at module import time** (`agents/base.py`). Exporting
  it after the process starts, or from a later shell, does nothing.
- Import `astra_course_fixture` **first**; it inserts all four `sys.path` entries the
  other imports need.
- Do **not** go through `POST /plan`: it costs 3-7 calls, and until
  INT-STUDIUM-016 lands it swallows a `learning_workflow_schema` import error and
  returns 200 with no artifacts at all.
- Leave `STUDIUM_PERSPICACITE_ENABLED` unset. The client requires the literal string
  `on`; `eval/README.md`'s `=1` is wrong and buys you nothing here.

**Judge the run on the printed finding count, not on the files.** Five independent
paths — a fail-soft swallow, a JSON parse failure, the shim's hardcoded 512-token
cap, a prompt the model answers in the wrong id format, an endpoint the builder then
drops — all produce a byte-identical empty artifact that still validates green.

## 4. Start it

From the repository root, with the venv interpreter:

```bash
.venv/bin/python services/observatory/observatory_app.py \
  --course-root $S/course-demo/.. --eval-root eval/reports --validity-root eval/validity --port 8004
```

Or `uvicorn observatory_app:app --port 8004` **from `services/observatory/`** — the
modules are flat with no `__init__.py`, so that cwd is required, and relative flags
resolve against it.

Through the Browser pane, `preview_start` with the `studium-observatory` entry in
`/Users/nothiasl/git/.claude/launch.json`. Read the entry before trusting it: as of
2026-09-04 its `--course-root` points at a **scratchpad path from a past session**,
which is temporary and probably gone. Repoint it, or pass the flag yourself. Never
start it as a Bash background process.

Use `.venv/bin/python`, not the system one: the validator is looked up next to the
running interpreter (`Path(sys.executable).with_name("astra")`), so a system python
reports `not_installed` while `.venv/bin/astra` sits right there.

## 5. Routes

All application routes are GET-only; the current inventory is in `observatory_app.py`. Every HTML page has a JSON twin — prefer the twin when you are
reading programmatically, and diff it across changes.

| HTML | JSON | Shows |
| --- | --- | --- |
| `/` | `/api/index` | problems banner, courses, runs, validity suites |
| `/courses/{id}` | `/api/courses/{id}` | decisions, universes and their diff from default, exploration trace, findings with evidence, review |
| `/courses/{id}/mystra` | `/api/courses/{id}/mystra` | printable teacher/reviewer dossier, all analyses and bundles, cached validation status |
| `/courses/{id}/review` | `/api/courses/{id}/review` | per-bundle scene verdicts, skipped scenes and calibration |
| `/sessions` and `/sessions/{id}` | corresponding `/api/sessions` routes | the existing source comparison with privacy suppression |
| `/harness` | `/api/harness` | explicitly configured session workspaces |
| `/courses/{id}/provenance.myst.md` | — | the same text `astra_render` writes |
| `/courses/{id}/validation` | `/api/courses/{id}/validation` | the real validator's verdict — **the only routes that spawn a process** |
| `/eval/runs/{id}` | `/api/eval/runs/{id}` | dimension scores, findings, persona sessions, `report.md` |
| `/eval/validity` | `/api/eval/validity` | suite scorecards |

An unknown id gives 404 `{"error": "unknown course"}` / `{"error": "unknown run"}`.
`HEAD /` gives 405 — the routes declare GET only.

## 6. Configuration

Environment variables (`observatory_config.py` is the authoritative inventory), each overridden by its CLI
flag. One name matters more than the rest: the course root is
**`STUDIUM_LWG_OUT_DIR`** — the planner's own variable, deliberately shared so that
what the planner wrote is what the Observatory reads. There is no
`STUDIUM_OBS_COURSE_ROOT`; setting that name configures nothing. The others are
`STUDIUM_OBS_COURSES` (extra course dirs, `os.pathsep`-separated),
`STUDIUM_OBS_EVAL_ROOT`, `STUDIUM_OBS_VALIDITY_ROOT`, `STUDIUM_OBS_HOST`,
`STUDIUM_OBS_PORT`, `STUDIUM_OBS_VALIDATOR_TIMEOUT`.

A bad value never raises: a non-integer port keeps 8004 and adds a line to the
index's problems banner. Read that banner first when a page looks empty — it names
every missing root.

## 7. What counts as discoverable

A **course** is a direct child of the course root containing `astra.yaml`. A **run**
is a direct child of the eval root containing `audit.json` or `sessions/`. A
**suite** is a direct child of the validity root containing `README.md`. Nothing
recurses, nothing is cached, and every request re-scans. A symlink escaping its root
is reported in the problems banner and not listed; a duplicate id gets `~2`.

Ids are only ever resolved through the discovery maps — no URL segment is joined to
a root.

## 8. The validator cache

Keyed `<n files>:<newest mtime ns>` over `*.yaml` and `*.json` in the course tree.
Touch any file and the next `/validation` re-runs. Five statuses: `ok`, `failed`,
`timed_out`, `not_installed`, `not_run`. `not_installed` is deliberately **not**
cached, so installing astra-tools takes effect without a restart. Default timeout
60 s; a hang gives `timed_out` and a 200 page, never a dead request.

## 9. Tests and screenshots

`pytest.ini` sets `testpaths = packages`, so the Observatory suite runs only when you
name it:

```bash
.venv/bin/python -m pytest services/observatory -q -p no:cacheprovider
```

For a screenshot, use headless Chrome — the Browser pane returns a blank image once
the page is scrolled:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --window-size=1400,2400 --virtual-time-budget=3000 \
  --screenshot=out.png http://127.0.0.1:8004/
```

Measured on the real `eval/reports`: `/api/index` 0.19 s over 45 runs; 102 URLs
crawled in 0.90 s, zero non-200.

## 10. Gotchas

- A blank findings section usually means a mock-mode course (§2), not a broken page.
- `services/observatory` is not on the default pytest path (§9).
- The service has no `__init__.py`; `uvicorn` needs the service directory as cwd.
- Slices 1–3 are implemented: provenance/evaluation, per-bundle Review, Sessions
  and Harness. MySTRA adds a printable HTML view and complete MyST export. Read
  `docs/guides/mystra-reviewer.md` for the verified no-model fixture/audit recipe.
- ASTRA validation uses `--skip-evidence`: a schema pass is neither checked source
  evidence nor teacher approval. The viewer does not write an approval or publish.

## 11. Pointers

`services/observatory/README.md` (service contract, env table, privacy statement),
`docs/guides/observatory.md` (operator page), `skills/studium-harness/SKILL.md`
(running a lesson, the eval harness), hub `~/git/studium_dev`
(`docs/superpowers/specs/2026-09-03-studium-observatory-design.md` for the design and
its decided open questions).
