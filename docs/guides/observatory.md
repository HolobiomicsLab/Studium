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
and labelled as such on screen. Aggregate learner analytics arrive in slice 2, behind
the same k-anonymity floor the class report already applies.

An unreadable file is never an error page. It renders as `(unreadable <file>:
<reason>)` where its content would have been, and the rest of the page still loads.
That is deliberate: a half-written run directory is exactly the case you want to look
at.

## Where the screenshots live

The slice-1 acceptance screenshots and the timing measured on the real
`eval/reports` root are in the project hub, under
`docs/superpowers/audits/2026-09-04-observatory-s1/`.

## Scope

Slice 1 is provenance and evaluation (INT-STUDIUM-008). Slice 2 adds the review tab
and the session and trust views; slice 3 adds the harness tab. The tests for what
exists today run with:

```bash
python -m pytest services/observatory -q
```
