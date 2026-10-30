---
name: studium-observatory
description: Run and read the Studium Observatory, the read-only localhost view over emitted ASTRA provenance, MySTRA reviewer reports, evaluation runs, validity suites, class sessions and agentic-session workspaces. Use when asked to inspect, demo or debug what Studium produced (course decisions, findings, evidence, validator verdict, persona sessions, scorecards), or to build a course to look at when none exists on disk.
---

# studium-observatory: one read-only window on what Studium emitted

The Observatory (`services/observatory/`, default `127.0.0.1:8004`) renders artifacts
that already exist on disk. It is an operator and teacher tool, not a learner surface.
Three invariants:

- **It only reads.** Every route is a GET. The one subprocess it starts is the ASTRA
  validator, on the two validation routes.
- **It shows nothing about a person.** No learner id, pseudonym or free-text telemetry
  field reaches a view: the readers strip `observatory_evaluation.FORBIDDEN_KEYS` before
  the templates see the data. Evaluation personas are synthetic and labelled so.
- **It renders what is there and says what is not.** A broken file yields
  `(unreadable <file>: <TypeName>)` or `(missing <file>)` and a 200; a misconfigured
  root appears in the problems banner of `/`.

`services/observatory/README.md` is the service contract and
[Observatory](../../docs/teach/observatory.md) the user page. This skill covers what
happens when you run it on a fresh checkout.

## 1. The first trap: nothing to look at

Both default course roots (`services/planner/.lwg`, then `.lwg` at the repository
root) are absent on a clean checkout, so a start without `--course-root` or `--course`
exits with code 2 before binding a port. Nothing is broken: no course was emitted.
Build one (section 2) or point the flags at a folder that holds one.

`--eval-root` is different: `eval/reports/` is committed, so the run and validity pages
work at once.

## 2. Make a course to look at

```bash
.venv/bin/python tools/astra_validate_check.py --out work/course-demo
```

