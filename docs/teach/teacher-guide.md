English · [Français](teacher-guide.fr.md)

# Teacher guide

Studium helps you turn sources you trust into a lesson your students can play, with every
graded item tied to a passage you can check. You decide what is taught, what the sources
allow you to claim, and when a lesson reaches students. A lesson that passes every technical
check stays a draft until you approve it; that human decision before any distribution is the
project's rule 003.

This page walks through the whole journey and links to the page for each step. To have your
assistant guide you through it, load the `studium-teacher` skill (see [skills](../start/skills.md)).

## The journey at a glance

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/teacher-journey-dark.svg">
  <img src="../assets/diagrams/teacher-journey-light.svg" alt="Teacher journey in seven steps: sources, evidence packet, sourced draft, check and lint, MySTRA review, human approval, class; below it, the learner-contribution loop: submission, dashboard review, decision, community bundle.">
</picture>

| Step | What you do | Result | Page |
|---|---|---|---|
| Prepare | Choose a question, an audience and the sources you may use | A pilot plan | [below](#prepare-the-activity) |
| Author | Have your assistant draft the lesson from captured passages | A checked draft | [Author a lesson](author-a-lesson.md) |
| Review | Read the plan, the quotes, the keys and the provenance | Your corrections | [Review and approve](review-and-approve.md) |
| Approve | Record your decision for the exact lesson file | `approval.json` | [Review and approve](review-and-approve.md#approve-the-exact-file) |
| Distribute | Give students the lesson folder | Lessons in their library | [below](#distribute-a-lesson) |
| Follow a class | Read class-level aggregates, never a single student | A class report | [Follow a class](follow-a-class.md) |
| Moderate | Review what learners propose to add | Community items | [Learner contributions](learner-contributions.md) |

Approval also writes a receipt of the items you opened and your verdict on each graded item. To send a
lesson back without approving it, record a returned receipt instead; see
[Review and approve](review-and-approve.md#approve-the-exact-file).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/teacher-library-dark.png">
  <img src="../assets/screenshots/teacher-library-light.png" width="720" alt="The teacher dashboard library, in French: counts of courses, checked and approved lessons, then each lesson with its language, author, number of scenes and concepts, duration, badges for its key classes, a Checked status and a Review button.">
</picture>

<em>The teacher dashboard library: each lesson with who holds its answer keys and its review status.</em>

## Before you start

1. Install Studium: [installation](../start/installation.md).
2. Play a lesson yourself to see what a student receives: [first lesson](../tutorials/first-lesson.md).
3. Connect your assistant (Codex, Claude Code, Copilot, OpenCode or another MCP client):
   [harnesses](../start/harnesses.md). No extra model provider is needed to author through it.
4. Follow the [literature to course tutorial](../tutorials/literature-to-course.md) once,
   on the shipped example, before using your own material.

## Prepare the activity

Start from a question that asks for more than a computed output, for example "Is a high
spectral similarity enough to identify a molecule?". Then separate:

- the concept to understand and the task to carry out;
- the expected observation and the limit to discuss;
- a new case to check transfer.

Decide the pilot: audience, prerequisites, duration, judgement question, what students may
explore, which materials are allowed and how results are returned. A framing prompt for your
assistant can look like this:

> Prepare a Studium draft for [audience], in [duration], on [question]. Use only the passages
> and materials in the packet. Separate the paper's results, hypotheses and synthetic data.
> Ask for a prediction before any run, a comparison and a transfer question. Flag missing
> evidence. Mark nothing as approved and invent no capsule result.

The [use cases](../tutorials/use-cases.md) show complete examples (spectral annotation,
diagnosing an analysis, robustness, photographs in archaeology). Ready-made interactive
starters are in [activity templates](activity-templates.md); figures, equations and media in
[media and visual support](media-and-visual-support.md).

## Distribute a lesson

A lesson is a folder: `lesson.json`, its `assets/` and, once approved, `approval.json`. Keep the
three together and at the same revision. A lesson shipped as a `.zip` carries the record as its
member `approval.json` (the demo build scripts add it when it matches `lesson.json`); without it the
lesson reads "No approval is recorded for this lesson." Students place the folder in their Studium library
(by default `~/.studium/library/<course_id>/`, or the folder `BUNDLES_ROOT` names) and open it
from their assistant or from VS Code (see [VS Code](../start/vscode.md)). When a learner starts
the lesson, the session reports whether an approval record matches the exact file.

For a class:

- start with a few students and check the session on their machines (bundle access, display,
  language, behaviour when the model or the network is unavailable, export);
- give written instructions and a fallback if the assistant account or the internet fails;
- the VS Code package makes the lesson pane easy to install, but it does not distribute or
  validate lessons for you.

## Run an experiment session

When a lesson lets students explore with their assistant, set a concrete scope: data, commands,
dependencies, web access, interactive controls and duration. Redisplaying the approved materials
can stay inside the activity; a new claim, exercise or scene generated beyond that scope is a
draft you review before use. Studium does not yet enforce that boundary for you.

Ask students for their prediction, the differences they observed, one limit and a transfer test.
An agent's output is not evidence that the student understood. The
[agentic experiment tutorial](../tutorials/agentic-experiment.md) gives a full run, and
[literature and evidence](literature-and-evidence.md) explains the portable exploration receipt.

## What students can share with you

A student may choose to export a [learner report](../learn/learner-report.md) of their recorded
actions, and keeps a private [experiment journal](../learn/experiment-journal.md). Discuss with
them what will be shared and how you will read it: an incomplete trace does not measure autonomy.
The default report excludes personal text and gives no access to the full journal or the
assistant's history. See [privacy and limits](../concepts/privacy-and-limits.md).

The [interaction report](follow-a-class.md#how-the-interface-was-used) shows how a consenting class used
the interface. To lay those class figures over the lesson's concepts, use `tools/concept_map_report.py`
and the [concept map's teacher viewpoint](../learn/concept-map.md#the-teacher-viewpoint-and-class-figures).

## Limits

- Technical checks (schema, exact quotes, lint) are not a pedagogical review; an exact quote can
  still be misread.
- The approval record names the reviewer you type; Studium does not authenticate it.
- The dashboard, Observatory and analytics services are local tools without login; do not expose
  them on the internet.
