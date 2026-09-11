---
name: studium-student
description: Help a student install or connect Studium, activate an eligible Copilot Student setup or use another harness, and begin a lesson with their own responses. Use for student onboarding and first-session troubleshooting; use studium-harness for the ongoing tool loop.
---

# Studium student onboarding

Help the student reach one working activity and submit their own response.
Match their language and existing tools. Keep installation details proportional
to what is missing; do not turn a learning request into repository development.

## Find the starting point

Resolve this skill's real directory through any symlink; the Studium root is two
levels above it. Read [the student guide](../../docs/user/student-guide.md). If
installed separately, locate the checkout/course supplied by the user rather
than assuming a personal path. The public onboarding does not require a private hub.

Infer whether a teacher supplied a bundle, whether the pane or an agent is chosen,
and what is already installed. Ask only for the missing information needed next.
Without a supplied course, use the labelled `atomistique-l1/lesson.json` example.
Do not treat a PDF or checked author draft as a playable bundle.

## Connect with the least additional setup

Use [installation](../../docs/getting-started/installation.md). The pane demo needs
no LLM account; Node/MCP plus the student's existing agent is another route.
Python authoring services are not a prerequisite for an ordinary lesson. Add a
scientific environment only when the activity actually needs it.

For Copilot, follow [the account and MCP guide](../../docs/getting-started/copilot.md).
Verify current official eligibility when advising: Education verification and
Copilot activation are separate. Do not promise immediate approval, unlimited use
or API credits. Keep school proofs and account credentials out of the chat and
repository; the student uses the provider's own flow. If unavailable, offer a
working pane demo or a harness they already have rather than assuming payment.

Inspect and merge the matching MCP config without overwriting other servers.
Use the backend-off example unless a live route is already requested. Check tool
discovery and a real `start_lesson_session` / `get_operator_context` call. A config
file or a model saying "connected" is not verification.

Choose one owner for the session: the pane and an independent MCP client have
separate servers. Never mix their IDs or promise automatic synchronization.

## Begin the activity

Read [studium-harness](../studium-harness/SKILL.md) for the ongoing loop and use
[the first-lesson tutorial](../../docs/tutorials/first-lesson.md). Present the
public scene and its materials, then wait for the student's response.

- Do not read answer keys in the raw bundle, provide the answer before the attempt,
  or submit a schema example as if it were the student's work.
- Submit their words/choice with the current typed contract. Confidence is optional
  where the schema permits and always comes from the learner, never the agent.
- Give a scaffolded hint or a question about the method when useful, then wait.
- Explain an adaptation using the actual tool result; do not invent mastery.
- For experiments, elicit a prediction before execution and a personal conclusion
  afterwards. Use the [agentic tutorial](../../docs/tutorials/agentic-experiment.md)
  within the teacher's scope. Missing tools or failed runs remain visible.

## Verify and hand back

Success is a real scene loaded and a learner-authored response producing feedback
or a transition. Automated smoke/stub responses are technical demonstrations,
not evidence of student learning. If blocked, use [troubleshooting](../../docs/troubleshooting.md)
and report the failing step with a small anonymized error, not a claim of success.

Provide the next activity or a short resume note with course/revision, public
context and relevant local files. Do not silently invoke `end_session` merely
because the conversation ends: it requests forgetting. Explain the scope if the
student asks to erase. Harness history and experiment folders have separate
retention; see [privacy](../../docs/privacy-and-limits.md).
