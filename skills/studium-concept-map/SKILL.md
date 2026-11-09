---
name: studium-concept-map
description: Show, read and export the concept map of a Studium lesson — where the learner stands on each concept, in the conversation, and as an interactive page that says what each concept rests on (sources, who wrote the key, who assessed each answer), with ASTRA provenance and an ARA trace, in a learner or a teacher viewpoint. Use whenever a learner asks where they are, what is left, why they were sent back, or where a lesson's teaching comes from; when a lesson ends or a session is to be kept, shared or checked; and when a teacher wants class figures laid over a lesson's concepts. Use studium-harness for the lesson loop and studium-learner-report for an activity trace or a journal.
---

# Studium concept map

The map is the lesson's concepts and their prerequisite links, with where this learner stands on
each. It exists in two forms: a few lines in the conversation while the lesson is played, and a
page to explore afterwards, where a click on a concept shows the questions the learner went
through, who assessed each answer and what the teaching of that concept rests on.

Resolve this skill's real path; the repository is two directories above it. The learner-facing
guide is [Concept map](../../docs/learn/concept-map.md). The invariants of
[studium-harness](../studium-harness/SKILL.md) hold here too: the learner answers and you relay,
and no key reaches the learner before an answer.

## What the map says, and what it does not

| State | It means |
|---|---|
| `acquired` | the latest assessed answer on the concept is right, or the session credited it as a prerequisite |
| `to_review` | the latest assessed answer is wrong |
| `current` | the scene on screen belongs to this concept |
| `seen` | scenes of the concept were gone through and nobody assessed an answer |
| `upcoming` | not reached yet |

States are facts of the session: scenes served, answers assessed, prerequisites credited. So read
the map as "what happened", never as "what is learned". `acquired` on one right answer is not
mastery, `seen` is not `acquired` (a written answer without a judge was recorded, not assessed),
and nothing on the map says a source is right. Whether a map helps learning has not been measured:
do not promise it.

Ignore the `state` field of the `get_workflow_graph` nodes when you talk to a learner. It reads
estimated mastery and can call a concept locked while the learner is studying it; `concept_map` is
the learner's view.

## In the conversation

The server decides when the map appears, because a map on every question is noise: at the start,
at a detour through a prerequisite and on the way back, on a scene that draws on several concepts,
and at the end. When a new concept opens it sends one position line instead. `display_markdown`
already carries the map or the line, so show it as it is. If your harness draws diagrams, render
`concept_map.mermaid` in place of the list, and keep the list when you are not sure the diagram
shows.

On request, or when the learner asks one of the questions below, call
`get_workflow_graph {session_id}` and show `concept_map.display_markdown`. Then say in one or two
lines what it shows, in the learner's words, starting from their question.

| The learner says | Answer with |
|---|---|
| "where am I?", "what is left?" | the map, then where they come from, where they are and what comes next (`position`) |
| "why am I back on this?" | `explain_last_adaptation {session_id}` first, then the map: the detour and the concept it returns to |
| "what should I revise?" | the concepts in `to_review`, then those in `seen`; for the schedule, `get_study_plan` |
| "did I get this one right?" | the questions listed under the concept, with their step and result |

The map is the server's public view, so showing it is safe at any time, a question waiting
included. What you must not add while a question waits is your own reading of it: a remark such
as "this is the concept you missed twice" is a hint. And do not redraw the map after each answer.

## When to offer the page

The page costs a command and writes files that hold the learner's results, so the export happens
on the learner's yes. Offering it is yours to do, once, at a moment when it answers something:

| Moment | Offer |
|---|---|
| The lesson ends | "Do you want the map as a page you can explore and keep?" after your two-line reading of the map |
| The learner doubts a statement or a key ("who says so?", "where does this come from?") | the page: each scene's sources, their origin, and who wrote the key |
| The lesson was drafted from a conversation or by an assistant, with no teacher | the page, because it marks what comes from a conversation with an assistant and was not checked |
| The learner must show their work to a teacher, a tutor or a peer | the page, with what it contains and does not contain (results, no answers, no identifier) |
| A teacher prepares a debrief or a second pass on a lesson | the teacher viewpoint with the class figures (below) |

Leave it out when the lesson has fewer than two concepts or is a review session (there is no map),
when your setup has no shell to run the tool, and when the learner already said no in this
session. In the middle of a lesson, prefer the map in the conversation: the page is for a pause.

## Export the page

1. `export_concept_map {session_id}`. Show its `display_markdown`. It returns `saved_to` (the record,
   under `<library>/_exports/concept-maps/`) and `sha256`. With `saved_to: null` the server has no
   library and wrote no file: say so, and stay with the map in the conversation.
