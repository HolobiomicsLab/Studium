# Observatory

A read-only localhost page over the artifacts Studium already writes: the ASTRA
provenance of each generated course, the ASTRA validator's verdict on demand, the
evaluation runs under `eval/reports/`, and the validity scorecards under
`eval/validity/`. It is an operator surface. It is not the teacher dashboard and it
is never shown to learners.

INT-STUDIUM-008, three slices: provenance, evaluation and validity (1); the scene-review
tab and the two session sources (2); the harness tab over the agentic-session file protocol
(3). Every requirement of the design spec now has code.

## What it shows

| Page | Content |
| --- | --- |
| `/` | every course, evaluation run and validity suite found on disk, with a banner for any misconfigured root |
| `/courses/<id>` | the course's analyses, decisions with their options and rationale, findings with their evidence anchors, universes with what each one changes from the defaults, the exploration trace, and the scene-review rows |
| `/courses/<id>/validation` | runs `astra validate` on that course and shows the verdict; the only page that starts a subprocess |
| `/courses/<id>/provenance.myst.md` | the MyST page `tools/astra_render.py` writes, verbatim |
| `/courses/<id>/review` | one section per judged bundle, worst case first: the per-scene verdicts `eval/harness/scene_judge.py` wrote, with its failure scenario and quote, the corrupted-scene calibration when the review carries one, and the same verdicts as ASTRA decisions |
| `/eval/runs/<id>` | the run's dimension scores, findings, harness signals, synthetic-persona sessions and `report.md` |
| `/eval/validity` | one card per validity suite with the scalar fields of its result files |
| `/sessions` | the session-runs column on its own — that tree has no course dimension, so it needs no id |
| `/sessions/<course>` | both session sources side by side: the collector store for that course, the session runs, the indicators that are comparable, and the two that are shown and never flagged |
| `/harness` | one named agentic-session workspace per section: `index.json` as a step table, the current `task.md`, the last `feedback.md`, each file's modification time; the page refreshes itself |

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
`--course` (repeatable), `--eval-root`, `--validity-root`, `--analytics-data-dir`,
`--sessions-root`, `--host`, `--port`, `--validator-timeout`.

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
| `STUDIUM_OBS_SESSIONS_ROOT` | unset | **one** directory of `telemetry.jsonl` streams, read whole by `class_report.build_report`; unset means no session-runs column |
| `STUDIUM_OBS_SESSION_DIRS` | empty | agentic-session workspaces, one by one, separated by the platform path separator; either the workspace or its `.studium-session/` is accepted |
| `STUDIUM_OBS_HARNESS_REFRESH` | `5` | seconds between the Harness page's own refresh; `0` turns it off |

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

## The two session sources

`/sessions/<course>` is two readers side by side, neither of them reimplemented here:

* the **collector store**, `<store>/<course>/<YYYY-MM-DD>.jsonl`, read by the collector's
  own `metrics.compute_progress`, `compute_course_completion`, `compute_autonomy` and
  `compute_trust_calibration`;
* the **session runs**, ONE directory read whole by `class_report.build_report`, which
  finds its own input with `rglob("telemetry.jsonl")` and covers both the durable
  MCP-host layout (`<pseudonym>/<bundle_id>/telemetry.jsonl`) and an eval run's
  (`sessions/<persona>/telemetry.jsonl`).

**Only one of them is course-scoped.** No writer of a telemetry stream stamps a course:
the durable tree is keyed by pseudonym and an eval run's by persona. `STUDIUM_OBS_SESSIONS_ROOT`
is therefore one directory, and the `<course>` in the URL scopes the collector column only.

**What is compared.** Two indicators are like-for-like: the learner count (exact equality)
and the trust pair — the gap within `5e-4`, because the class report rounds it to three
decimals and the collector keeps it raw, and the band exactly. A flag means *the two
readers disagree about the same artifact*: one store is stale, one tree is partial, or one
process was started somewhere else. It is not a statement about learners.

**What is only shown.** Completion and autonomy appear in both columns with the formula
that produced each one named on screen, and are never flagged. The two sides do not measure
the same population, and the two definitions of "autonomy ratio" — the collector's ratio of
critique events to hint adaptations, and the mean of the `autonomy_ratio` the runtime stamps
on `lesson_completed` — share a name and not a formula. That collision is a defect in its
own right and is filed separately; this page names both formulas instead of hiding it.

**When nothing is compared.** A comparison needs exactly one identical
`(lesson_id, bundle_version)` scope on both sides. Several lessons, different bundle
versions, or the collector's `"unversioned"` bucket for an unstamped event: both columns
render their own numbers, the page says why they are not comparable, and nothing is
flagged. A lesson id alone is not globally unique, so a flag raised across two artifacts
would be an alarm about the scope.

**Older synthetic runs have no identity.** An eval-layout run carries no
`learner_pseudonym`, and `build_report` falls back to the stream's own file path as an
identity. The Observatory does not accept that: an event without both a pseudonym and a
lesson id is an unknown identity, and the source is suppressed with that reason rather than
counted. Point `--sessions-root` at a durable host tree to get a column.

## The Harness tab

`--session-dir <workspace>` (repeatable) or `STUDIUM_OBS_SESSION_DIRS` names the workspaces
to watch. They are named **one by one and never scanned for**: a `.studium-session/` folder
sits at the root of whatever workspace an operator is driving, and nothing puts several of
them under a common parent, so a `<root>/<session>` convention would name a layout no writer
produces. Either form of path works — the workspace, or the `.studium-session/` inside it.

