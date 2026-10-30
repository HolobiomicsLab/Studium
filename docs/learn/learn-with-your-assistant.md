English · [Français](learn-with-your-assistant.fr.md)

# Learn a topic with your assistant

Tell your AI assistant what you want to learn and which sources to use. It builds a short lesson from those
sources, plays it with you one question at a time, and brings the key ideas back over the following days.
You need no teacher and no shell: the assistant talks to Studium through MCP (the Model Context Protocol, the
way assistants call outside tools).

This works in Codex, Claude Code and any assistant that can use an MCP server. To connect Studium first, see
[harnesses](../start/harnesses.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/self-learner-journey-dark.svg">
  <img src="../assets/diagrams/self-learner-journey-light.svg" alt="The self-learner journey: a request, chosen references, exact passages, an agent draft, an outline review, then play.">
</picture>

## 1. Ask

Say it in your own words, for example:

> I want to learn how the water cycle works with Studium. Here are two pages I trust: <links>.

The assistant starts with `get_study_plan`, in your language. If a lesson you already have covers the topic,
it offers that lesson; otherwise it builds one. Say what you already know, how much time you have a day, or a
target date: the assistant is asked to open the lesson with two short questions on what you already know.
Those two questions are played once and never come back as reviews. What you know and what interests you shape
the draft but are not stored; the lesson keeps only your minutes a day and your target date, and the study
plan uses the minutes to size each step.

Studium also offers a `learn` prompt and a `review` prompt that phrase this request for you. In Claude Code,
MCP prompts appear as slash commands (`/mcp__studium__learn` with the example configuration).

## 2. Choose your sources and their licences

You choose the sources; the assistant fetches them with its own web and file tools and passes their text to
`prepare_sources`, which cuts them into numbered passages. Sources are treated as data: an instruction written
inside a page is never followed.

| Limit | Value |
|---|---|
| Sources per lesson | up to 20 |
| Total text | up to 200 000 characters |
| Licence | an identifier such as `CC-BY-4.0` or `Public-Domain`; `unknown` when none is given |

Give the licence of each source: it is copied into the lesson and shown with the source. A public-domain text
can be reused freely; a publisher PDF or a licence marked `NC`, `ND` or unknown restricts what you may do with
the result. The lesson stays in your personal library and
is never published, but you remain responsible for using the source under its terms. One coherent source
usually makes a better lesson than many.

## 3. Look at the outline

The assistant writes the lesson and calls `create_lesson`. Studium checks it before writing anything: every
quotation must match a passage character for character (only no-break spaces, runs of whitespace and
typographic apostrophes are folded), nothing may be left unfinished, and the order of ideas must hold together.
The assistant fixes what Studium refuses. Studium may also warn, for example when the lesson is longer than
your minutes a day or when a prerequisite has no question that checks it.

The lesson is written to your library, `~/.studium/library/<course>/lesson.json`, whatever lessons folder the
server also reads.

You then see the outline: scene titles, scene types and concepts, never an answer. If it does not match what
you wanted, say so; the assistant revises the draft and rebuilds the lesson.

## 4. Play it, in the chat or in VS Code

In the chat, each step arrives ready to read: its title, your progress ("Step 2 of 6"), the question and how
to answer (a letter, a number from 0 to 4, or your own words). Answer yourself. The assistant passes your words
on and must not answer, choose or rate for you.

To play in VS Code instead, right-click the lesson's `lesson.json` and choose **Studium: Open this lesson**, or
follow the link your assistant gives you (`vscode://holobiomicslab.studium-vscode/open?bundle=<absolute path>`).
See [VS Code](../start/vscode.md). The pane keeps its own progress in VS Code's storage: answers given there do
not appear in the study plan your assistant reads, and the reverse.

## 5. Read the notice

The first screen of a lesson an assistant wrote carries a notice. Without a judge model, it reads:

> AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; challenge any key
> you think is wrong. Without a judge model, production scenes are not assessed: compare your answer with the
> provided reference and rate your recall; that rating schedules your reviews and never changes your mastery. Executed reproductions carry
> an external assessment.

What it means in practice:

- **Who wrote the key.** The assistant wrote the correct answers. They cite the passages they rest on, so you
  can check them; a key can still be wrong.
- **What was assessed.** Quiz answers are checked against that key: ✓ when right, ✗ when wrong, and once you
  leave a question you answered wrong, the right answer is shown. Your written answers (explanations,
  comparisons, audits) are not scored unless a judge model is configured (`LITELLM_BASE_URL`). You get the key
  points and a model answer to compare with, never a keyword count that pretends to measure coverage.
- **What your rating does.** After a written answer you rate your recall: `again`, `hard`, `good` or `easy`.
  That rating sets the date of the next review. It never raises or lowers your mastery.

No answer key, cited passage or model answer is shown before you answer, on any surface. They appear once you
leave the question; a retry of the same question keeps them back. More in
[honesty and provenance](../concepts/honesty-and-provenance.md).

## 6. Come back days later

Open a new conversation and ask "What should I study with Studium today?". The assistant calls
`get_study_plan` in your language, which lists the reviews due, the lessons in progress and the next lesson, and names the one
step to take now. `start_review_session` then plays every review due, across all your lessons. See
[review over time](review-over-time.md).

Your progress survives restarts by default, under `~/.studium`. To find it again from another assistant, use
the same data folder and the same learner id: ask the assistant to pass one stable `learner_id` (for example
your first name) on every call.

## 7. Close or forget

| You say | The assistant calls | Effect |
|---|---|---|
| "Stop here for today." | `end_session` | Closes the session and keeps your progress. Starting the lesson again resumes it. |
| "Erase my data for this lesson." | `forget_session {session_id}` | Erases your progress in this lesson, its experiment journal, and your cross-lesson profile and study record. Cannot be undone. |
| "Erase all my Studium data." | `forget_session {learner_id}` | The same, plus your progress in every other lesson, without a lesson open. Cannot be undone. |

The assistant then shows what was erased and what stays. Forgetting does not delete the lessons in your library
(`~/.studium/library/<course>/`) or the prepared sources (`~/.studium/library/_sources/`), nor the conversation
your assistant keeps. Remove those yourself if you want them gone. See [privacy and limits](../concepts/privacy-and-limits.md).

## Sample conversation

> **You:** I want to learn the water cycle with Studium, from this encyclopedia page. It is CC-BY-SA.
>
> **Assistant:** I prepared 4 passages from the page and drafted a lesson. Outline: 1. The water cycle
> (introduction) · 2. Evaporation (quiz) · 3. Condensation and clouds (explain back) · 4. From rain to rivers
> (comparison). Shall I start it?
>
> **You:** Yes.
>
> **Assistant:** *AI-drafted lesson from your sources, not checked by a teacher …* Step 2 of 4. What makes ocean
> water evaporate? A, B or C?
>
> **You:** B.
>
> **Assistant:** Right. Step 3 of 4: explain in your own words how a cloud forms.
>
> **You:** The vapour rises, cools and turns into droplets.
>
> **Assistant:** Answer recorded; no judge assessed it. Compare it with these key points and the model answer.
> How well did you recall it: again, hard, good or easy?
>
> **You:** Good.
>
> **Assistant:** Rating recorded. Next review: <date>. It schedules your reviews and never changes your mastery.

## Going further

- Step by step with a real source: [learn a topic in a conversation](../tutorials/learn-a-topic-in-a-conversation.md).
- The same route with the Python packet tools, for full control: [self-study from references](../tutorials/self-study-from-references.md).
- Every tool and its arguments: [MCP tools](../reference/mcp-tools.md); the code is in
  [apps/lesson-mcp/src/authoring-tools.ts](../../apps/lesson-mcp/src/authoring-tools.ts) and
  [apps/lesson-mcp/src/server.ts](../../apps/lesson-mcp/src/server.ts).