2. From the repository root, into a directory that does not exist yet:

   ```bash
   .venv/bin/python tools/concept_map_report.py export SAVED_TO NEW_DIR --expect-sha256 SHA256 --language fr
   ```

   `--expect-sha256` refuses a record that is not the file the server wrote. `--language` is `fr` or
   `en` and defaults to the lesson's language.
3. Verify, and read the result before you call the package verified:

   ```bash
   .venv/bin/python tools/concept_map_report.py verify NEW_DIR
   ```

   It recomputes every file from the record and runs the installed `astra-tools` validator. A
   failure names the file that differs: report it, do not hand over the page as verified.
4. Give the learner `NEW_DIR/index.html`. It is one file, with no network access and no server. If
   your harness can open or render a local page, do it; otherwise give the full path.

The record is a snapshot: export again after more steps for an up-to-date page, into a new
directory. The server never overwrites a record.

## Read the page with the learner

Start from what they wanted to know and point at one thing:

- a concept of the graph opens its panel: what it requires, what it leads to, the steps played with
  their result and who assessed each (`key`, `judge`, or nobody), then the scenes with their sources;
- a step of the session path opens the concept it belongs to;
- the header says who drafted the lesson and whether a teacher validated it.

Say the three limits when they matter. A passage is quoted only for a scene the learner has left,
because a passage can state the key of its question: a scene still on screen shows its sources
without their text. After a server restart, the steps played before it keep their result but lose
who assessed them and how the session routed. And the page checks nothing about the sources: for a
lesson drawn from a conversation, what the assistant asserted is taught as it stands. If the
learner wants a claim checked, follow
[Literature and evidence](../../docs/teach/literature-and-evidence.md).

For a reviewer who wants the standards behind the page, the package holds `astra.yaml` (the record
as a declared artifact, the choices made, technical findings), `trace/exploration_tree.yaml` (one
node per step, one pivot per detour) and a MySTRA page;
[studium-observatory](../studium-observatory/SKILL.md) serves the package like a learner report.

## The teacher viewpoint and class figures

The teacher viewpoint shows the lesson's structure and what each concept rests on. To lay the
class's figures over it:

1. With the server on the class's data folder, call `class_report {course_id}` as
   [studium-teacher](../studium-teacher/SKILL.md) describes (`course_id` is the lesson's folder
   name), and save the JSON it returns to a file. The export copies the figures it shows, so that
   file can be deleted afterwards.
2. Get a record with no learner's path: `start_lesson_session {bundle_ref: "<course_id>/lesson.json",
   learner_id: "<an id of the teacher's own>"}`, then `export_concept_map {session_id}` at once.
   Make these two calls on a server that keeps nothing: the same launch command with
   `STUDIUM_EPHEMERAL=1`, `STUDIUM_DATA_DIR` unset and `BUNDLES_ROOT` on the lessons folder, added
   as a second server entry or by relaunching the entry for the time of the export. The record is
   still written, under `<STUDIUM_HOME>/library/_exports/concept-maps/`. On the class's server the
   session would count as one more learner who started the lesson, and a record of a played
   session would put that learner's steps on a class view. If you cannot reach such a server,
   say so and ask the teacher before starting anything on the class's server.
3. Export with the figures, then verify as above:

   ```bash
   .venv/bin/python tools/concept_map_report.py export SAVED_TO NEW_DIR --expect-sha256 SHA256 --class-report class-report.json
   ```

The teacher's request is the go-ahead here: the yes of a learner is for a learner's own record.

Each concept then shows its success rate, hint reliance, calibration gap and mean time. The
concepts marked to reteach first are those of the report's `reteach_priority`; the page adds no
ranking of its own. A concept with no row in the report says so, and a figure under the learner
floor is shown as withheld, which is not zero. The tool refuses a class report for another lesson
and one with no publishable figure. The report holds no individual figure; read it with the
teacher as a live class view, with the cautions of the teacher skill. This viewpoint was built
and tested with synthetic figures: on a first real report, compare two or three figures on the
page with the report itself before the teacher relies on it, and say that you did.

## Keeping, sharing, erasing

Records and pages stay on the learner's machine. Sharing a page is the learner's act, and a
separate one: a yes to an export is not a yes to sending it. Before any sharing, say what the page
holds: the lesson's structure and sources, the result of each step, no learner identifier and none
of the learner's words. A teacher's class view needs no learner's page at all.

`forget_session` erases the learner's progress and leaves the exports: its `display_markdown` names
the folder, which the learner deletes by hand. Pages you built elsewhere are copies; say where they
are when someone asks to erase a record.
