English · [Français](capabilities.fr.md)

# Capabilities and limits

This page lists what Studium does today, for each kind of user, with the practical limit of each capability. Studium is a research prototype of adaptive teaching: its unit is an explicit path of concepts and tasks, not only a conversation with a model. A capability listed here exists in the code; it is not necessarily available on every surface.

## For learners and self-learners

| Capability | What works | Practical limit |
|---|---|---|
| Learn a topic in a conversation | Your assistant turns sources you chose into a playable lesson with `get_authoring_guide`, `prepare_sources` and `create_lesson`; each graded item cites a verified quote | Agent-drafted, not teacher-validated; up to 20 sources and 200 000 characters; no reproduction scene |
| Adaptive path | Navigation follows prerequisites, measured mastery, hints and remediation | Only as good as the lesson and the judge |
| Study over days | `get_study_plan` says what is due across lessons; `start_review_session` plays it; `rate_recall` records a self-rating | A concept no lesson can replay is listed but never proposed |
| Honest feedback | Graded answers move mastery; without a judge you get the reference and rate your recall | Without a judge, free text is not assessed |
| Metacognition | Declared confidence compared with measured performance | Prototype indicators, not a diagnosis or an institutional grade |
| Experiment journal | Prediction, confidence, observation and conclusion kept through `record_experiment` and `get_experiment_journal` | Private, opt-in, not graded |
| Self-study from references | `experience_packet.py passages`, `prepare`, `check`, `bundle --self-study` | Open book for quizzes and flaw audits; no teacher validation, no release |
| Reproductions | The harness runs a capsule; Studium checks the run against its manifest; VS Code asks before running code | Studium never executes; a run check is not a proof of execution |
| Peer review | Peer rooms (`open_peer_room`, `submit_peer_rating`) aggregate ratings | Rooms live in memory; a target stays hidden below 3 raters |
| Language | `set_session_language` and activity dictionaries | Dictionaries translate the texts provided; older interfaces are not all localised |
| Learner report | `tools/learner_report.py export` builds a local ASTRA/MySTRA copy of actions you chose | A partial trace: proves neither learning, nor the absence of help, nor authorship |

Start with [Learn with your assistant](../learn/learn-with-your-assistant.md), the [student guide](../learn/student-guide.md) and [Review over time](../learn/review-over-time.md).

## For teachers

| Capability | What works | Practical limit |
|---|---|---|
| Literature to course | Passage capture, a canonical plan and exact links to evidence | No automatic scientific approval |
| Review and approve | `review_lesson` shows a draft without its keys; `experience_packet.py approve` writes `approval.json` bound to the exact lesson bytes; dashboard library and review pages | The record documents a review; it is not a signature |
| Follow a class | `class_report`: per scene and per concept accuracy where a key or judge graded, hint reliance, calibration, completion | Consented telemetry only; floor of 5 learners for each figure; covers the whole configured data folder |
| Learner contributions | Proposal, review and release of learner bundles; discovered with `list_community_bundles` | A course must have its bundle at `<BUNDLES_ROOT>/<course>/lesson.json`; release follows the teacher's decision |
| Activity templates | Five portable activities: linked representations, parameter comparison, evidence and claim, analysis diagnosis, conclusion robustness | Local viewers without an embedded agent; they do not advance the session |
| Media and visual support | Mermaid, KaTeX, 2D SMILES, images, audio and video with provenance | Coverage differs by viewer; generation is external and optional |
| Provenance view of a draft | `tools/experience_review.py` renders a checked draft through ASTRA and MySTRA, so a reviewer can tell verified, declared and still-open elements apart | A provenance view, not an approval nor a judgement of scientific validity |
| Exploration record | `tools/experience_exploration.py` captures what a harness explored: sources, versions, named files, checks | Hashes detect later changes; they prove neither the science nor an execution |
| Contextual help | `?` controls explain goals, prediction, confidence, evidence and adaptation, in English and French | They state pedagogical intent, not proven benefits |
| Observatory | Course inspection and review views, including MySTRA | Local service, not an authenticated class portal |

See the [teacher guide](../teach/teacher-guide.md), [Review and approve](../teach/review-and-approve.md) and [Follow a class](../teach/follow-a-class.md).

