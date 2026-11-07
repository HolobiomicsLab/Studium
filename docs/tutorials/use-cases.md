English · [Français](use-cases.fr.md)

# Choose a Studium use case

Start from a question you want to understand, then choose the smallest activity that lets you
examine it. The recipes below run on the current version, with synthetic examples where stated; they
are not validated courses for a given discipline or audience.

Before you start, [install Studium](../start/installation.md) and choose
[your harness or the VS Code pane](../start/harnesses.md). The [skills](../start/skills.md) guide an
assistant through these same procedures.

| Situation | Starting material | What you examine |
|---|---|---|
| Learn a topic from your own sources | A goal and one or two sources | A lesson built from exact quotes, your answers, reviews over days |
| Study a concept with an agent | A reviewed lesson and a session goal | Your answer, a hint if needed, the adaptation explained |
| Build a course from an article | Exact passages, references, audience and objectives | A checked draft, a reviewed plan, MySTRA provenance |
| Experiment from an ASB capsule | A capsule, data, command and authorised scope | A reference run, a variant, a conclusion bounded by evidence |
| Understand a result with a viewer | Public results, units, reference and variants | An interactive activity and technical checks |
| Observe a photograph in archaeology | An institutional photo, its record and reuse status | The line between observation, attribution and hypothesis |
| Get help in another language or modality | The public scene and the stated need | Text, diagram, figure or media, with an accessible equivalent |
| Prepare a write-up | The actions or journal the student chooses to export | A local ASTRA/ARA/MySTRA report before sharing |
| Understand a conversation with an assistant | The conversation in progress or a past session | A short lesson quoting the exchange, a concept map, what is acquired and what is not |

## 1. Learn a topic in a conversation

**For a self-learner.** Ask your assistant "I want to learn <topic> with Studium" and give it your
sources. It builds a lesson with the authoring tools, you answer in your own words, and
`get_study_plan` tells you what to review on the following days. Follow
[Learn a topic in a conversation](learn-a-topic-in-a-conversation.md); for a longer text or more
control, [Self-study from your references](self-study-from-references.md). The lesson is drafted by
the agent and not checked by a teacher; each item cites its passage.

## 2. A guided self-study session

**For a student.** Start with a reviewed lesson, for example the `atomistique-l1` fixture. Choose the
VS Code pane for the visual loop, or your harness's chat to ask for explanations and extra tools.

> Read the `studium-student` skill, then `studium-harness`. Check the connection, start the
> provided course and present one activity at a time. Wait for my answers. If I ask for a hint,
> help me reason, then explain the adaptation Studium actually reported.

[Your first lesson](first-lesson.md) gives the calls. Success means a public scene actually read and
an answer of your own accepted. To switch between Claude Code and Codex during a session, keep the
same server process and use the local [HTTP API](../reference/http-api.md), which serves the lesson
operations.

## 3. An article becomes a course to review

**For a teacher.** Select passages and figures you may use for the intended purpose. Define audience,
prerequisites, duration and judgment question. Perspicacité can help find evidence when it is
actually connected to the harness.

> Use `studium-teacher`. Prepare a draft from these passages for [audience] around [question]. Link
> each claim to its source. Separate published results, hypotheses and synthetic examples. Prepare a
> prediction, a comparison and a transfer case, then show what needs review.

Follow [From the literature to a reviewable draft](literature-to-course.md), then
[Review and approve](../teach/review-and-approve.md). Schema validation does not approve content.
Importing an article does not extract its figures automatically; prepare the chosen assets with their
sources and rights.

## 4. Molecular networks and spectral annotation

**For a supervised group.** Question: "Is a high MS/MS similarity enough to identify a structure?"
Start from a capsule the teacher provides or from the repository's synthetic examples, saying which.

1. The student predicts the effect of a threshold or a tolerance.
2. The harness reads the protocol, versions and available domain skill, then runs the reference in
   the authorised environment.
3. The student chooses a variation; the viewer keeps the reference visible and links network,
   spectra and candidates when those data exist.
4. The student distinguishes similarity, candidate and identification, and says which further
   evidence would be needed.

> Use the domain skill actually installed and the official documentation of the chosen library.
> Check units and the computation on an edge case. Prepare linked representations, keep the
> reference visible and record sources, command, versions and outputs. Do not invent missing data.