The page re-requests itself every `STUDIUM_OBS_HARNESS_REFRESH` seconds. The poll is the
page's, not the server's: the spec asks for polling and forbids a file-watcher dependency,
and a server-side loop would be state in a service that has none. `--harness-refresh 0`
turns it off for a session you are reading rather than watching. The JSON twin carries the
interval as a number and sets no refresh header — a client that polls owns its own interval.

**Three of the six protocol files are read, and the omission is the point.**
`.studium-session/` also holds `response.json` and `run_result.json`, which are the
learner's own submission and their own executed result; those two names appear on the page
only as the stated omission. `task.md` is safe by construction — `publicScene` strips the
answer key before the file is written — and `feedback.md` cannot echo a response, because
`renderFeedback` is a closed set of transition messages. `index.json` is rendered as a step
table and never as text: its entries carry artifact paths, which the table reduces to
basenames, and the raw document would put them back unfiltered. A test writes a canary
string into both learner files and asserts it reaches no payload and no page; another
records every file opened under a session directory and compares the set to the three.

The file names live in TypeScript (`FILES` in
`packages/lesson-session-host/src/session-workspace.ts`) and Python cannot import them, so
the Python names are a mirror — and a *checked* one: a test reads that source, extracts the
literal, and fails naming the drift if a name is renamed or a seventh file is added.

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
larger than the class actually is — the wrong side of a privacy floor to be wrong on.
Where both counts are shown (`n_learners`, `n_streams`) the difference is legible.

What that floor is for: it **restrains singling out**; it does not make the numbers anonymous
(INT-STUDIUM-030). k-anonymity protects against a reader who does not know the population, and
this surface's reader is a teacher who already holds the roster. Five pseudonyms behind a number
are five people they can usually name. The floor's job is to stop the instrument becoming a
per-student report — by accident, by drill-down, or by patient reading over time — and it is
worth keeping at five for exactly that. A cross-class reader would be a different reader, and
this reading does not carry over to one.

The floor is applied at two levels, and it now gates a **pair** of columns:

* **Per lesson, over identities.** `learner_pseudonym` is `HMAC(learnerId:lessonId)`, so
  it identifies a person *within one lesson*. Each lesson partition must reach the floor on
  its own; a union across lessons counts learner-lesson pairs and can never lift a lesson
  over it. One person holding five lesson-salted pseudonyms stays suppressed, and across
  lessons the aggregate is labelled `n_learner_lesson_pairs` with `n_learners` null.
* **Per metric family, over contributors.** A populated course is not proof of a populated
  metric: five participants of whom one audited would publish that person's trust result.
  Each family is gated on the distinct pseudonyms that actually contributed the events its
  reader consumes — per lesson, and additionally per scene for a scene-based value. A
  family with no contributor at all is reported as *not measured*, never as a measured zero.

A suppressed column carries **no number at all**, not even its cohort size, and every
suppressed or omitted family carries the reason in the page and in the JSON twin. If one
readable source is suppressed, the other is suppressed with it: a number shown on one side
and withheld on the other is the withheld one, by subtraction. A source that is *absent* or
*unreadable* withholds nothing, so the other column still renders alone. An unreadable
source names a basename and an exception class and nothing else — every path segment above
a `telemetry.jsonl` is a pseudonym, and an exception message carries the path. A reader called
wrongly by this page is a sixth state, `broken`, and not an unreadable source: the old wording
sent an operator to hunt through their own telemetry for a defect that is in the projection.

### What a published number may say about the people behind it (INT-STUDIUM-030, R1)

* **One identity rule, and it is the preflight's.** The cohort count published for the session
  runs column is the population this page actually floored, never `build_report`'s own figure —
  that reader falls back to a stream's file path when a stream carries no pseudonym, so its
  count can include one synthetic learner per pseudonym-less stream. `build_report`'s figure is
  still shown, under the name it honestly has: `n_streams`. The divergence row therefore
  compares two populations counted the same way, or it compares nothing.
* **A judgement metric names its population as a band.** Trust calibration, over-trust,
  over-distrust and autonomy carry `cohort_band` (`5–9`, `10–19`, `20+` at the default floor),
  `cohort_counts` saying whether that band counts people or learner-lesson pairs, and a
  `non_attribution` sentence stating that the number is a class reading and not a statement
  about a student. An exact cohort size moves once per contributor — nineteen transitions over
  a class of twenty-four, each timeable against the roster; the band moves twice. Participation
  counts stay exact: "six of your twenty-four did this lesson" is something the teacher already
  has from the room.
* **What was withheld is a reason, never a count.** `withheld_below_floor`,
  `withheld_unseen` and `withheld_unreadable` replace `n_withheld_scenes` and
  `n_withheld_lessons`, and the prose beside them carries no number either. A reader still
  cannot mistake a course of eight scenes for one of twelve, and still learns why a key is
  missing; what is gone is the monotone integer. One boolean per reason also makes the old
  disagreement unrepresentable — the integers summed three differently-caused populations while
  the sentence distinguished all three.
* **`ok` means a number was computed.** Every family carries `measured`. When it is false the
  family says why the null is itself the measurement — no lesson was started, or every audit was
  ungrounded — instead of publishing a blank an operator reads as a zero. The flag is computed
  from the value actually published and never copied from a reader's own claim; where the class
  report's own `measured` disagrees, the page says so.

## Tests

```bash
python -m pytest services/observatory -q
```

The two validator tests need `astra-tools`; they fail under `CI` and skip locally when
the CLI is absent.

## MySTRA reviewer view

`/courses/{id}/mystra` presents a printable report from the shared course and review
readers; `/api/courses/{id}/mystra` exposes the same structured context. The existing
`/courses/{id}/provenance.myst.md` exports the MyST source. All remain GET-only.
Opening the viewer reads the cached validation verdict; only the validation routes
run the validator. See [the reviewer guide](../../docs/guides/mystra-reviewer.md).
