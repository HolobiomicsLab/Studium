English · [Français](index.fr.md)

# Studium documentation

Studium turns a scientific source into an explicit learning path: objectives, prerequisites, activities, the learner's own answers and the adaptation decisions taken on them. A **harness** is the application that hosts an AI assistant and its tools, for example Codex, Claude Code, or VS Code with Copilot. Studium keeps the teaching contract; the harness helps to read, experiment, program and explain.

These pages describe a research prototype, best used first in an accompanied pilot. Use the code and the documentation of the same revision. Unfamiliar terms are defined in the [glossary](concepts/glossary.md).

## Start here

| I want to… | Read | Result |
|---|---|---|
| Try Studium in five minutes | [Quickstart](start/quickstart.md) | A first question in VS Code or in your assistant |
| Install the extension, the MCP server or the Python tools | [Installation](start/installation.md) | Each surface ready and checked |
| Use my usual assistant (Codex, Claude Code, Copilot, OpenCode, Cursor) | [Connect a harness](start/harnesses.md) | The Studium server registered in that client |
| Use the VS Code pane | [VS Code](start/vscode.md) | Lessons, reviews and your data controls in the editor |
| Give my assistant the Studium procedures | [Skills](start/skills.md) | The skills that teach a harness how to run a lesson |
| Fix a problem | [Troubleshooting](start/troubleshooting.md) | The symptom, its cause and the fix |

## Learn on your own

You choose the sources; your assistant builds the lesson; Studium checks it and schedules your reviews.

- [Learn with your assistant](learn/learn-with-your-assistant.md): from "I want to learn X" to a first question, then daily reviews.
- [Review over time](learn/review-over-time.md): the study plan, due reviews and what self-rating does and does not change.
- [Tutorial: learn a topic in a conversation](tutorials/learn-a-topic-in-a-conversation.md).
- [Tutorial: self-study from your references](tutorials/self-study-from-references.md): an open-book lesson from a page, a PDF or a text, and its limits.

## Study in a class

- [Student guide](learn/student-guide.md): play a lesson, answer, ask for a hint, read feedback.
- [Experiment journal](learn/experiment-journal.md): a private record of prediction, observation and conclusion.
- [Learner report](learn/learner-report.md): review a chosen trace before sharing it; your own texts are included only on request.
- [Languages and scientific supports](learn/language-and-supports.md): change the presentation language; equations, diagrams, structures and figures with their provenance.
- [Tutorial: first lesson](tutorials/first-lesson.md).

## Teach

- [Teacher guide](teach/teacher-guide.md): from sources to an approved lesson and a class report.
- [Author a lesson](teach/author-a-lesson.md) and [review and approve](teach/review-and-approve.md): the approval record bound to the exact lesson file.
- [Follow a class](teach/follow-a-class.md): aggregated reports, never below five learners.
- [Learner contributions](teach/learner-contributions.md): lessons written by learners and their teacher-gated publication.
- [Activity templates](teach/activity-templates.md), [literature and evidence](teach/literature-and-evidence.md), [media and visual support](teach/media-and-visual-support.md).
- [Observatory](teach/observatory.md): course review, provenance and MySTRA reports for operators.
- Tutorials: [from literature to a course](tutorials/literature-to-course.md), [an agentic experiment](tutorials/agentic-experiment.md), [from an activity to a report](tutorials/activity-to-report.md), and [use cases](tutorials/use-cases.md) (ASB capsule and metabolomics, analysis diagnosis, robustness, archaeology photography, multilingual support).

## Understand

- [How Studium works](concepts/how-studium-works.md) and [capabilities and maturity](concepts/capabilities.md).
- [Scene types](concepts/scene-types.md), [learner model](concepts/learner-model.md), [learning principles](concepts/learning-principles.md), [modulators](concepts/modulators.md).
- [Honesty and provenance](concepts/honesty-and-provenance.md): who wrote the key, whether a judge assessed, what was measured.
- [Privacy and limits](concepts/privacy-and-limits.md): read before a class pilot.
- [Glossary](concepts/glossary.md).

## Build on Studium

- Reference: [MCP tools](reference/mcp-tools.md), [lesson bundle](reference/lesson-bundle.md), [configuration](reference/configuration.md), [command line](reference/cli.md), [agentic session protocol](reference/agentic-session-protocol.md), [HTTP API](reference/http-api.md).
- Develop: [architecture](develop/architecture.md), [testing](develop/testing.md), [release](develop/release.md), [documentation style](develop/docs-style.md).
- [Contributing](../CONTRIBUTING.md), [security policy](../SECURITY.md), [changelog](../CHANGELOG.md), [agent conventions](../AGENTS.md).
- [Design records](design-records/index.md): specifications, decision records, audits and dated updates, kept in their original language.
- Harness procedure: [`skills/studium-harness/SKILL.md`](../skills/studium-harness/SKILL.md); evaluation harness: [`eval/README.md`](../eval/README.md).

## Skills

Seven skills are discovered by harnesses through `.claude/skills` and `.agents/skills`: `studium-teacher`, `studium-student`, `studium-harness`, `studium-self-learner` (learning without a teacher), `studium-activity-templates`, `studium-visual-support` and `studium-learner-report`. A further skill, `studium-observatory`, lives in [`skills/`](../skills). See [Skills](start/skills.md).

## Limits

The activities described here are not a scientific validation and not evidence of teaching effectiveness. A teacher approves a lesson before students use it.

## Suggest an improvement

Give the code revision, the path you followed, the result you expected and a minimal anonymised example. Do not attach an API key, a student record, or an article whose redistribution is not allowed. Security issues go through the [security policy](../SECURITY.md), not a public issue.
