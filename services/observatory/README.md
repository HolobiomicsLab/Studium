# Observatory

A read-only localhost page over the artifacts Studium already writes: the ASTRA
provenance of each generated course, the ASTRA validator's verdict on demand, the
evaluation runs under `eval/reports/`, and the validity scorecards under
`eval/validity/`. It is an operator surface. It is not the teacher dashboard and it
is never shown to learners.

Slice 1 (INT-STUDIUM-008). The Review tab, the session and trust views and the
harness tab arrive in slices 2 and 3.

## What it shows

| Page | Content |
| --- | --- |
| `/` | every course, evaluation run and validity suite found on disk, with a banner for any misconfigured root |
| `/courses/<id>` | the course's analyses, decisions with their options and rationale, findings with their evidence anchors, universes with what each one changes from the defaults, the exploration trace, and the scene-review rows |
| `/courses/<id>/validation` | runs `astra validate` on that course and shows the verdict; the only page that starts a subprocess |
| `/courses/<id>/provenance.myst.md` | the MyST page `tools/astra_render.py` writes, verbatim |
| `/eval/runs/<id>` | the run's dimension scores, findings, harness signals, synthetic-persona sessions and `report.md` |
| `/eval/validity` | one card per validity suite with the scalar fields of its result files |

Every page has a JSON twin under `/api/…` with the same data.

## Start it

From the repository root, with the project's virtual environment active:

```bash
python services/observatory/observatory_app.py --course-root services/planner/.lwg --eval-root eval/reports
```

Or, from this directory, with any ASGI server:

```bash
uvicorn observatory_app:app --port 8004
```

The wrapper prints one line per configuration fault to stderr and exits 2 when there
is no course root and no `--course`. Everything else is fail-soft: an unreadable file
becomes a marker in the page, never an error page. Flags: `--course-root`,
`--course` (repeatable), `--eval-root`, `--validity-root`, `--host`, `--port`,
`--validator-timeout`.

## Configuration

Flags override these; each variable has a default that works in a fresh clone.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STUDIUM_LWG_OUT_DIR` | `services/planner/.lwg`, else `.lwg` | directory whose child directories are courses (the planner's own variable) |
| `STUDIUM_OBS_COURSES` | empty | extra course directories, one by one, separated by the platform path separator |
| `STUDIUM_OBS_EVAL_ROOT` | `eval/reports` | directory of evaluation run directories |
| `STUDIUM_OBS_VALIDITY_ROOT` | `eval/validity` | directory of validity suites |
| `STUDIUM_OBS_HOST` | `127.0.0.1` | bind address |
| `STUDIUM_OBS_PORT` | `8004` | port |
| `STUDIUM_OBS_VALIDATOR_TIMEOUT` | `60` | seconds before `astra validate` is killed |
| `STUDIUM_OBS_ANALYTICS_DATA_DIR` | unset | the analytics collector's event store, as an **absolute** path; unset means no live column rather than a guessed directory |

A course is any directory holding an `astra.yaml`. A run is any directory holding an
`audit.json` or a `sessions/` directory. A suite is any directory holding a
`README.md`. The roots are re-scanned on every request, so a new run appears on
reload without a restart.

### The analytics store, and why it has its own variable

The collector resolves its own `ANALYTICS_DATA_DIR` (default: the **relative** `"data"`)
against *its* working directory, and the teacher guide starts it after a `cd`. The same
string therefore names two different directories depending on where each process was
started. The Observatory takes its own variable, resolves it to an absolute path, and
prints the result in the index banner, so a divergence is visible on the page instead of
showing as an empty store.

There is deliberately **no course-token variable**. The collector's check is string
equality between the `X-Course-Token` header and the `course` query parameter, so the
token *is* the course id — typed into the teacher dashboard's form and rendered on
screen. A variable documented as "read once, never logged, never rendered" would protect
nothing; the Observatory reads the store on disk instead of calling the collector over
HTTP (INT-STUDIUM-019).

## Read-only

Every route is a `GET`. The service writes nothing under any root it reads and starts
no lesson, evaluation run or model call. The validator subprocess is the only process
it spawns, and it runs with `--skip-evidence`, so it makes no network call. A crawl of
every route asserts that no file's content or modification time changes
(`tests/test_observatory_readonly_privacy.py`).

## Privacy

No learner identifier, pseudonym or free-text telemetry field is ever read into a
view, in any page, synthetic personas included. The readers filter before a template
sees the data, and `sessions/*/events.jsonl` is never opened. Evaluation personas are
synthetic and are labelled so on screen. The service binds `127.0.0.1` and has no
authentication layer, so another bind address requires an explicit flag and prints a
warning.

Every number derived from learner telemetry passes the k-anonymity floor of
`tools/class_report.py`, whose value (`MIN_LEARNERS_DEFAULT = 5`) has exactly one
definition and is imported, never re-declared. The floor counts **distinct learners**,
not telemetry files: the durable host layout writes one stream per `(pseudonym, bundle)`,
so a cohort of two people can be three files, and a file count would report a cohort
larger than the class actually is — the wrong side of a privacy floor to be wrong on. A
report states both numbers (`n_learners`, `n_streams`) so the difference is legible.

## Tests

```bash
python -m pytest services/observatory -q
```

The two validator tests need `astra-tools`; they fail under `CI` and skip locally when
the CLI is absent.
