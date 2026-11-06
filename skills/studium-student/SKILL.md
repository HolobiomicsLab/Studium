---
name: studium-student
description: Help a student install or connect Studium, activate an eligible Copilot Student setup or use another harness, and begin a lesson with their own responses. Use for student onboarding and first-session troubleshooting; use studium-harness for the ongoing tool loop and studium-self-learner to build a lesson from the student's own sources.
---

# Studium student onboarding

Help the student reach one working activity and submit their own response. Match
their language and the tools they already have. Keep installation details
proportional to what is missing; do not turn a learning request into repository
development.

## Find the starting point

Resolve this skill's real directory through any symlink; the Studium root is two
levels above it. Read the [student guide](../../docs/learn/student-guide.md). If the
skill was installed separately, use the checkout or course the student supplies
rather than assuming a personal path. No private hub is needed.

Infer whether a teacher supplied a lesson, whether the student prefers the VS Code
pane or a chat assistant, and what is already installed. Ask only for what is
missing next.

- A teacher's lesson: a course folder holding `lesson.json` (or a `.zip` bundle).
- No lesson, but a topic and sources of their own: use
  [studium-self-learner](../studium-self-learner/SKILL.md).
- Neither: use the labelled demo `atomistique-l1/lesson.json` from `fixtures/`.

A PDF, a packet or a checked author draft is not a playable lesson.

## Connect with the least setup

Follow [Installation](../../docs/start/installation.md). The VS Code pane needs no
model account ([VS Code](../../docs/start/vscode.md)); a chat assistant connected over
MCP is the other route ([Connect your assistant](../../docs/start/harnesses.md)).
Python authoring services are not needed for an ordinary lesson; add a scientific
environment only when the activity needs one.

For Copilot, follow the Copilot section of [Connect your assistant](../../docs/start/harnesses.md#copilot-in-vs-code).
Check current official eligibility when advising: education verification and Copilot
activation are separate steps. Do not promise approval, unlimited use or API credits.
Keep school proofs and account credentials out of the chat and the repository; the
student uses the provider's own flow. If it is unavailable, offer the pane demo or an
assistant they already have rather than assuming payment.

Merge the matching example from `docs/examples/` without overwriting other servers,
with `LITELLM_BASE_URL=""` unless a live route was requested. Then verify with real
calls: `get_server_info` (the tool list and `persistence.durable`), then
`start_lesson_session`. A config file, or a model saying "connected", is not
verification.

Choose one owner for the session: the pane and a chat assistant run separate servers
with separate progress. Never mix their session ids or promise synchronisation.

## Begin the activity

Read [studium-harness](../studium-harness/SKILL.md) for the loop and use
[Your first lesson](../../docs/tutorials/first-lesson.md). Ask for one stable
`learner_id` and pass it on every call. Relay the lesson's `authoring.notice` when
present, show each `display_markdown`, then wait for the student.

- Keep answers fast: play the lesson in a short session of its own, on the harness's fast model
  (Claude Code: `claude --agent studium-lesson`), and add nothing to a screen unless the student
  asks. See "Keep each turn short" in [studium-harness](../studium-harness/SKILL.md).
- Do not read answer keys in the raw bundle, give the answer before the attempt, or
  submit a schema example as the student's work.
- Send their words with `submit_response {session_id, input: {kind: "reply", text}}`.
  Confidence is optional where allowed and always comes from the student.
- When a transition carries `self_rating`, ask the student to rate their recall and
  pass their rating to `rate_recall`; never rate for them.
- Give a scaffolded hint (`request_hint`) or a question about the method when useful,
  then wait.
- Explain an adaptation from the actual tool result (`explain_last_adaptation`); do
  not invent mastery.
- For experiments, ask for a prediction before execution and a personal conclusion
  after. Use the [agentic experiment tutorial](../../docs/tutorials/agentic-experiment.md)
  within the teacher's scope; missing tools or failed runs stay visible. Offer the
  [experiment journal](../../docs/learn/experiment-journal.md) when the student wants
  to save those contributions. Never infer consent or confidence.

## Verify and hand back

Success is a real scene loaded and a student-authored response producing feedback or a
transition. Smoke or stub runs are technical demonstrations, not evidence of learning.
If blocked, use [Troubleshooting](../../docs/start/troubleshooting.md) and report the
failing step with a small anonymised error, not a claim of success.

Close with the next activity or a short resume note (lesson, public context, relevant
local files). `end_session` closes and keeps progress; on a later day,
`get_study_plan` and `start_review_session` (with the student's `language`) bring the
due reviews back ([Review over time](../../docs/learn/review-over-time.md)). Use
`forget_session` only on an explicit erasure request and explain its scope: with
`session_id`, this lesson's progress, the cross-lesson profile and the review schedule;
with `learner_id`, every lesson's progress too. Show its `display_markdown`, which
names what stays: lessons in the student's library and their sources, exports,
experiment folders and the assistant's history are not erased. See
[Privacy and limits](../../docs/concepts/privacy-and-limits.md).

## Experiment and keep a report

For an interactive example tied to the current scene, use
[studium-activity-templates](../studium-activity-templates/SKILL.md). The student
chooses whether to export semantic actions; this is not a recording of every chat or
keystroke. For a local portfolio or a teacher copy, use
[studium-learner-report](../studium-learner-report/SKILL.md). Original free text is
excluded by default; the student chooses whether to include it in that report.
