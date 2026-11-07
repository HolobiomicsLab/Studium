English · [Français](cli.fr.md)

# Command-line tools

These commands prepare, check and approve lessons, report on a class and run the Python test suites
without any assistant or editor. Run them from the repository root, after the installation in
[Installation](../start/installation.md) (`pnpm install` and a `.venv` with `requirements.txt`).

| Command | What it does |
|---|---|
| [`experience_packet.py`](#experience_packetpy) | Sources to passages, packet, checked draft, lesson skeleton, teacher approval. |
| [`bundle_lint.mjs`](#bundle_lintmjs) | Teaching-material lint of one or more `lesson.json`. |
| [`bundle_validate.ts`](#bundle_validatets) | Schema validation of `lesson.json` files. |
| [`class_report.py`](#class_reportpy) | Aggregated class report from consented telemetry. |
| [`interaction_report.py`](#interaction_reportpy) | Aggregated usage report of the two-lane interface from consented telemetry. |
| [`pytest_all.py`](#pytest_allpy) | Every Python test suite, one process each. |

## experience_packet.py

[tools/experience_packet.py](../../tools/experience_packet.py) turns references a learner or teacher
chose into a lesson, offline and without a model. The usual order is
`passages`, `prepare`, `check`, `bundle`, then `approve` for a teacher's lesson.

```bash
.venv/bin/python tools/experience_packet.py passages --text notes.txt --title "Chapter 1" --out work/passages.json
.venv/bin/python tools/experience_packet.py prepare --passages work/passages.json --title "Chapter 1" --out work/packet
# an author (person or assistant) writes work/author-response.json from the packet
.venv/bin/python tools/experience_packet.py check --packet work/packet --response work/author-response.json --out work/courses/chapter-1
.venv/bin/python tools/experience_packet.py bundle --course work/courses/chapter-1 --out work/bundles/chapter-1/lesson.json
.venv/bin/python tools/experience_packet.py approve --bundle work/bundles/chapter-1/lesson.json --validated-by "A. Teacher"
```

| Subcommand | Required | Options |
|---|---|---|
| `passages` | one of `--url URL`, `--html FILE`, `--pdf FILE`, `--text FILE`; `--out FILE`; `--title T` | `--license ID` (default `unknown`, reported as a WARN by `check`), `--min-chars N` (default 200), `--max-chars N` (default 1200), `--force` |
| `prepare` | `--passages`, `--out`, `--title` | `--target`, `--capsule`, `--task-id`, `--self-study` (automatic for passages from `passages`) |
| `check` | `--packet`, `--response`, `--out` | `--force`; `--quiet` (print only the output path) or `--json` (one machine-readable report) |
| `bundle` | `--course`, `--out` | `--validated-by`, `--force`, `--no-default-rules`, `--self-study`, `--note TEXT` (needs `--self-study`) |
| `approve` | `--bundle LESSON_JSON`, `--validated-by NAME` | `--checklist KEY=VALUE ...`, `--opened ID[,ID...]` (repeatable), `--note TEXT` |
| `receipt` | `--bundle LESSON_JSON`, `--reviewer NAME`, `--decision returned` | `--opened ID[,ID...]` (repeatable), `--note TEXT` |

What to expect:

- `passages` fetches a URL once; a PDF needs a text layer.
- `check` refuses a quote that is not an exact substring of its passage: fix the draft, never the
  evidence. Its findings carry a level, a code and, when relevant, the scene and the quote.
- `bundle` writes a skeleton and prints the number of placeholders left (`TODO:` texts to fill).
  `--self-study` records `metadata.authoring` and, without `--validated-by`, marks the lesson
  "SELF-STUDY — not teacher-validated".
- `approve` refuses a self-study bundle, a remaining placeholder or a lint error. It sets
  `validated_by` and `validated_at`, normalises the file and writes `approval.json` next to the
  bundle, bound to the SHA-256 of its final bytes. It prints a summary (reviewer and time, the voice
  learners will read on every screen, `learners read on every screen: « Leçon validée par <NAME> » /
  "validated by <NAME>"`, SHA-256, lint counts, the stale-approval reminder), then the path of
  `approval.json` as its last line. A name containing `@` adds `note: this is an e-mail address;
  learners will see it — prefer a name (--validated-by "Prénom Nom")`; it is not refused.
  It also writes the review receipt `reviews/<date>-<sha>.json` next to the bundle (one item per
  scene: fingerprint, consequence, opened or not; `--opened` names the scenes read, an unknown id is
  refused before any write) and warns about `grading` scenes not opened. A receipt is never
  overwritten: the same bytes decided twice the same day are refused.
- `receipt --decision returned` is for a teacher who sends a lesson back (the teacher dashboard
  composes it): it writes only the receipt, bound to the current bytes, with no `approval.json` and
  no rewrite. `--decision approved` is refused: use `approve`.

Exit status: `0` success, `1` findings that block (or an unmatched quote), `2` a usage or packet
error. With `--json`, `check` prints `{ok, findings, output, summary}`.

The tutorials [Self-study from references](../tutorials/self-study-from-references.md) and
[From literature to a course](../tutorials/literature-to-course.md) walk through a full run.

## bundle_lint.mjs

[tools/bundle_lint.mjs](../../tools/bundle_lint.mjs) checks what the schema cannot: one correct
choice per quiz, unfilled `TODO` placeholders, known render-asset kinds and graph relations, and who
holds the answer key in a self-study lesson. It needs only Node.

```bash
node tools/bundle_lint.mjs                              # every lesson.json under fixtures/
node tools/bundle_lint.mjs --root path/to/bundles       # every lesson.json up to two levels deep
node tools/bundle_lint.mjs path/to/lesson.json          # given files
bash tools/bundle_lint.test.sh                          # the linter's own contract tests
```

Each finding is one line: `LEVEL  file  code  message`, with `LEVEL` one of `ERROR`, `WARN`,
`INFO`. Exit status `1` when there is at least one `ERROR`, `0` otherwise.

## bundle_validate.ts

[tools/bundle_validate.ts](../../tools/bundle_validate.ts) parses each file with the
[lesson bundle schema](lesson-bundle.md). It is TypeScript, so it runs through the workspace's tsx.

```bash
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts path/to/lesson.json [...]
```

It prints `OK <file>: N scenes` or `FAIL <file>: <issues>` and exits `1` if any file fails.

## class_report.py

[tools/class_report.py](../../tools/class_report.py) gives a teacher class-level figures from
consented telemetry: concepts to re-teach, where hints and miscalibration cluster, completion. It
never prints a per-learner row or a pseudonym.

```bash
.venv/bin/python tools/class_report.py <run_or_collector_dir> [--min-learners 5] [--out DIR] [--bundle lesson.zip]
```

| Option | Meaning |
|---|---|
| `run_dir` | Folder of per-learner telemetry streams (`telemetry.jsonl`). |
| `--min-learners` | Floor over distinct learners (default 5), applied to each figure over the learners it is computed from: figures over fewer learners are withheld. |
| `--out DIR` | Also write `class_report.md` and `class_report.json`. |
| `--bundle` | The bundle, when the telemetry folder holds none (durable MCP layout). |

It follows the rules of the MCP tool: accuracy counts only answers a key or a judge graded (a keyword
score is an attempt), calibration uses only the answers learners rated (`null` when none is), and a
missing time is not counted as zero. In the Markdown, "withheld (fewer than k)" marks a figure below
the floor and "not measured" one nobody contributed to; each concept row of the JSON carries
`n_measured` and `withheld_figures`, the names of the figures the floor held back.

The floor restrains singling out; it is not an anonymity guarantee, since a teacher knows the class.
The MCP tool `class_report` offers the same report with a floor that cannot be lowered (see
[Follow a class](../teach/follow-a-class.md)).

## interaction_report.py

[tools/interaction_report.py](../../tools/interaction_report.py) reports how a class used the
two-lane interface, from the interaction events of consented telemetry: the share of acts settled
without a model, the delay of verdicts (95th percentile), prompt outcomes per kind (a kind with 30
outcomes or more and under 20 % accepted is flagged), help used per rung and per scene, contests,
resumes and scenes shown twice after them, and review receipts. It does not measure learning
(that is `class_report.py`).

```bash
.venv/bin/python tools/interaction_report.py <run_dir> [--min-learners 5] [--out DIR] [--json]
.venv/bin/python tools/interaction_report.py <telemetry.jsonl> --single-stream
```

It reads every `telemetry.jsonl` under the folder, refuses a stream with no `consent_granted` event
(counted in `refused_streams`), and withholds the whole report under the floor of five distinct
learners, as well as each figure, prompt kind and scene computed over fewer. `--min-learners` can
raise the floor, not lower it. `--out DIR` writes `interaction_report.md` and
`interaction_report.json`. `--single-stream` reads one file without a floor and is meant for the
synthetic learners of the benches only; the report then says its figures are one learner's.

## pytest_all.py

[tools/pytest_all.py](../../tools/pytest_all.py) runs every Python test suite of the repository,
one pytest process per suite, and fails when a test file is reached by no suite.

```bash
.venv/bin/python tools/pytest_all.py              # all suites
.venv/bin/python tools/pytest_all.py -- -x -q     # extra arguments go to each pytest run
```

It ends with `N suites, M failing` and exits `1` when a suite fails or a test file is uncovered.
`--root DIR` points it at another checkout. The other test commands are in
[Testing](../develop/testing.md).
