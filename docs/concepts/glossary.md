English · [Français](glossary.fr.md)

# Glossary

The terms you will meet in Studium's documentation, interfaces and tool results, in alphabetical order. Each entry links to the page that explains it.

| Term | Meaning | More |
|---|---|---|
| Agent-drafted lesson | A lesson an AI assistant drafted from sources the learner chose, with `create_lesson`. Not checked by a teacher; its notice says so. | [Honesty and provenance](honesty-and-provenance.md) |
| Approval record | `approval.json`, written next to a lesson by `experience_packet.py approve`, bound to the SHA-256 of the exact `lesson.json`. Documents a teacher's review; not a signature. | [Honesty and provenance](honesty-and-provenance.md#the-approval-record) |
| ASB capsule | A packaged, reproducible analysis (from the Agentic Science Builder project) that a `reproduction` scene asks the harness to run. | [Scene types](scene-types.md#reproduction) |
| ASTRA, MySTRA | A format that records adaptive decisions and analyses so they can be replayed, and its local reader. Used by learner reports and the Observatory. | [Learner report](../learn/learner-report.md) |
| Beta mastery | The estimate of how well a concept was shown, α / (α + β), fed only by graded answers. | [Learner model](learner-model.md#mastery-a-beta-estimate) |
| Bloom level | The cognitive level of a concept (remember to create). It sets the difficulty weight of its answers. | [Scene types](scene-types.md#difficulty) |
| Calibration | The gap between the confidence a learner declares and the mastery they have shown. | [Learner model](learner-model.md#calibration) |
| Certified mastery | A concept at mastery 0.8 or more after at least three graded attempts, with no measured overconfidence or over-trust. A mastery claim is then written. | [Learner model](learner-model.md#when-a-concept-counts-as-mastered) |
| Class report | `class_report`: aggregate figures for a course over consented telemetry, each computed over at least five learners. | [Follow a class](../teach/follow-a-class.md) |
| Community bundle | A lesson written by a learner and released by a teacher for others. | [Learner contributions](../teach/learner-contributions.md) |
| Diagnostic scene | An opening scene marked `diagnostic: true` that asks what the learner already knows. It is played once and never comes back as a review. | [Review over time](../learn/review-over-time.md#play-a-review-session) |
| Effective mastery | Mastery discounted by recall now: posterior × retrievability, or the posterior alone when never reviewed. | [Learner model](learner-model.md#effective-mastery) |
| File channel | A task-and-answer loop through files in `.studium-session/`, for a harness without MCP. | [Harnesses](../start/harnesses.md) |
| FSRS | Free Spaced Repetition Scheduler: the model Studium uses to decide when a concept is due for review. | [Learner model](learner-model.md#retention-fsrs) |
| Guess correction | On a choice item, a wrong answer also withdraws the credit a lucky guess would have earned, so random answers do not read as partial mastery. | [Learner model](learner-model.md#correction-for-guessing) |
| Harness | The AI assistant or client that drives a Studium lesson: Codex, Claude Code, Copilot, OpenCode, Cursor or the VS Code extension. | [Harnesses](../start/harnesses.md) |
| Hint discount | Each hint shrinks the credit of a correct answer and weakens its review grade. | [Learner model](learner-model.md#hints-discount-the-credit) |
| Judge | A model configured on the server (`LITELLM_BASE_URL`) that assesses free-text answers. Without one, free text is not assessed. | [Honesty and provenance](honesty-and-provenance.md#the-judge) |
| Key class | Who holds the key that grades a scene type: `ungraded`, `author_keyed`, `production` or `externally_grounded`. | [Scene types](scene-types.md) |
| Landmark | A line a reproduction's run must return (by default the last non-empty line of its output), checked for presence, never for its value. | [Scene types](scene-types.md#reproduction) |
| Learning Workflow Graph (LWG) | The graph of concepts and tasks in a lesson, with typed edges such as `prerequisite_for`. | [How Studium works](how-studium-works.md#the-graph) |
| Lesson bundle | `lesson.json`: one lesson's metadata, concepts, graph, scenes and rules. | [Lesson bundle reference](../reference/lesson-bundle.md) |
| MCP | Model Context Protocol: the standard through which assistants call Studium's tools. | [MCP tools](../reference/mcp-tools.md) |
| Modulator | A label (M1, M3, M6) naming the pedagogical intent of an adaptation rule. | [Modulators](modulators.md) |
| Notice | The text a self-study lesson shows first, saying who wrote the keys and what is assessed. | [Honesty and provenance](honesty-and-provenance.md#notices) |
| Open book | A self-study quiz whose key the learner wrote: answering it shows recall of one's own key, not external assessment. | [Honesty and provenance](honesty-and-provenance.md#key-classes) |
| Pseudonym | The HMAC of a learner id that names their data folder. | [Privacy and limits](privacy-and-limits.md#pseudonyms) |
| Reference | What an answer is compared with after the answer: key points, planted flaws or flawed claims, and a model answer; for a quiz answered wrong, the right choice. | [Scene types](scene-types.md#free-text-answers) |
| Retrievability | The probability, from FSRS, that the learner still recalls a concept now. | [Learner model](learner-model.md#retention-fsrs) |
| Rule 003 | The project rule that no content is released to students without a teacher's validation. | [Honesty and provenance](honesty-and-provenance.md#rule-003-a-teacher-before-any-release) |
| Run manifest | What a reproduction must produce and check, without the expected values. | [Scene types](scene-types.md#reproduction) |
| Scene | One step of a lesson; there are 13 types. | [Scene types](scene-types.md) |
| Self-rating | The learner's own rating of recall (again, hard, good, easy). Schedules reviews; never moves mastery. | [Learner model](learner-model.md#self-rating) |
| Self-study lesson | A lesson written for oneself, by the learner or an agent (`mode: self_study`). Cannot receive teacher approval. | [Self-study from references](../tutorials/self-study-from-references.md) |
| Stability | In FSRS, the number of days after which recall falls to the target of 0.9. | [Learner model](learner-model.md#retention-fsrs) |
| Study plan | `get_study_plan`: reviews due, concepts to relearn, lessons in progress and the next lesson, across all lessons. | [Review over time](../learn/review-over-time.md) |
| Trust calibration | How far a learner over-trusts or over-distrusts a flawed AI reading of a real executed result. | [Learner model](learner-model.md#trust-in-ai-output) |
| Universe | A variant of a lesson's path: a baseline and a more scaffolded remedial one. | [How Studium works](how-studium-works.md#the-lesson-bundle) |
| Unmeasured | No evidence was collected. Studium never reads it as zero, wrong or forgotten. | [Learner model](learner-model.md#unmeasured-is-not-zero) |
| Verdict deck | A `spot_the_flaw` form where the learner marks each claim flawed or sound, scored against the key. | [Scene types](scene-types.md#audits-with-a-verdict-deck) |
| Withheld | A class-report figure some learners contributed to, but fewer than the floor of five: hidden, which is neither zero nor unmeasured. | [Follow a class](../teach/follow-a-class.md#how-to-read-the-numbers) |
