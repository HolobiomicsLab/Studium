---
name: studium-teacher
description: Help a teacher install Studium, connect their chosen AI harness, draft a literature- or ASB-grounded lesson, review it (review_lesson, MySTRA), record approval with experience_packet.py approve, and read a class report (class_report). Use for teacher onboarding, course preparation, review and class follow-up; use studium-harness for a live lesson.
---

# Studium teacher onboarding and preparation

Help the teacher reach a small, inspectable outcome: a checked draft, a lesson file
they reviewed, an approval record, a class view. Use their language, their harness and
the account they already have. Drafting with the current assistant needs no other API
provider.

## Locate the materials

Resolve this skill's real path through any symlink; the repository root is two levels
above the skill directory. Check for `tools/experience_packet.py` and
[the teacher guide](../../docs/teach/teacher-guide.md). If the skill was installed
separately, use the teacher's checkout or ask for it; never assume a personal path. No
private hub is needed.

Read the teacher guide and only the next relevant page. Infer whether the teacher needs
installation, a first example, a draft from their own sources, the review of an
existing draft, approval, or a class report. Continue at that step; do not restart a
finished installation or overwrite their work.

## Install and get a first result

- Follow [Installation](../../docs/start/installation.md) for Node and the Python
  environment (`.venv`). A source clone, a VSIX and a lesson bundle are different
  deliveries.
- Connect the harness with [Connect your assistant](../../docs/start/harnesses.md).
  Merge only the Studium entry; never expose credentials or overwrite other servers.
  Verify with `get_server_info`: a configured entry is not a working connection.
  When advising on Copilot or another account, check current official eligibility;
  teacher benefits and Copilot Student are distinct. Promise no quota or credits.
- For a first look, run [Literature to course](../../docs/tutorials/literature-to-course.md)
  into a new folder: its captured example needs no live search and no paid model.

## Draft a lesson

Pick the route with the teacher ([Author a lesson](../../docs/teach/author-a-lesson.md)):

| Route | Use it for | Approvable for students |
| --- | --- | --- |
| Conversational: `get_authoring_guide {mode: "teacher"}`, `prepare_sources`, `create_lesson` | a quick try of how a lesson on their material plays | No: it writes a self-study lesson |
| Evidence packet: `experience_packet.py prepare`, `check`, `bundle` | a lesson for students | Yes |
| Literature with Perspicacité, then the packet | building the packet from papers | Yes |

A lesson drafted through the conversational route lives in the library of the person
whose assistant drafted it, `<STUDIUM_HOME>/library/<course_id>/lesson.json`
(`persistence.library_root` in `get_server_info`), never in the server's
`BUNDLES_ROOT`; a course id already served from `BUNDLES_ROOT` is refused. It is marked
as drafted by the agent and can never be approved. To give that material to students,
rebuild it through the packet route.

For the packet route, from the repository root:

```bash
.venv/bin/python tools/experience_packet.py prepare --passages PASSAGES.json --title "T" --target "Audience" --out work/packet
# the harness reads author-task.md, evidence.json and response.schema.json and writes work/author-response.json
.venv/bin/python tools/experience_packet.py check --packet work/packet --response work/author-response.json --out work/courses/COURSE
.venv/bin/python tools/experience_review.py work/courses/COURSE
.venv/bin/python tools/experience_packet.py bundle --course work/courses/COURSE --out work/library/COURSE/lesson.json
node tools/bundle_lint.mjs work/library/COURSE/lesson.json
```

- Identify the audience, a concept-linked question and the supplied materials; ask
  only for inputs that change the next step. Use actual passages, and an explicit ASB
  task id (`--capsule DIR --task-id ID`) when provided. For literature retrieval, use
  an available research tool and keep its real response envelope; if none is
  available, say so and use authorised captured material. Never invent sources or
  claim a live search that did not happen.
- In the plan, put each scene's concepts in `concept_refs` and each concept's
  dependencies in `prerequisites`. Every no-concept warning and every item under
  `Not verifiable by quote:` is teacher-review work. The cross-language quote label is
  a word-based hint, not language identification.
- `check` refuses an approved status, an invented validation, inexact quotes and
  claimed results; `--json` gives one machine-readable report. `bundle` writes a
  skeleton: fill every `TODO:` field, then lint until no ERROR remains. Use `--force`
  only when the teacher means to replace that output.
- Keep scientific claims, synthetic examples and unexecuted capsule commands distinct.
  A checked draft is not teacher approval.

## Review before approval

Ask the teacher to read the interpretation of each source, the prerequisites, the
response criteria, the workload and a transfer question, and to define what students
may explore (data, tools, dependency installation, new content). Four views help
([Review and approve](../../docs/teach/review-and-approve.md)):

