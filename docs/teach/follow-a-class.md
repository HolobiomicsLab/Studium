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
scene types, concepts and references, never lesson bodies, choices or keys. Language and theme are
chosen in the header menu.

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
