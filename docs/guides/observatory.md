# The Observatory: looking at what Studium produced

Studium writes a lot and shows little of it. Every generated course carries an ASTRA
provenance set (the decisions the planner took, the alternatives it rejected, the
findings it grounded them in, the universes it kept). Every evaluation run leaves an
audit, a report and one session directory per synthetic persona. The validity suites
leave scorecards. Until now, reading any of it meant opening YAML and JSON by hand.

The Observatory is one localhost page over all of it. It is the operator's view:
whoever generated a course, ran an evaluation, or is about to claim something in a
paper. It is not the teacher dashboard, and no learner ever sees it.

## Start it

From the repository root:

```bash
python services/observatory/observatory_app.py --course-root services/planner/.lwg --eval-root eval/reports
```

It listens on `http://127.0.0.1:8004`. There is no login, because there is nothing to
log in to: the service binds the loopback interface, and binding anything else takes
an explicit `--host` and prints a warning first.

If a root is missing, the wrapper says which one on stderr. A missing course root with
no `--course` is the only fault that stops the start-up; everything else is reported
and the page still opens.

## What you get

**The index** lists every course, evaluation run and validity suite it found, and a
banner naming any root it could not read. Courses come from the directories under the
course root that hold an `astra.yaml`; runs from the directories under the evaluation
root that hold an `audit.json` or a `sessions/` directory; suites from the directories
under the validity root that hold a `README.md`. The roots are re-scanned on every
request, so a run that finished a minute ago appears on reload.

**A course page** shows, per analysis, each decision with its options, its default,
its rationale and the edge it came from; each finding with its claim and its evidence
anchors; each universe with the selections that differ from the defaults; the
exploration trace as bullets and as a mermaid source; and the scene-review rows. The
same page is available as MyST markdown at `/courses/<id>/provenance.myst.md`, byte
for byte what `tools/astra_render.py` writes.

**The validator** runs only when you ask for it, on `/courses/<id>/validation`. It
calls the real `astra validate` with `--skip-evidence`, so there is no network call,
and it is killed after sixty seconds. The verdict is cached until a file in the course
changes, and the course page shows the cached status without re-running anything. If
`astra-tools` is not installed the page says so and gives the install line.

**A run page** shows the dimension scores, the findings, the harness signals, the
synthetic personas with their turn counts and telemetry event types, and the full
`report.md`. A persona that reached the driver's turn cap is flagged, which is usually
the first thing worth knowing about a run that scored badly.

**A review page**, at `/courses/<id>/review`, shows one section per judged bundle with
the worst case first: every scene the scene judge looked at, its verdict per dimension,
the failure scenario the judge wrote and the quote it grounded it in. When the review
carries a corrupted-scene calibration, the kappa and whether the judge separated the
corrupted scene from the clean one are shown next to it — a judge that cannot tell them
apart is a judge whose verdicts mean nothing. The bundle's own id is the title; where a
review was written under a slugged directory name, the directory is shown underneath.
A course with no review says so and the rest of the page still loads.

**The sessions page**, at `/sessions/<course>`, puts the two places learner telemetry
lands side by side. See "Reading the two session columns" below — it is the one page
where two readers can disagree, and knowing what a disagreement means is the point of it.

**The validity page** shows one card per suite with the scalar fields of each result
file and its date. A suite with no result file says so rather than showing nothing.

Every page has a JSON twin under `/api/…`, so the same data feeds a script.

## What it will not do

It is read-only, and that is enforced rather than intended. Every route is a `GET`;
the service writes nothing under the roots it reads; it starts no lesson, no
evaluation run and no model call. The validator is the only subprocess it spawns. A
test crawls every route and asserts that no file's content or modification time
changed.

It also never reads a learner identifier, a pseudonym or a free-text telemetry field
into a view. The filtering happens in the readers, before any template sees the data,
and the session event log is never opened at all. Evaluation personas are synthetic
and labelled as such on screen. Every number derived from learner telemetry passes the
same k-anonymity floor the class report applies — five learners, one definition of the
value, imported rather than copied — and that floor counts **distinct learners**, not
telemetry files: one learner writes one stream per bundle, so three files can be two
people, and counting files would report a cohort larger than the class is.

Two things about that floor are worth knowing before you read a suppressed page. It is
applied **per lesson**, because a pseudonym is computed over the learner *and the lesson*:
the same person is a different pseudonym in every lesson, so adding lessons together
counts learner-lesson pairs, not people, and can never lift a small lesson over the floor.
And it is applied again **per number**, over the people who actually contributed the events
that number was computed from — a class of thirty where one person audited an AI reading
does not publish that person's trust result. When a number is withheld, the page says
which source lacked the evidence and what the floor is, and shows no count at all: not the
cohort size, not the rate, nothing that could be recovered by subtraction. That is also why
suppression takes both columns down together.