- the `check` report;
- `review_lesson {course_ref}`: scene plan, key class of each scene (`author_keyed`,
  `production`, `externally_grounded`), remaining TODOs, lint verdict (the linter runs
  inside the server), whether an approval record matches this exact file
  (`approval.matches`), and `ready_for_approval`. `ready_for_approval` is true when the
  file is valid, has no TODO and no lint ERROR: the file can be approved, which says
  nothing about whether its content is right. It looks for the course under the
  server's `BUNDLES_ROOT`, then in the learner's library, refuses `.zip` bundles and
  never returns answer keys, hints or reveals, not even inside a finding; the teacher
  reads keys in the file itself;
- `node tools/bundle_lint.mjs`;
- the MySTRA view in the [Observatory](../../docs/teach/observatory.md)
  ([studium-observatory](../studium-observatory/SKILL.md)). Hashes and schema validity
  are not scientific approval.

## Record the teacher's approval

Only the teacher approves. Never insert their name or approve on their behalf; ask
them to run, or explicitly confirm, the command with their own name:

```bash
.venv/bin/python tools/experience_packet.py approve --bundle work/library/COURSE/lesson.json \
  --validated-by "Teacher Name" --checklist sources=read keys=checked
```

`approve` refuses a lesson with a remaining placeholder, a lint ERROR, or a self-study
lesson. It sets `validated_by` and `validated_at`, normalises the JSON (so the file's
SHA-256 changes once) and writes `approval.json` next to the lesson, bound to the
SHA-256 of the new bytes. It prints a short summary (reviewer and time, SHA-256, lint
error and warning counts, the stale-approval reminder), then the path of
`approval.json` as its last line: show both to the teacher. Any later edit makes the
approval stale (`review_lesson` reports `approval.matches: false`) and calls for a new
review and a new `approve`. Approval sends the lesson to no one; distribution is a separate
step the teacher decides ([Teacher guide](../../docs/teach/teacher-guide.md#distribute-a-lesson)).

When scenes are generated by a configured synthesis orchestrator,
`tools/experience_approval.py` fixes the reviewed plan before synthesis (`import`,
`approve`, `verify`, `synthesize`); the generated lesson still needs review and
`experience_packet.py approve`. Do not rename a draft to `lesson.json` or replan
silently after approval.

## Follow a class

With the server configured on the class's data folder, `class_report {course_id}`
returns per-scene and per-concept aggregates over consented telemetry. It takes
`course_id` only: the data folder is server configuration (`STUDIUM_DATA_DIR` or
`STUDIUM_HOME`), and an extra argument such as `telemetry_dir` is refused. Say which
folder the report covers from `data_folder {label, fingerprint}` (the folder's name
and a short hash of its path, never the path).

How to read the figures with the teacher:

- accuracy counts only answers a key or a judge graded; a keyword score is an attempt,
  not a grade;
- hint reliance is the share of answering learners who asked for a hint (0 to 1);
- the calibration gap uses only the answers learners rated;
- completion is completed over started.

Each figure needs at least 5 learners in its own population (graded, rated, timed or
started learners, depending on the figure), and a scene or concept row needs 5
answering learners. Below that the figure is withheld (`null`) or the row left out,
and the report sets `withheld_below_floor: true`. Withheld means some learners
contributed but too few to show; not measured means nobody contributed (for example
`n_measured: 0`: no key or judge graded that scene). Learner counts are banded
(`cohort_band`); attempt counts are exact. Two reports taken before and after
one more learner plays can still be compared: present figures as a live class view,
not a release.

The command-line twin, `.venv/bin/python tools/class_report.py DATA_DIR --out DIR`,
follows the same rules; its Markdown writes "withheld (fewer than k)" or "not
measured", and each concept row lists its `withheld_figures`. Its concept figures can
differ from the tool's when a scene is withheld, since it has no scene rows. The
teacher dashboard shows the library and review status. See
[Follow a class](../../docs/teach/follow-a-class.md).

## Close with a usable checkpoint

Return the actual paths created, what was checked, the draft, review or approval status
and the teacher's next action. Keep student data and API keys out of exports. A local
preview is not publication. To try a lesson, use [studium-harness](../studium-harness/SKILL.md)
with a labelled demonstration, or [studium-student](../studium-student/SKILL.md) for a
student's own first session. Never fabricate learner answers.

## Activities, reports and media

- [studium-activity-templates](../studium-activity-templates/SKILL.md) turns a public
  scene into an editable activity with a baseline and source-linked checks.
- [studium-learner-report](../studium-learner-report/SKILL.md) reads a report the
  learner chose to share. Action traces do not establish learning or permission to read
  the full private journal.
- [studium-visual-support](../studium-visual-support/SKILL.md) and
  [Media and visual support](../../docs/teach/media-and-visual-support.md) cover
  photographs, narrated introductions and short clips: record source and rights, keep
  generated reconstructions distinct from evidence, provide text alternatives,
  transcripts and captions. A generated explanation is not approval of new content.
- Learner-proposed scenes are reviewed as in
  [Learner contributions](../../docs/teach/learner-contributions.md).