[A scientific experiment with your agent](agentic-experiment.md) provides a runnable demo and the
`get_run_manifest` → run → `submit_run_result` protocol. The `linked-representations` template
([activity templates](../teach/activity-templates.md)) uses synthetic data. A GNPS, matchms or EMBL
resource provided by the teacher is course material; it is not automatically a Studium lesson or an
attested capsule.

## 5. Diagnose an analysis or test a conclusion

**Any discipline.** From given steps and results, use `diagnose-analysis` to compare possible repairs
and `conclusion-robustness` to weigh alternative hypotheses against an explicit criterion: the
denominator of an ecological indicator, a blank correction in chemistry, a calibration assumption, a
survey aggregation.

> Use `studium-activity-templates`. From these results, prepare `conclusion-robustness` with units,
> a reference hypothesis and justified variants. Ask for my prediction before showing results.
> Explain what the scenarios do not allow us to conclude.

Follow [From an interactive activity to a report](activity-to-report.md) and its `--config` contract.
These viewers compare captured values; they do not compute a new scientific analysis. The harness
runs and checks new computations before adding them. A share of favourable scenarios is not a
probability that the conclusion is true.

## 6. A photograph as an object of observation

**Archaeology example.** The repository offers a museum photograph of *Hippopotamus (William)*:
[preparation and sources](../../examples/archaeology/README.md). The image is shown before the
prediction because it is the material to observe; explanations come after.

> Use `studium-visual-support` and `evidence-claim`. Keep the original photograph, its attribution
> and an alternative description. Ask what I observe, then separate what the photograph shows from
> what the museum record establishes. Present any generated reconstruction as an interpretation.

[Media and visual support](../teach/media-and-visual-support.md) covers metadata, preparation and
local attachment. The reuse status must stay visible, even for private use; the viewer does not
certify rights.

## 7. Adapt help without requiring a multimodal model

**At the student's request.** Start with text, KaTeX, Mermaid or a computed chart. Choose help from
the stated difficulty, the language and the authorised context, never by inferring a disability or a
stable profile from an error.

> Continue in English with the original scientific terms in brackets. Prepare a Mermaid map of the
> relation I struggle with, without revealing the answer. If an image or a short audio would add
> more, first prepare its prompt and a text equivalent; use my tool only if I ask.

[Language and supports](../learn/language-and-supports.md) covers language, dictionaries, equations
and structures. A teacher can produce a medium once for reuse; a student request can produce a new
enriched copy that keeps prompt, provenance, transcript and subtitles. Generation, delay and cost
depend on the harness; activities stay usable without this option.

## 8. Report on an experiment without sharing everything

**For the student, then the reviewer.** Choose a local trace or a journal, produce a report and
examine it before any sharing. Texts are excluded by default; including them is a separate choice
from storing the journal.

> Use `studium-learner-report` with the files I select. Verify the report, open the viewer and show
> what it contains. Exclude my personal texts for this first copy. Send it to no one.

[From an interactive activity to a report](activity-to-report.md) holds the `export` and `verify`
commands. MySTRA shows the recorded elements and their limits. The trace does not cover the whole
conversation, the help consulted or work outside the tool, and it proves neither identity, nor
autonomy, nor learning.

## 9. Understand a conversation you had with an assistant

**For anyone who worked with an assistant** on an analysis, a debugging session or a design
question, and wants to understand it rather than only keep its result. No teacher reads the lesson
first: it is generated to learn from, and it says so.

> Use `studium-from-conversation`. Make a short lesson from this conversation so I can check that I
> understood why [the point]. Ask me one question at most before you start.

The assistant extracts the turns that matter from the session transcript, with
`tools/conversation_sources.py`; the excerpts stay on your machine, tool results are left out unless
you ask for them, and strings that look like credentials are replaced. `prepare_sources` records the
source as a conversation, `create_lesson` checks every quote against it, and the first screen tells
you what the lesson rests on: what the assistant asserted there was not checked, what comes from a
quoted file or tool result is an observation. Each scene shows the passage it quotes.

A concept map opens the lesson and returns at a detour through a prerequisite, at a synthesis scene
and at the end, with the questions you answered and their result. Success means you can say, for
each concept, whether you got it right, need to review it, or only read it. The lesson checks your
understanding of what was said, not whether the conversation was right.
