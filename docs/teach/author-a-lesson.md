English · [Français](author-a-lesson.fr.md)

# Author a lesson

You bring the sources and the teaching intent; your assistant drafts; Studium checks that every
quote matches a source passage character for character and that the lesson is well formed. There
are three routes. Pick by what the lesson is for.

| Route | Best for | What you get | Can be approved for students |
|---|---|---|---|
| A. Conversational, through MCP | Trying an idea on your own sources in minutes, no shell | A playable lesson marked "agent-drafted, not teacher-validated" | No: it is a self-study lesson |
| B. Evidence packet, from the command line | A lesson you will give to students | A checked plan, its provenance, then a lesson file to approve | Yes |
| C. Literature with Perspicacité | Building route B's input from papers | A passage envelope with DOIs and provenance | Yes, through route B |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/teacher-journey-dark.svg">
  <img src="../assets/diagrams/teacher-journey-light.svg" alt="Teacher journey: sources, evidence packet, sourced draft, check and lint, MySTRA review, human approval, class.">
</picture>

## Route A, conversational authoring

Ask your assistant "I want to build a Studium lesson on X from these sources". With the Studium MCP
server connected (see [harnesses](../start/harnesses.md)), it calls three tools:

| Tool | What it does |
|---|---|
| `get_authoring_guide {language?, mode?}` | Returns the authoring brief, the draft schema and a minimal example. `mode: "teacher"` adds where the teacher route starts. |
| `prepare_sources {sources, goal?, language?}` | Cuts the source texts your assistant fetched into citable passages (up to 20 sources, 200 000 characters in total). |
| `create_lesson {source_set_id, draft, course_id?, overwrite?}` | Checks the draft (exact quotes, no TODO, a sound concept graph, the linter) and writes the lesson to the library. |

Both tools write into the library of the person whose assistant runs them,
`<STUDIUM_HOME>/library/<course_id>/lesson.json` (sources in `_sources/`), never into the server's
`BUNDLES_ROOT`, so a lesson of yours under `BUNDLES_ROOT` is never replaced; a course id already in
use there is refused. `overwrite: true` replaces only a self-study lesson that no teacher validated
or approved. The licence you give each source is copied into the lesson's citations.

This route only writes self-study lessons (`validated_by: SELF-STUDY — not teacher-validated`), and
`experience_packet.py approve` refuses them. Use it to see quickly how a lesson on your material
plays, then build the version for students with route B. The learner side of this route is
described in [learn with your assistant](../learn/learn-with-your-assistant.md); every tool is in
the [MCP tools reference](../reference/mcp-tools.md).

## Route B, the evidence packet

All commands run from the repository root with the Python environment from
[installation](../start/installation.md). Output paths must not exist yet: nothing is overwritten
unless you pass `--force`.

### 1. Prepare the packet

```bash
.venv/bin/python tools/experience_packet.py prepare \
  --passages work/passages.json --title "Does spectral similarity identify a molecule?" \
  --target "Master" --out work/packet
```

`--passages` takes a passage envelope, typically from Perspicacité (route C). The packet holds
`evidence.json` (text, DOI or URL, licence when known, origin, hashes), `author-task.md` (the brief
for your assistant) and `response.schema.json` (the format it must return). For an
[ASB](../concepts/glossary.md) capsule add `--capsule path/to/capsule --task-id TASK_ID`: the
capsule card is carried as data, its environment values are removed and no command is run.

To capture a single local document instead, `experience_packet.py passages` reads a URL, a saved
HTML page, a PDF with a text layer or a text file. Its passages carry the self-study brief; the
lesson built in step 4 is still a teacher lesson unless you add `--self-study`.

### 2. Have your assistant draft

Ask your assistant to read the three packet files and write its answer to a new file, for example
`work/author-response.json`. The answer holds a `lesson_plan`, `source_links` (scene, passage,
exact quote) and `viewers` (what each visual should let the student do). Your current assistant
session is enough; no extra provider or payment is configured.

In the plan, a concept may list the concepts it depends on (`prerequisites: ["base-concept"]`) and a
scene the concepts it works on (`concept_refs: ["target-concept"]`). `check` refuses an unknown
identifier and warns about a scene linked to no concept: such a scene cannot move any mastery.

### 3. Check the draft and render its provenance

```bash
.venv/bin/python tools/experience_packet.py check \
  --packet work/packet --response work/author-response.json --out work/courses/my-course
.venv/bin/python tools/experience_review.py work/courses/my-course
```

`check` refuses an approved status, an invented teacher validation, missing identifiers, inexact
quotes and execution results claimed in a draft. The second command adds `astra.yaml` and
`course_provenance.myst.md` for the MySTRA view. What to read in the output is in
[review and approve](review-and-approve.md).

### 4. Build the lesson file and fill it

```bash
.venv/bin/python tools/experience_packet.py bundle \
  --course work/courses/my-course --out work/library/my-course/lesson.json
```

The result is a playable lesson skeleton, marked `DRAFT — not validated`. It copies concepts and
prerequisites into the concept graph and adds the default rule that replays a concept after two
errors (`--no-default-rules` omits it). Fields you must write start with `TODO:`; a quiz starts
with two dummy choices and no hint. Fill them, then run the linter:

```bash
node tools/bundle_lint.mjs work/library/my-course/lesson.json
```

When there is no `ERROR` left, go to [review and approve](review-and-approve.md).

## Route C, literature with Perspicacité

Perspicacité searches the literature and returns passages with their DOI, URL and licence. Keep
its real JSON envelope and pass it to `prepare --passages`; the origin is recorded in the packet.
The shipped example `examples/literature-experience/passages.json` shows the expected shape.
Search strategy, capsules and exploration receipts are in
[literature and evidence](literature-and-evidence.md), and the
[literature to course tutorial](../tutorials/literature-to-course.md) runs the whole chain on the
shipped example.

## Limits

- An exact quote proves a textual link, not that the interpretation is right.
- A capture may cover only an excerpt of a paper, and its licence may be unknown: `check` reports
  `NC`, `ND` and unknown licences as `WARN`.
- Reproduction capsules may need their own dependencies; test them in the environment their
  manifest declares.

Code: [`tools/experience_packet.py`](../../tools/experience_packet.py),
[`tools/experience_review.py`](../../tools/experience_review.py),
[`apps/lesson-mcp/src/authoring-tools.ts`](../../apps/lesson-mcp/src/authoring-tools.ts).
