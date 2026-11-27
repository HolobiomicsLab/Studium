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

- A teacher's lesson: a course folder holding `lesson.json` (or a `.zip` bundle). A
  `.studium.zip` file downloaded from a course page is imported in VS Code with
  **Studium: Import a lesson…**, which shows who approved it before copying it into the
  library.
- No lesson, but a topic and sources of their own: use
  [studium-self-learner](../studium-self-learner/SKILL.md).
- Neither: use « Discover Studium » (refs `discover-studium-en` and `discover-studium-fr`, 14 steps,
  about twelve minutes, on how Studium works and where to plug it in). It ships with the extension,
  the npm server and the `.mcpb`; no checkout and no `BUNDLES_ROOT` are needed. `get_study_plan`
  proposes it to a learner with no lesson; `list_lessons` returns it in `shipped_lessons`. In the VS
  Code Lessons view, the « Discover Studium » button opens it. The `fixtures/` demos
  (`atomistique-l1`...) are for checkout users only.

A PDF, a packet or a checked author draft is not a playable lesson.

## Connect with the least setup

Steer a non-expert to the lightest route, no terminal and no Node, and only fall back to the
next one when it does not fit ([Start without a terminal](../../docs/start/easy-start.md)):

1. VS Code with the Studium extension (`holobiomicslab.studium-vscode`), which carries its own
   server. Run **Studium: Connect an Assistant…** (or the link in the Lessons view), tick the
   assistants in use (Mistral Vibe, Codex, Claude Code, Claude Desktop, Cursor, OpenCode); it writes
   one `studium` entry into each one's own file. Then reload the VS Code window for assistants
   that run inside it (Vibe, Codex, Claude Code extensions), or quit and reopen Claude Desktop,
   Cursor or OpenCode. It warns when another server already runs Studium and never removes an
   entry it did not write.
2. Copilot in VS Code 1.101 or later: the extension's server is registered automatically.
3. Claude Desktop without VS Code: the release's `studium-vX.Y.Z.mcpb`, double-click and choose
   Install (Claude Desktop runs it with its own Node). Installing it in Claude Desktop itself has
   not been tried yet: say so.
4. Only then the terminal route, which needs Node 20 or later (`npx -y studium-mcp`, `claude mcp
   add`, `codex mcp add`), the Claude Code plugin, the browser player, or a checkout.

For the rest, follow [Installation](../../docs/start/installation.md). The VS Code pane needs no
model account ([VS Code](../../docs/start/vscode.md)); a chat assistant connected over
MCP is the other route ([Connect your assistant](../../docs/start/harnesses.md)).
Python authoring services are not needed for an ordinary lesson; add a scientific
environment only when the activity needs one.

For Copilot, follow [Connect Copilot in VS Code](../../docs/start/copilot.md).
Check current official eligibility when advising: education verification and Copilot
activation are separate steps. Do not promise approval, unlimited use or API credits.
Keep school proofs and account credentials out of the chat and the repository; the
student uses the provider's own flow. If it is unavailable, offer the pane demo or an
assistant they already have rather than assuming payment.

On the terminal route, merge the matching example from `docs/examples/` without overwriting other servers,
with `LITELLM_BASE_URL=""` unless a live route was requested. Then verify with real
calls: `get_server_info` (the tool list and `persistence.durable`), then
`start_lesson_session`. A config file, or a model saying "connected", is not
verification.

Choose one owner for the session: the pane and a chat assistant run separate servers
with separate progress. Never mix their session ids or promise synchronisation. The one
exception is Copilot with the server the Studium VS Code extension registers: it plays the
pane's learner (`persistence.learner_id_from_editor` is true), so a lesson opened in one
goes on where the other left it (in the pane, a step already done can be revisited from the progress bar, then resumed), and a result that carries `open_link` offers the pane first,
unless the learner last answered in the chat (`offer_first: "chat"`).

## Begin the activity

Read [studium-harness](../studium-harness/SKILL.md) for the loop and use
[Your first lesson](../../docs/tutorials/first-lesson.md). Omit `learner_id` on every call and never make one up:
the server plays one learner, the person using you, and ignores an id you pass. Relay the lesson's `authoring.notice` when
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
- When the student is stuck on a quiz, offer the next authored hint (`request_hint`): it counts
  against mastery, and `hint: null` means none is left. Otherwise ask a question about the
  method, then wait.
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
with neither, every lesson's progress too. Show its `display_markdown`, which
names what stays on disk: the lessons of the student's library, their prepared sources and
the exported map pages. The lesson's experiment journal is erased with its progress; files
the student saved elsewhere and the assistant's own history are outside Studium. The VS Code
pane keeps its own progress, erased by its own command (**Studium: Forget my data**). See
[Privacy and limits](../../docs/concepts/privacy-and-limits.md).

## When something is wrong

- **In the lesson's content** (a key that looks wrong, an unclear statement): the lesson belongs
  to its teacher. Help the student note the lesson, the scene's title and the sentence, and tell
  their teacher: Studium has no tool that sends it for them. Never open the key to check.
- **In Studium itself** (an error on a correct call, a step of a guide that fails, something
  Studium cannot do): say so and get the student working again. Then, at a pause and never while
  a question waits, invite them once to report it:
  [studium-contribute](../studium-contribute/SKILL.md). A student needs no GitHub account for
  that: the draft can go to their teacher.
- Items that classmates proposed and the teacher approved are short lessons of their own:
  `list_community_bundles` lists them ([studium-harness](../studium-harness/SKILL.md)).

## Experiment and keep a report

For an interactive example tied to the current scene, use
[studium-activity-templates](../studium-activity-templates/SKILL.md). The student
chooses whether to export semantic actions; this is not a recording of every chat or
keystroke. For a local portfolio or a teacher copy, use
[studium-learner-report](../studium-learner-report/SKILL.md). Original free text is
excluded by default; the student chooses whether to include it in that report.
