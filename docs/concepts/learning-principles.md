English · [Français](learning-principles.fr.md)

# Learning principles

Studium is built on a few principles of how people learn and how assessment should behave. For each one, this page says what Studium actually does in the code, then compares it briefly with other ways to study with software. The page states design intent; it does not claim that Studium has been shown to improve learning.

## 1. Retrieval practice: answer before you see

Recalling an answer is itself a learning event, so Studium asks before it shows.

- No key reaches the learner before an answer, on any surface (MCP, file channel, HTTP, VS Code).
- The reference answer and the cited source passages are released only after the answer, once the learner leaves the scene.
- Reviews ask again rather than show again: `start_review_session` builds one retrieval scene per due concept, across lessons, and prefers an item other than the one answered last time.

## 2. Spacing: come back when recall fades

Each concept has a review memory (FSRS) that predicts how likely you are to recall it. A concept is due when that probability falls to 0.9. `get_study_plan` lists what is due across all lessons, in one call. Studium uses the published default FSRS weights and a fixed target; it does not tune them to each learner. See [Learner model](learner-model.md#retention-fsrs) and [Review over time](../learn/review-over-time.md).

## 3. Effort before help

Help is available, but it costs something, so the learner tries first.

- A quiz offers one authored hint in the standard path, all of them in the remedial universe.
- Each hint shrinks the credit of a correct answer (1.5, then 0.5, then 0.3 at medium difficulty) and gives the review a weaker grade.
- In a `discussion`, the tutor's reply is replaced by a neutral prompt when it would reveal the answer.

## 4. Feedback with its source

Feedback points to the reference and to where it comes from, not to a score alone.

- A graded verdict carries its reference as data: key points, planted flaws or flawed claims, and a model answer.
- In a lesson drafted from your sources, each graded item cites a passage, and each quote is checked character for character against it before the lesson is written.
- A count such as "3 of 4 key points" appears only when a judge measured it.

## 5. An explicit graph of concepts

The path is a graph you can read, not a hidden sequence. Concepts and tasks are linked by typed edges (`prerequisite_for`, `part_of`, `decomposes_into`, `assesses`, `aligns_with`). A missing prerequisite routes the learner to it, then back. A teacher can inspect and correct the graph in the bundle; the learner sees it in the VS Code pane.

## 6. Honest assessment

An estimate is only as good as the evidence behind it.

- Only a marked choice, a verdict deck scored against its key, or a judge moves mastery. Keyword matches do not.
- An answer nobody graded is not counted as wrong, and a concept never reviewed is not counted as forgotten.
- Self-rating schedules reviews and never moves mastery.
- Every lesson says who wrote its keys and whether a teacher validated it. See [Honesty and provenance](honesty-and-provenance.md).

## 7. Know what you know

Confidence checkpoints compare what the learner declares with what they have shown. A large gap opens a calibration panel, and measured overconfidence withholds a mastery certificate. Grounded audits measure, separately, how far the learner trusts a flawed AI reading of a real result. See [Learner model](learner-model.md#calibration).

## 8. Local-first

The learner's state stays on their machine by default, in folders named by pseudonyms, and can be erased. Class reports are aggregates with a floor of five learners. See [Privacy and limits](privacy-and-limits.md).

## Compared with other study modes

These comparisons describe the cited sources only, and what Studium does differently.

| Approach | What the source describes | How Studium differs |
|---|---|---|
| [ChatGPT study mode](https://openai.com/index/chatgpt-study-mode/) | A study mode inside a general chat assistant | Studium sits behind any assistant as a lesson with explicit keys, a concept graph and a durable learner model; the assistant relays and the learner answers |
| [LearnLM](https://arxiv.org/abs/2412.16429) | Improving a model's teaching behaviour by training it to follow pedagogical instructions | Studium works at the level of the lesson and its evidence, whatever the model; the pedagogy is in the bundle, the rules and the grading |
| [Learn Your Way](https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/) | Textbook content adapted to grade level and interests, in several representations, with section quizzes; a randomised study of 60 students reported higher scores on a retention test 3 to 5 days later | Studium does not rewrite the source for the learner's interests; it builds scenes and keys from it, cites the passages and says who wrote each key |
| [Anki](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm) | Cards scheduled by an SM-2 variant or FSRS, with a target retention | Studium schedules concepts rather than cards, and separates what schedules a review (any rating) from what measures mastery (graded evidence only) |
| [FSRS optimal retention](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention) | Target retention is a trade-off between workload and what is remembered, and the optimum varies by learner | Studium uses a fixed target of 0.9 and default weights; per-learner optimisation is not implemented |
| [MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/) | A proposed MCP extension for interactive interfaces inside chat hosts (`ui://` resources) | Studium returns text ready for any chat (`display_markdown`) and its own VS Code pane; MCP Apps support is deferred |

Studium can be combined with these: a harness running any model, or any study habit, can drive a Studium lesson over MCP.
