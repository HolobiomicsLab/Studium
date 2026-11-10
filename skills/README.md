English · [Français](README.fr.md)

# Skills

Skills are short instruction files that teach an AI assistant (Claude Code, Codex, Copilot, Cursor,
OpenCode) how to use Studium for one job: onboard a student, prepare a course, run a lesson, build a
self-study lesson from your own sources. Each skill is a folder with a `SKILL.md`; its front matter
(`name`, `description`) tells the assistant when to load it.

| | |
|---|---|
| Status | **supported** (part of the harness surface, decision D6) |
| Run | nothing to run: the assistant loads a skill when your request matches its description |
| Calls | the Studium MCP server ([`apps/lesson-mcp`](../apps/lesson-mcp/README.md)) and the repository's tools |
| Tests | none of their own; the flows they describe are covered by the server and tool tests |

## The skills

| Skill | For whom | Use it to |
|---|---|---|
| [`studium-student`](studium-student/SKILL.md) | students | install or connect Studium, set up an eligible Copilot Student plan or another assistant, and start a first lesson with your own answers |
| [`studium-self-learner`](studium-self-learner/SKILL.md) | learners without a teacher | turn a web page, PDF or text you chose into a playable self-study lesson, then play it |
| [`studium-from-conversation`](studium-from-conversation/SKILL.md) | anyone working with an assistant | turn the conversation in progress, or a past session, into a short lesson to check and deepen your understanding of it |
| [`studium-concept-map`](studium-concept-map/SKILL.md) | learners and teachers | show where a learner stands on each concept, export the map as a page that says what each concept rests on, and lay class figures over it |
| [`studium-suggest`](studium-suggest/SKILL.md) | any assistant | notice when a Studium feature would serve the person and offer it once, at the right moment |
| [`studium-teacher`](studium-teacher/SKILL.md) | teachers | install Studium, connect an assistant, prepare a literature- or capsule-grounded lesson draft and review it in MySTRA before a pilot |
| [`studium-harness`](studium-harness/SKILL.md) | any assistant running a lesson | present public scenes, collect the learner's own answers, run capsules honestly, over MCP, HTTP or the file channel |
| [`studium-activity-templates`](studium-activity-templates/SKILL.md) | teachers and learners | choose and adapt an interactive activity (linked representations, parameter comparison, analysis diagnosis, robustness, evidence and claim) |
| [`studium-visual-support`](studium-visual-support/SKILL.md) | learners | inspect source photographs or request an adapted image, Mermaid map, audio explanation or short video |
| [`studium-learner-report`](studium-learner-report/SKILL.md) | learners and teachers | export or inspect a learner-selected activity trace or experiment journal as an ASTRA/MySTRA report |
| [`studium-observatory`](studium-observatory/SKILL.md) | operators and reviewers | run and read the [Observatory](../services/observatory/README.md) |

Role skills (`studium-student`, `studium-teacher`, `studium-self-learner`, `studium-from-conversation`) point to `studium-harness` for
the ongoing lesson loop. `studium-suggest` decides what to offer and when, then hands off to the
skill that knows how.

## How assistants find them

This folder is the single source. Assistants discover the skills through symbolic links in two
conventional folders at the repository root:

| Folder | Read by |
|---|---|
| `.claude/skills/<name>` | Claude Code |
| `.agents/skills/<name>` | Codex and other assistants that follow the `.agents/skills` convention |

Each link points back here (`../../skills/<name>`), so an edit to `skills/<name>/SKILL.md` reaches every
assistant. The optional `agents/openai.yaml` in a skill folder gives Codex a display name, a short
description and a default prompt.

To add a skill, create `skills/<name>/SKILL.md` with `name` and `description` front matter, then link it
from both folders:

```bash
ln -s ../../skills/<name> .claude/skills/<name>
ln -s ../../skills/<name> .agents/skills/<name>
```

A skill without these links is not discovered. Check which skills are linked with
`ls -l .claude/skills .agents/skills`.

Beside the skills, `.claude/agents/` holds two Claude Code agents: `studium-lesson`, which plays a lesson as
a strict relay on the fast model, and `studium-explainer`, a stronger model it calls for a question that
needs a real explanation. See [Keep answers fast](../docs/start/fast-answers.md).

## See also

- [Skills for your assistant](../docs/start/skills.md)
- [Connect an assistant](../docs/start/harnesses.md)
