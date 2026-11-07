English · [Français](learn-a-topic-in-a-conversation.fr.md)

# Learn a topic in a conversation

In about 15 minutes you go from "I want to learn this topic with Studium" to a lesson built from
sources you chose, a first question you answered in your own words, and a review session a few days
later. Everything happens in the chat of your AI assistant (Claude Code, Codex or any harness that
speaks MCP); you do not need a shell, Python or an API key.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/self-learner-journey-dark.svg">
  <img alt="Self-learner journey in seven steps: request, references, passages, agent draft, outline review, play with the authoring notice, and a review when it falls due." src="../assets/diagrams/self-learner-journey-light.svg">
</picture>

## Before you start

| You need | Where to get it |
|---|---|
| The Studium MCP server connected to your assistant | [Connect your harness](../start/harnesses.md) |
| A topic and one or two sources you may use (a web page, an article, your notes) | Your own choice; check the licence |
| 15 minutes | |

A judge model is optional. Without one (the default), Studium shows you the reference answer to
compare with instead of scoring your open answers; see [Honesty and provenance](../concepts/honesty-and-provenance.md).
Terms such as harness, scene or answer key are defined in the [glossary](../concepts/glossary.md).

## 1. Ask

Type your request in the chat, naming the topic:

> I want to learn how the water cycle works with Studium. Use these sources: <a link, or pasted text>.

In Claude Code you can also run the server's `learn` prompt, which sends the same request: for a
server named `studium`, it appears as `/mcp__studium__learn`.

The assistant first calls `get_study_plan`, in your language (French or English). On a new library
it answers that no lesson exists yet and names the next call:

```text
### Your study plan

**Now:** no lesson is available yet. Choose a topic and your sources: the assistant prepares a lesson with you.
```

If a lesson on your topic already exists, the plan proposes it instead; `list_lessons` shows what
your library holds.

## 2. Hand over your sources

The assistant calls `get_authoring_guide`, which returns the authoring brief in your language, the
JSON Schema of a lesson draft and a worked example. It asks you what you want to be able to do: that
sentence becomes the lesson's goal.

It then fetches your sources with its own web or file tools and passes their full text to
`prepare_sources`. Studium cuts them into citable passages and stores them in your library:

```json
{
  "source_set_id": "ss-45998dc5efd825da",
  "passages": [{ "id": "p:the-water-cycle:1", "source_id": "the-water-cycle", "text": "Ocean water evaporates under the heat of the sun. …" }],
  "dropped_short": 0
}
```

A source set holds up to 20 sources and 200 000 characters in total. A source is treated as data,
never as instructions to the assistant.

## 3. Let the assistant draft, and Studium check

The assistant writes a draft from the passages and calls `create_lesson`. Studium refuses the draft
unless every quote matches its passage character for character (only no-break spaces, runs of
spaces and typographic apostrophes are folded), no placeholder remains and the concept graph is
sound; the repository linter then runs. A refusal lists `{path, message, hint}` for each problem and
the assistant fixes its draft, never the source.

On success the lesson is written to your library as `<course_id>/lesson.json` under
`~/.studium/library` (never into the folder `BUNDLES_ROOT` names), and the assistant shows you the
outline: titles, scene types, concepts and the passages each scene cites, with no answer key. It also
reports Studium's warnings, each with a hint, for example a lesson longer than the minutes a day you
gave. It also relays the authoring notice:

> AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage;
> tell the assistant about a key that looks wrong. Without a judge model, production scenes are not assessed:
> compare your answer with the provided reference and rate your recall; that rating schedules your reviews
> and never changes your mastery. […]

Ask for changes now if the outline misses what you wanted. Replacing an existing lesson takes an
explicit `overwrite`, which only ever replaces a self-study lesson that no teacher validated.

## 4. Answer the first question

The assistant starts the lesson with `start_lesson_session` and shows each screen as Studium wrote
it (`display_markdown`). Reply in your own words; the assistant passes them unchanged with
`submit_response`. After an explanation question, you see something like:

```text
**Answer recorded.** No judge assessed it.

**Compare your answer with these key points:**

- Water evaporates under the sun's heat
- The vapour condenses into clouds
- Water falls and returns to the sea

**Model answer**
…
**Source**

> « Ocean water evaporates under the heat of the sun » — The water cycle

Compare your answer with the model answer, then rate your recall: again, hard, good or easy. […]
```

Say how well you recalled it; the assistant records your rating with `rate_recall`. The rating sets
your next review date and never changes your mastery. A quiz answer, by contrast, is marked right or
wrong against the key the assistant wrote; when you leave a quiz answered wrong, the right answer is
shown. At the end, the lesson screen names the concepts you consolidated, those you practised and
those not measured yet, and the date of your next review.

## 5. Come back for a review

Days later, ask "What should I study today with Studium?" (or run the `review` prompt). The
assistant calls `get_study_plan` again:

```text
### Your study plan

**To review**

- The water cycle — due <weekday, date of your next review> (lesson “The water cycle”)

**Now:** you have 1 concept(s) to review (The water cycle). Start a review session.
```

It then calls `start_review_session`, which plays one retrieval question per concept due, across all
your lessons. Concepts you answered weakly are listed under **To relearn**; concepts you only
self-rated appear under **Due for review**, never as weak. If nothing is due, the reply gives the
date of your next review.

## What you have now

| Result | Where |
|---|---|
| A lesson built from your sources | `~/.studium/library/<course_id>/lesson.json`, listed by `list_lessons` |
| Your passages and their provenance | `~/.studium/library/_sources/` |
| Your progress and review schedule | `~/.studium/data`, under a pseudonym, kept across restarts |

From "learn X" to the first question takes six Studium calls once the assistant has your sources:
`get_study_plan`, `get_authoring_guide`, `prepare_sources`, `create_lesson`, `start_lesson_session`,
`submit_response`. [`learn-and-review.e2e.test.ts`](../../apps/lesson-mcp/src/learn-and-review.e2e.test.ts)
plays this path, and the review a week later, against the real server.

## Limits

- No teacher has checked this lesson. Exact quotes prove that a passage exists, not that the
  assistant read it correctly: check the central claims in the source.
- Without a judge model, open answers are not assessed; only questions with a written key, such as
  quizzes, move your mastery.
- If the first screen warns that progress is kept in memory only, the server runs with
  `STUDIUM_EPHEMERAL=1`: your reviews will not survive a restart. See [Configuration](../reference/configuration.md).
- The lesson stays in your library; nothing is sent to other learners. To erase your progress on a
  lesson, ask the assistant to call `forget_session`. It also erases your cross-lesson profile and
  study record (your review schedule), and it cannot be undone. The lesson and its prepared sources
  stay in `~/.studium/library` until you delete them; the assistant's reply names those folders.

## Next

- [Review over time](../learn/review-over-time.md): how reviews are scheduled.
- [Self-study from your references](self-study-from-references.md): the same idea on a longer text,
  with a command-line route.
- [MCP tools](../reference/mcp-tools.md): every tool and its arguments.