## Telling the Observatory where the collector writes

`STUDIUM_OBS_ANALYTICS_DATA_DIR` names the analytics collector's event store, as an
**absolute** path. It has its own variable because the collector resolves its own
`ANALYTICS_DATA_DIR` (default: the relative `"data"`) against *its* working directory,
and the teacher guide starts the collector after a `cd` — so the same configuration can
mean two directories. The Observatory resolves what you give it and prints the resolved
path in the index banner; if it does not match where the collector is writing, you see
it on the page rather than seeing an empty store. Leave it unset and there is simply no
live column: a guessed relative directory would be worse than none.

You do not configure a course token. The collector's check is string equality between
the `X-Course-Token` header and the `course` query parameter — the token *is* the course
id, typed into the teacher dashboard and shown on screen — so there is no secret for the
Observatory to hold, and it reads the store on disk rather than calling the collector.

An unreadable file is never an error page. It renders as `(unreadable <file>:
<reason>)` where its content would have been, and the rest of the page still loads.
That is deliberate: a half-written run directory is exactly the case you want to look
at.

## Telling it where the session runs are

`STUDIUM_OBS_SESSIONS_ROOT`, or `--sessions-root`, names **one** directory of telemetry
streams. Not one per course: no writer of a telemetry stream stamps a course. The durable
host tree is keyed by pseudonym (`<pseudonym>/<bundle_id>/telemetry.jsonl`) and an
evaluation run's by persona (`sessions/<persona>/telemetry.jsonl`), so a
`<root>/<course>/` convention would name a layout nothing on disk produces. The reader,
`class_report.build_report`, finds its own input under whatever root you give it.

Point the two roots at real trees like this:

```bash
python services/observatory/observatory_app.py \
  --course-root services/planner/.lwg \
  --analytics-data-dir /absolute/path/to/collector/data \
  --sessions-root /absolute/path/to/durable/host/data
```

Both paths are resolved and printed on the index, so a root that is not where you thought
it was shows on the page instead of showing as an empty column.

## Reading the two session columns

The page shows the collector store on the left and the session runs on the right, each
with the absolute path it read and the reader that read it. Two numbers are compared:

* **the learner count**, exactly; and
* **the trust pair** — the gap within `5e-4`, because the class report rounds it to three
  decimals and the collector keeps it raw, and the band exactly.

**A flag means the two readers disagree about the same artifact.** One store is stale, one
tree is partial, or one of the two processes was started in a different directory. It is
not a statement about learners, and it is not a data-loss alarm — it is the pair of numbers
you would otherwise have had to compare by hand.

**Completion and autonomy are shown and never flagged.** They are on the page with the
formula that produced each one written next to it. The collector's completion is a rate
over scene events; the class report's is lesson completions over lesson starts. The
collector's autonomy is critique events over critique-plus-hint events; the class report's
is the mean of the `autonomy_ratio` the runtime computed on the device. Those two
"autonomy ratios" share a name and not a formula, which is a defect in its own right and
is filed as such; until it is resolved, the page tells you which one you are looking at
rather than flagging a difference that is a definition.

**Sometimes nothing is compared, and that is not a fault.** A comparison needs exactly one
identical `(lesson_id, bundle_version)` scope on both sides. If either source spans several
lessons or versions, or carries events the runtime never stamped with a version, both
columns still show their own numbers, the page says why they cannot be paired, and nothing
is flagged. A lesson id on its own is not globally unique, so a flag across two different
artifacts would be an alarm about the scope and not about the data.

**An old evaluation run will not produce a session column.** Eval-layout telemetry carries
no `learner_pseudonym`; `build_report` falls back to the stream's file path as an identity,
which counts personas as people. The Observatory refuses that: an event without both a
pseudonym and a lesson id is an unknown identity, and the column is suppressed with that
reason. Use a durable host tree if you want the column, or read the run page for that run.

**Absent, unreadable and suppressed are three different states**, and the column says which
one it is in. Absent means nothing is configured or the directory is gone; unreadable means
a file could not be read or parsed, and the page names the file's *basename* and the
exception class only — every directory above a `telemetry.jsonl` is a pseudonym, and an
exception message carries the path it failed on. In both cases the other column still
renders alone. Suppressed is the only state that takes the pair down together.

## Where the screenshots live

The slice-1 acceptance screenshots and the timing measured on the real
`eval/reports` root are in the project hub, under
`docs/superpowers/audits/2026-09-04-observatory-s1/`.

## Scope

Slice 1 was provenance and evaluation; slice 2 adds the review tab and the two session
columns (INT-STUDIUM-008). Slice 3 adds the harness tab. The tests for what exists today
run with:

```bash
python -m pytest services/observatory -q
```
