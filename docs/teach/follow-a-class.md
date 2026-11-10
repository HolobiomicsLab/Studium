English · [Français](follow-a-class.fr.md)

# Follow a class

You can see how a class worked through a lesson (which concepts to re-teach, where hints and
over-confidence cluster, how far students got) without ever seeing a single student's record.
Through your assistant, every class-level number is computed over at least five distinct learners,
and nothing narrows it to a person.

| Tool | Where | Shows |
|---|---|---|
| `class_report` | MCP tool, from your assistant | Accuracy per scene and concept, hint reliance, calibration gap, completion |
| `tools/class_report.py` | Command line | The same, plus trust calibration, as Markdown and JSON |
| Teacher dashboard | Browser, `localhost:3001` | Lesson library and review pages; course analytics from the collector |
| Observatory | Browser, `localhost:8004` | Provenance, MySTRA, evaluation runs, session columns ([Observatory](observatory.md)) |

## Where class data comes from

Studium writes telemetry only when the learner has opted in (`STUDIUM_TELEMETRY_CONSENT=1`, or the
`studium.telemetryConsent` setting in VS Code) and their state is durable (the default; see
[configuration](../reference/configuration.md)). Telemetry holds pseudonymised references and
numbers, never free text, and mastery stays on the learner's device.

The streams land in the learner's data folder as `<pseudonym>/<bundle_id>/telemetry.jsonl`. No
supported surface sends them to you over the network in this version, so a class report needs those
folders in one data folder: for example a shared lab machine, or folders students choose to hand in.

## Ask your assistant for a class report

With the Studium MCP server configured on that data folder, ask "give me the class report for
`my-course`". The assistant calls `class_report {course_id}`. The course is looked up in the
server's lessons folder (`BUNDLES_ROOT`), then in the learner library (`<STUDIUM_HOME>/library`).

| Figure | Computed over | Shown when |
|---|---|---|
| Accuracy | answers a key or a judge model graded; a keyword score is an attempt, not a grade | at least five learners were graded |
| Hint reliance | the share of answering learners who asked for a hint (0 to 1) | the row is shown |
| Calibration gap | the answers learners rated with a confidence | at least five learners rated |
| Mean time | timed answers | at least five learners were timed |
| Completion | learners who completed over learners who started | at least five learners started |

- Learner counts are given as a band (`5–9`, `10–19`, `20+`), never as an exact size.
- A scene or concept with fewer than five answering learners is left out, and a figure below its
  own floor is withheld (`null`). The report then says something was withheld
  (`withheld_below_floor`) without saying how many.
