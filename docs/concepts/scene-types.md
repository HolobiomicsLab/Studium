English · [Français](scene-types.fr.md)

# Scene types

A Studium lesson is built from 13 scene types. This page tells you, for each one, what it asks of the learner, how the answer is graded, who holds the key, and whether the answer can move measured mastery. Use it to choose scenes when you author a lesson, or to understand the feedback you get as a learner.

## The 13 types at a glance

| Type | What the learner does | Answer | Key class | Can move mastery |
|---|---|---|---|---|
| `intro` | Sees the goal and the path of the lesson | acknowledge | ungraded | no |
| `concept` | Reads and works with one idea | acknowledge | ungraded | no |
| `meta_checkpoint` | Declares how confident they are (0 to 4), once or before and after | confidence | ungraded | no; feeds calibration |
| `quiz` | Chooses an answer | choice | author-keyed | yes |
| `spot_the_flaw` | Finds the errors in a deliberately flawed text | verdict deck or free text | author-keyed | yes for the deck; free text only with a judge |
| `ai_critique` | Critiques an AI production | free text | production | only with a judge |
| `explain_back` | Explains the idea in their own words, as if teaching it | free text | production | only with a judge |
| `comparison` | Compares two objects or explanations | free text | production | only with a judge |
| `summary_audit` | Checks an AI summary for omissions and distortions | free text | production | only with a judge |
| `prompt_practice` | Writes or improves a prompt for a task | free text | production | only with a judge |
| `communication_sim` | Communicates a message to an audience, in a professional role | free text | production | only with a judge |
| `discussion` | Reasons with a tutor over several turns | turns (`submit_turn`) | production | no |
| `reproduction` | Has the harness run a protocol, then examines the result | run result | externally grounded | no; grounds later audits |

*Judge* means a model configured on the server (`LITELLM_BASE_URL`). The key classes are defined in [`key-class.ts`](../../packages/lesson-session-host/src/key-class.ts) and explained in [Honesty and provenance](honesty-and-provenance.md).

## How each family is graded

### Acknowledged scenes

`intro` and `concept` complete when the learner moves on. Nothing is graded and nothing is recorded as evidence.

### Confidence checkpoints

`meta_checkpoint` records a confidence from 0 to 4 for a concept. Studium compares it with the concept's measured mastery: the gap is the learner's calibration. A large gap can open a calibration panel (modulator M3). The answer is never right or wrong. See [Learner model](learner-model.md#calibration).

### Choices

`quiz` compares the chosen option with the key. The update corrects for guessing: on a two-option item, a learner who answers at random no longer reads as 50 % mastered. Hints are available on quizzes (`request_hint`) and reduce the credit of a correct answer.

### Audits with a verdict deck

`spot_the_flaw` can present a *verdict deck*: the learner marks each claim as flawed or sound. The deck is scored against the key by identity, never by looking for words. It passes when at least 60 % of the planted flaws are caught and at least half of the sound claims are left unflagged, so flagging everything does not pass. When the scene is grounded in a real executed result, the deck also measures over-trust and over-distrust of an AI reading.

### Free-text answers

`ai_critique`, `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim` and the free-text form of `spot_the_flaw` are compared with authored key points or planted flaws.

- **With a judge**, the model scores the answer; a score of 0.6 or more counts as correct and moves mastery. The feedback can then state a measured count, such as the key points covered.
- **Without a judge**, the answer is not assessed. The verdict shows the reference to compare with and asks the learner to rate their recall (again, hard, good, easy). That rating schedules reviews and never moves mastery. No "X of Y covered" count is shown, because nothing measured it.

The reference arrives as data on the verdict, labelled by `reference_kind`:

| `reference_kind` | Scene types | What the learner compares with |
|---|---|---|
| `key_points` | `explain_back`, `comparison`, `prompt_practice`, `communication_sim` | the points a good answer covers, and a model answer |
| `planted_flaws` | `spot_the_flaw`, `summary_audit` | the claims that hid a flaw, and the model correction |
| `flawed_claims` | `ai_critique` | the claims that hid a flaw, with the flaws their author expected |
| `correct_choice` | `quiz`, answered wrong | the text of the right choice ("The right answer") |

Every verdict also says who assessed the answer in `assessed_by`: `key`, `judge` or `none`. See
[honesty and provenance](honesty-and-provenance.md#who-assessed-an-answer).

### Discussion

`discussion` is a dialogue of a few turns on a topic and a seed claim. When a model is configured, each turn is classified as a reasoning move (justification, hypothesis, question, counterexample or synthesis) and a Socratic tutor replies; a reply that would reveal the answer is replaced by a neutral prompt. The scene never moves mastery.

### Reproduction

In a `reproduction`, the harness provisions and runs a protocol described by the scene's run manifest; Studium never executes code itself. The harness returns a run result (`submit_run_result` or the file channel). Studium checks that it is consistent with the manifest: declared outputs produced, declared checks reported and passed, a landmark line returned. An inconsistent run can still advance the lesson but never grounds a judgment. A consistent run can ground a later `spot_the_flaw`, so the learner audits an AI reading of their own result. This raises the bar against partial or careless runs; it is not a cryptographic proof of execution.

## Difficulty

The weight of an answer depends on the Bloom level of its concept: `remember` 0.3, `understand` 0.5, `apply` 0.6, `analyze` 0.7, `evaluate` 0.8, `create` 0.9. Without a Bloom level, a quiz weighs 0.5 and the other graded types 0.7. A harder item earns less credit when right and costs more when wrong.

## Authoring notes

- An assistant using `create_lesson` can draft every type except `reproduction`, which needs a run manifest and a capsule.
- A self-study or agent-drafted lesson with only author-keyed scenes gets the lint warning `self_study_no_external_key`: add a production scene judged by a model, or a reproduction.
- Field-by-field schemas are in the [lesson bundle reference](../reference/lesson-bundle.md); the graders are in [`graders.ts`](../../packages/lesson-session/src/grading/graders.ts).