This builds the planner's ASTRA set with a deterministic stub agent (no model call),
plus one scene-review document, writes `work/course-demo/astra.yaml`, and runs the
real validator. Its findings are synthetic fixture findings, not a live-model result.
`tools/audit-mystra-fixtures.py NEW_DIR` writes explicit synthetic quotations and two
bundle reviews for a MySTRA audit; the recipe is in
[Observatory](../../docs/teach/observatory.md#try-it-without-your-own-data).

A course from the teacher route is any folder where `tools/experience_review.py` wrote
`astra.yaml`.

## 3. A live course (paid: ask first)

A course with real model findings needs a configured model, which is a paid route and
needs the owner's go. If you go through the local Anthropic shim
(`apps/lesson-mcp/anthropic_shim.mjs`, port `PORT`, default 8799, key from
`ANTHROPIC_API_KEY`), know its limits:

- Set `STUDIUM_LLM_MODE=litellm`, `LITELLM_BASE_URL` and `LITELLM_API_KEY` in the same
  command that starts the Python process; without a supported mode the planner answers
  503 (`planner model not configured`).
- The shim caps every answer at 512 tokens.
- Judge the run on the printed finding count, not on the files. A fail-soft swallow, a
  JSON parse failure, a truncated answer, ids in the wrong format or a dropped endpoint
  all produce an empty artifact that still validates green.
- Leave `STUDIUM_PERSPICACITE_ENABLED` unset unless you want literature enrichment; the
  planner enables it only for the literal value `on`.

## 4. Start it

From the repository root, with the venv interpreter:

```bash
.venv/bin/python services/observatory/observatory_app.py \
  --course work/course-demo --eval-root eval/reports --validity-root eval/validity --port 8004
```

Open `http://127.0.0.1:8004/`. Use `.venv/bin/python`, not a system Python: the
validator is looked up next to the running interpreter, so a system Python reports
`not_installed` while `.venv/bin/astra` exists. Alternatively run `uvicorn
observatory_app:app --port 8004` from `services/observatory/` (the modules are flat,
with no `__init__.py`, so that cwd is required and relative flags resolve against it).

It binds the loopback interface; another `--host` prints a warning. There is no login:
never expose it.

## 5. Routes

All routes are GET; the inventory is in `observatory_app.py`. Every HTML page except
the MyST export has a JSON twin: prefer the twin when reading programmatically.

| HTML | JSON | Shows |
| --- | --- | --- |
| `/` | `/api/index` | problems banner, courses, runs, validity suites |
| `/courses/{id}` | `/api/courses/{id}` | decisions, universes and their diff from default, exploration trace, findings with evidence, review |
| `/courses/{id}/mystra` | `/api/courses/{id}/mystra` | printable reviewer dossier, cached validation status |
| `/courses/{id}/review` | `/api/courses/{id}/review` | per-bundle scene verdicts, worst first, and calibration |
| `/courses/{id}/provenance.myst.md` | none | the MyST page `tools/astra_render.py` writes |
| `/courses/{id}/validation` | `/api/courses/{id}/validation` | the real validator's verdict; the only routes that start a process |
| `/eval/runs/{id}` | `/api/eval/runs/{id}` | dimension scores, findings, persona sessions, `report.md` |
| `/eval/validity` | `/api/eval/validity` | suite scorecards |
| `/sessions`, `/sessions/{course}` | `/api/sessions`, `/api/sessions/{course}` | session sources side by side, with privacy suppression |
| `/harness` | `/api/harness` | configured agentic-session workspaces (`index.json`, `task.md`, `feedback.md`) |

An unknown id gives 404 (`{"error": "unknown course"}` or `{"error": "unknown run"}`).
`HEAD /` gives 405.

## 6. Configuration

`observatory_config.py` is the authoritative inventory; each variable is overridden by
its flag. The course root is **`STUDIUM_LWG_OUT_DIR`**, the planner's own variable, so
what the planner wrote is what the Observatory reads; there is no
`STUDIUM_OBS_COURSE_ROOT`. The others: `STUDIUM_OBS_COURSES` (extra course folders,
separated by the platform path separator), `STUDIUM_OBS_EVAL_ROOT`,
`STUDIUM_OBS_VALIDITY_ROOT`, `STUDIUM_OBS_ANALYTICS_DATA_DIR`,
`STUDIUM_OBS_SESSIONS_ROOT`, `STUDIUM_OBS_SESSION_DIRS`, `STUDIUM_OBS_HARNESS_REFRESH`,
`STUDIUM_OBS_HOST`, `STUDIUM_OBS_PORT`, `STUDIUM_OBS_VALIDATOR_TIMEOUT`.

A bad value never raises: a non-integer port keeps 8004 and adds a line to the problems
banner. Read that banner first when a page looks empty.

## 7. What counts as discoverable

A course is a direct child of the course root containing `astra.yaml` (or a folder
named with `--course`). A run is a direct child of the eval root containing
`audit.json` or `sessions/`. A suite is a direct child of the validity root containing
`README.md`. Nothing recurses or is cached: every request rescans. A symlink escaping
its root is reported in the banner and not listed; a duplicate name gets a `~2` suffix.
Ids are resolved only through the discovery maps; no URL segment is joined to a root.

## 8. The validator cache

Keyed `<n files>:<newest mtime ns>` over the course tree's `*.yaml` and `*.json`: touch
any file and the next validation runs again. Statuses: `ok`, `failed`, `timed_out`,
`not_installed`, `not_run`. `not_installed` is not cached, so installing astra-tools
takes effect without a restart. Default timeout 60 s; a hang gives `timed_out` and a
200 page. Validation runs with `--skip-evidence`: a schema pass is neither checked
source evidence nor teacher approval.

## 9. Tests and screenshots

`pytest.ini` sets `testpaths = packages`, so name the suite, or run every Python suite:

```bash
.venv/bin/python -m pytest services/observatory -q -p no:cacheprovider
.venv/bin/python tools/pytest_all.py
```

For a screenshot, a headless Chrome is more reliable than an embedded browser pane once
the page is scrolled:

```bash
chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1400,2400 \
  --virtual-time-budget=3000 --screenshot=out.png http://127.0.0.1:8004/
```

Replace `chrome` with the Chrome or Chromium executable of the machine.

## 10. Gotchas

- A blank findings section usually means a stub or mock course (section 2), not a
  broken page.
- `services/observatory` is not on the default pytest path (section 9).
- `uvicorn` needs `services/observatory/` as cwd.
- MySTRA presents provenance; it runs none of the code it describes, writes no
  approval and publishes nothing. Approval is `tools/experience_packet.py approve`
  ([Review and approve](../../docs/teach/review-and-approve.md)).
- Class figures obey the cohort floor described in
  [Observatory](../../docs/teach/observatory.md#class-numbers-and-the-floor).

## 11. Pointers

`services/observatory/README.md` (service contract, environment table, privacy
statement), [Observatory](../../docs/teach/observatory.md),
[studium-harness](../studium-harness/SKILL.md) (running a lesson, the evaluation
harness), [design records](../../docs/design-records/index.md).