- The tool covers the whole data folder the server is configured with and names it in
  `data_folder` (the folder's name and a short fingerprint of its path, never the path). It takes
  `course_id` only: a `telemetry_dir` argument is refused, so the model cannot narrow the report and
  subtract one cohort from another.

One limit remains: two reports taken before and after one more learner plays can be compared. Read
the figures as a live class view, not as a publication.

## Use the command line

```bash
.venv/bin/python tools/class_report.py path/to/data --out reports/my-course
```

It reads every `telemetry.jsonl` under the folder and writes `class_report.md` and
`class_report.json`, with the same rules as the MCP tool: a floor per figure, keyword scores counted
as attempts, calibration over rated answers only. In the Markdown, "withheld (fewer than k)" marks a
figure some learners contributed to but too few, and "not measured" one nobody contributed to; each
concept row of the JSON lists its `withheld_figures`. With no scene rows, its concept figures can
differ from the tool's when a scene is withheld. `--min-learners` sets the floor (default 5). Unlike the MCP tool, whose floor
of 5 cannot be lowered, the command line accepts a lower value, and the report then loses that
protection: keep 5 or more. `--bundle path/to/lesson.zip` names the lesson when it is not next to
the telemetry. This report also includes trust calibration
(whether students trusted the AI when they should have), which the MCP tool leaves out.

## How the interface was used

```bash
.venv/bin/python tools/interaction_report.py path/to/data --out reports/my-course-usage
```

[`tools/interaction_report.py`](../../tools/interaction_report.py) reads the same folder and
reports how the class used the interface rather than what it learned. It reads seven event types,
written only under the learner's consent: `interaction` (one per act the server settles), `prompt_shown`
and `prompt_outcome`, `help_used`, `contest`, `resume` and `review_receipt`.

- **Lane and surface rank.** Each act records the lane the learner used (`fast` for the panel, the
  native pane and forms; `companion` for the conversation and its tools) and the rank of the surface the
  session was played on (3 panel or pane, 2 forms, 1 conversation). An act in the conversation while a
  panel is open is therefore `companion` at rank 3. The fast-lane share is computed over the acts of
  sessions at rank 2 or 3, conversation acts included: a learner who fell back to the conversation
  lowers the share rather than disappearing from it.
- **Prompt outcomes.** Each proposal is counted as accepted, dismissed or ignored, per kind; a kind with
  at least 30 outcomes and fewer than 20% accepted is flagged for review.
- **Help, contests and resumes.** Help is counted per rung (`hint`, `explain`) and per scene, with the
  answers that came before and after an explanation; contests by their outcome (`confirmed`, `refuted`,
  `partial`); resumes by cause, with scenes shown twice after a resume.
- **Review receipts.** `experience_packet.py approve` and `receipt --decision returned` write one
  `review_receipt` event beside the receipts, under the role label `reviewer`, so the report can say how
  many lessons were fully opened and how many were approved or returned.

Every figure keeps the same floor of five distinct learners, which here cannot be lowered, and a stream
without a recorded consent event is refused and counted, not read. The server now opens each stream with
that event, recording the consent declared through `STUDIUM_TELEMETRY_CONSENT`, and writes each event as
the learner acts: a stream written before this version carries no consent event and is not counted, and a
learner who started a lesson without finishing it is now counted as started in the completion figure.
What each prompt does, what each help
rung means and the exact fields are in
[Command-line tools](../reference/cli.md#interaction_reportpy) and the
[telemetry-events README](../../packages/telemetry-events/README.md), rather than repeated here.

## The teacher dashboard

```bash
pnpm --filter @studium/teacher-dashboard build && pnpm --filter @studium/teacher-dashboard start
```

Open `http://localhost:3001/library`. The library lists the lessons under `BUNDLES_ROOT` (default
`~/.studium/library`) with their status: Draft, Checked or Approved. To browse the repository's
teaching fixtures, start it with `BUNDLES_ROOT="$PWD/fixtures"`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/teacher-library-dark.png">
  <img src="../assets/screenshots/teacher-library-light.png" alt="Teacher dashboard library: a list of lessons with title, language, scene count and a Draft, Checked or Approved status." width="720">
</picture>

Each lesson has a review page (see [review and approve](review-and-approve.md#review-the-lesson-file))
with a link to its MySTRA view when the Observatory serves a course folder of the same name
(`OBSERVATORY_BASE_URL`, default `http://localhost:8004`). Pages are read-only: they show titles,
scene types, concepts and references, and, folded under each inbox line, what the learner reads (the
scene's text, a quiz's choices), never a key, a hint, a feedback or a reveal. Language and theme are
chosen in the header menu.

The review page opens with a review inbox: one line per scene, scenes that block first, then those
that hold a grading key, then wording and media, each marked new, changed or unchanged since the last
review receipt. Each line unfolds what the learner sees; the page runs the bundle linter, so a scene with
a lint error blocks. Give your own verdict on a grading line (Correct or To fix) before its automatic
verdict unfolds. The approval command, and the command that sends the lesson back, carry the name you
type (the panel shows it as learners will read it) and list the scenes you opened in `--opened`; the
page warns about grading lines you have not opened, and writes nothing itself.

The course analytics pages (`/courses/<course_id>/progress` and the pages next to it: calibration,
trajectory, reasoning, autonomy, AI literacy) read the analytics collector on `localhost:8003`; the
submissions page is described in [learner contributions](learner-contributions.md). Enter the
course id on the home page. Of the learner surfaces, only the frozen desktop app sends telemetry to
the collector, so these pages mainly serve demos and existing deployments:

```bash
ANALYTICS_DATA_DIR="$PWD/.studium-session/analytics" .venv/bin/python -m uvicorn \
  analytics_collector_app:app --app-dir services/analytics-collector --host 127.0.0.1 --port 8003
```

The collector has no real authentication: the course id is the token. Keep it on `127.0.0.1`.

## How to read the numbers

- A suppressed cell means the instrument declines to narrow, not that nobody could guess who it is:
  you know your class. The floor restrains singling out; it is not an anonymity guarantee.
- The floor applies per lesson and again per number, over the learners who contributed to it.
- Withheld is not the same as not measured: withheld means too few learners contributed to show the
  figure; not measured means none did, which is not a zero either. `measured: false` means the
  metric ran and had nothing to measure.
- The calibration gap is positive when the class is over-confident on a concept.

More on what is and is not collected: [privacy and limits](../concepts/privacy-and-limits.md).

Code: [`apps/lesson-mcp/src/teacher-tools.ts`](../../apps/lesson-mcp/src/teacher-tools.ts),
[`tools/class_report.py`](../../tools/class_report.py),
[`apps/teacher-dashboard/README.md`](../../apps/teacher-dashboard/README.md).