## For developers and harness builders

| Capability | What works | Practical limit |
|---|---|---|
| MCP server | 34 tools over stdio (25 lesson, 4 study, 3 authoring, 2 teacher), prompts `learn` and `review` | Each client has its own tools, account and session |
| Local HTTP API | The lesson operations, schema discovery, bearer token, protection against duplicate submissions | Loopback only; study, authoring and teacher tools are MCP-only; active sessions end with the process |
| File channel | A task and answer loop in `.studium-session/` for a harness without MCP | Formats and atomic writes must be respected |
| VS Code extension | Lesson pane, chat participant, notebook cell, restore on reload, reviews in the status bar | Its sessions are separate from an assistant's own MCP server |
| ASB capsule | Task card and reproduction protocol | A capsule's tier does not attest a learner's run |

See [Harnesses](../start/harnesses.md), the [MCP tools reference](../reference/mcp-tools.md) and [Architecture](../develop/architecture.md).

## Who holds the key

| Class | Scene types | In a self-study lesson |
|---|---|---|
| `ungraded` | `intro`, `concept`, `meta_checkpoint` | Nothing is graded |
| `author_keyed` | `quiz`, `spot_the_flaw` | The key was written by the person who answers (open book), or by the agent that drafted the lesson |
| `production` | `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim`, `discussion`, `ai_critique` | Without a judge model, the reference is shown and nothing is assessed; a judge (`LITELLM_BASE_URL`) makes the assessment external |
| `externally_grounded` | `reproduction` | Checked against an executed run |

## The notices

A self-study lesson shows a notice on its first screen. It depends on who drafted it and on whether a judge is configured.

| Drafted by, judge | Notice (English lessons) |
|---|---|
| learner, none | Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). Without a judge model, production scenes are not assessed: compare your answer with the provided reference and rate your recall; that rating schedules your reviews and never changes your mastery. |
| learner, configured | Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). Production scenes are assessed by the model. |
| agent, none | AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; challenge any key you think is wrong. Without a judge model, production scenes are not assessed: compare your answer with the provided reference and rate your recall; that rating schedules your reviews and never changes your mastery. |
| agent, configured | AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; challenge any key you think is wrong. Production scenes are assessed by the model. |

A lesson that holds a reproduction adds: "Executed reproductions carry an external assessment."

More in [Honesty and provenance](honesty-and-provenance.md).

## Assets and display

The surfaces render images, SVG, LaTeX equations, code, CSV, protocols, chart specifications and executed results; scientific assets include orbitals, 3D molecules and spectra. Rendering libraries are vendored for local use (`studium.assets` = `vendor`, the default); a `cdn` option exists. When a renderer is missing, a fallback keeps the content readable without promising the same interaction. Modality preferences can reorder and emphasise assets without hiding content; they answer a stated need and do not diagnose a cognitive profile. See [Language and supports](../learn/language-and-supports.md) and [Media and visual support](../teach/media-and-visual-support.md).

## Auditability

Adaptive decisions carry their rule and modulator, and the graph and decisions can be exported as indicium claims and ASTRA records. This makes an inference inspectable; it does not make it correct.

## Who does what

- **Studium** keeps the concepts, scenes, expected answers, progression and run protocol.
- **The harness** owns its tools and model, reads the skills, searches and runs in its own environment.
- **The learner** predicts, chooses a variation, interprets and answers.
- **The teacher** sets the scope, reviews and decides what is released.

Web search, Perspicacité, libraries and skills are not available because a lesson mentions them: the harness has to check its real connections. The [agentic experiment tutorial](../tutorials/agentic-experiment.md) shows how to use them within the lesson contract.

## Open boundaries

- Deferred, by decision: item variants and misconceptions, MCP Apps (interactive UI in the chat), HTTP delivery of class telemetry, concept identity by namespace, npm and Marketplace publication.
- No authenticated multi-user teacher portal; the dashboard and the Observatory are local.
- The VS Code pane and an independent MCP server do not share a session.
- Passing software tests does not establish institutional compliance, multi-user deployment or teaching effectiveness. Start with an accompanied pilot and the rules in [Privacy and limits](privacy-and-limits.md).
