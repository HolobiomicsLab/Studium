---
name: studium-teacher
description: Help a teacher install Studium, connect their chosen AI harness, prepare a literature- or ASB-grounded lesson draft, and review it in MySTRA before a student pilot. Use for teacher onboarding and course preparation; use studium-harness for a live lesson.
---

# Studium teacher onboarding and preparation

Help the teacher reach a small, inspectable teaching outcome. Use their language,
existing harness and available account. Do not require another API provider just
to generate a draft with the current agent.

## Locate the materials

Resolve this skill's real path if loaded through a symlink. Its repository root
is two directories above the skill directory. Check for `docs/user/teacher-guide.md`
and `tools/experience_packet.py`. If the skill was installed separately, use the
user's supplied Studium checkout or ask for its location; never assume a personal
machine path. Do not require the private development hub to use the public guides.

Read [the teacher guide](../../docs/user/teacher-guide.md) and only the next relevant
page. First infer whether the teacher needs installation, a first example, their
own source packet, or review of an existing draft. Preserve existing work and
continue at that step; do not restart a completed installation.

## Installation and first result

- Follow [installation](../../docs/getting-started/installation.md) for Node and
  the teacher Python venv. Check commands against the actual checkout. A source
  clone, a VSIX and a course bundle are different deliveries.
- Use [Copilot setup](../../docs/getting-started/copilot.md) if chosen; otherwise
  [the harness/API guide](../../docs/getting-started/harnesses-and-api.md). Verify
  current official eligibility when advising about an account. Teacher benefits
  and Copilot Student are distinct; do not promise quotas, approval or free API credits.
- Inspect existing MCP configuration before merging only the Studium entry.
  Do not expose credentials or overwrite other servers. Authenticate through the
  client's supported flow; an installed server is not proof of a working connection.
- For a first review, run the supplied [literature tutorial](../../docs/tutorials/literature-to-course.md)
  into a new local directory. The captured example works without live research
  or a paid model. Verify outputs, then open the local MySTRA route if useful.

## Prepare the teacher's activity

Identify the audience, concept-linked question and supplied materials. Ask only
for missing inputs that affect the next step. Use actual passages and an explicit
ASB task ID when provided. For literature retrieval, use an available relevant
research skill/connector and preserve its real response envelope. If unavailable,
say so and use authorized captured materials; do not invent sources or silently
claim a live search.

Have the harness read the packet's `author-task.md`, evidence and response schema.
Produce a draft with exact source links, then run `check` and `experience_review`.
Keep scientific claims, synthetic examples and unexecuted capsule commands distinct.
The checker produces a draft, not a playable bundle or teacher approval.

Ask the teacher to examine the source interpretation, prerequisites, response
criteria, workload and a transfer question. Define what students may explore:
data, tools, dependency installation and new content. Do not present MySTRA hashes
or schema validity as scientific approval. Follow the real approval boundary;
never insert the teacher's name or set `approved` on their behalf.

For a checked source-backed draft, use the [reviewed synthesis workflow](../../docs/user/reviewed-synthesis.md).
Import to a local teacher workspace, preserve edits to its actual `plan.json`,
and let the teacher review before recording approval of that exact revision.
Verify the receipt before synthesis with an explicitly configured orchestrator.
The CLI preserves the approved input; the older browser export alone does not.
Generated content still needs teacher review before students receive it. Do not
rename a draft to `lesson.json` or silently replan after approval.

## Close with a usable checkpoint

Return the actual paths/URLs created, what was checked, draft/review status and
the next teacher action. Keep student data and API keys out of exports. A local
preview is not publication; respect existing authorization before distribution.
When the teacher wants to try a lesson, use [studium-harness](../studium-harness/SKILL.md)
with a labelled demonstration, or [studium-student](../studium-student/SKILL.md)
for the student's own first session. Do not fabricate learner answers in either.

## Interactive activities and learner reports

Use [studium-activity-templates](../studium-activity-templates/SKILL.md) to turn a
public scene into an editable activity with a baseline and source-linked checks.
Use [studium-learner-report](../studium-learner-report/SKILL.md) to inspect a report
the learner selected for review. Technical action traces do not establish learning
or permission to inspect the full private journal. Keep proposed patterns distinct
from runnable templates and content review distinct from schema conformance.

For photographs, reusable narrated introductions or short clips, use
[studium-visual-support](../studium-visual-support/SKILL.md) and the
[media preparation guide](../../docs/guides/sourced-and-generated-media.md).
Prefer reviewed teacher preparation once, with optional learner generation through
their own available harness. Record source/rights, keep generated reconstructions
distinct from evidence, provide text alternatives/transcripts/captions, and place
primary observation material before prediction. A generated explanation does not
change the learning objective or constitute approval of new teaching content.
