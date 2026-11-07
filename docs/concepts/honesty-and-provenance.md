English · [Français](honesty-and-provenance.fr.md)

# Honesty and provenance

Studium tells the learner who wrote each answer key, whether anything actually assessed their answer, and whether a teacher validated the lesson. This page explains how: key classes, the judge, self-rating, the notices, source quotes, the approval record, and the rule that no content reaches students without a teacher.

## What every lesson declares

`start_lesson_session`, `get_operator_context` (and so the file channel's `task.md`) and each presentation carry an `authoring` block. The VS Code pane shows its notice as a banner.

| Field | Meaning |
|---|---|
| `mode` | `teacher` (default) or `self_study` |
| `author_is_learner` | the learner wrote the lesson |
| `validated` | false when `validated_by` is a `DRAFT` or `SELF-STUDY` placeholder |
| `judge` | a judge model is configured on this server |
| `notice` | the text shown to the learner for a self-study lesson; null for a teacher lesson |
| `approval` | whether an `approval.json` exists next to the lesson, and whether it matches this exact `lesson.json` |

Who drafted the lesson comes from `metadata.authoring.drafted_by` (`teacher`, `learner` or `agent`); a self-study bundle without it reads as drafted by the learner.

## Key classes

Every scene type belongs to one of four key classes ([`key-class.ts`](../../packages/lesson-session-host/src/key-class.ts)). `experience_packet.py check` prints them on its `Key classes:` line and the linter repeats them.

| Class | Scene types | Who holds the key | In a self-study lesson |
|---|---|---|---|
| `ungraded` | `intro`, `concept`, `meta_checkpoint` | nobody | nothing is graded |
| `author_keyed` | `quiz`, `spot_the_flaw` | the author of the lesson | open book when the author is the learner; unchecked when an agent drafted it |
| `production` | `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim`, `discussion`, `ai_critique` | a judge model, if configured | without a judge, the reference is shown and nothing is assessed |
| `externally_grounded` | `reproduction` | an executed run, checked against its manifest | the only key no author wrote |

## The judge

A judge is a model the server reaches through `LITELLM_BASE_URL`. `get_server_info` reports `model_backend: configured` or `none`. Only an evaluation whose source is the model certifies a free-text answer; a score of 0.6 or more counts as correct.

Studium no longer grades free text by keywords. Matching authored cue words anywhere in an answer measures vocabulary, not understanding: measured against a teacher on a real lesson, it inverted 11 answers out of 12. Without a judge, the feedback shows the reference to compare with and states no count.

## Who assessed an answer

Every verdict says who assessed the answer in `assessed_by`: `key` (the author's key, for a quiz or a verdict deck), `judge` (the judge model) or `none` (nobody: an unjudged written answer, an acknowledgement). `graded` only means that an answer was submitted. The text shown to the learner marks ✓ only when `correct` is true and ✗ only when it is false; an answer nobody assessed is shown as recorded.

After the answer, a verdict carries its reference as data, labelled by `reference_kind`: the key points an answer should cover, the planted flaws, the claims a critique should challenge, or `correct_choice`, the text of the right choice when a quiz was answered wrong ("The right answer"). Like the cited passages, the reference is released only when the learner leaves the scene for good; a retry of the same item keeps it back.

## Self-rating

After a free-text answer no judge assessed, the learner rates their recall: again, hard, good or easy. The rating schedules the next review (FSRS) for every concept of the rated scene and never moves mastery. Its record carries `source: "self_rated"`, so a report can tell it apart from graded evidence. See [Learner model](learner-model.md#self-rating).

## Notices

A self-study lesson starts with a notice in the lesson's language (French for a French lesson, English otherwise). It joins a sentence on who wrote the keys with a sentence on what is assessed.

| Drafted by | First sentence |
|---|---|
| learner | "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book)." |
| agent | "AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; tell the assistant about a key that looks wrong." |

| Judge | Second sentence |
|---|---|
| none | "Without a judge model, production scenes are not assessed: compare your answer with the provided reference and rate your recall; that rating schedules your reviews and never changes your mastery." |
| configured | "Production scenes are assessed by the model." |

A lesson that holds a reproduction adds a third sentence: "Executed reproductions carry an external assessment."

The texts are defined in [`authoring.ts`](../../packages/lesson-session-host/src/authoring.ts).

## Sources and quotes

A lesson an assistant drafts with `create_lesson` cites a source passage for each graded item. Each quote must be a substring of the passage it names, 15 to 500 characters long. Only what a copy through a chat or a web page changes silently is folded: no-break spaces and runs of whitespace become one space, and typographic apostrophes become `'`. Accents, case and other punctuation stay significant. A quote that does not match is refused with a pointer to where it diverges, and the lesson is not written.

The licence given for each source is copied into the lesson's citations (`evidence.bibliographic_refs[].license`) and shown after the source's title; a source prepared without a licence gets no licence field.

The cited passages of a graded scene are released only after the answer, when the learner leaves the scene for good.

An exact quote proves a textual link, not that the item uses it correctly. That is why the agent-drafted notice asks the learner to tell the assistant about a key that looks wrong.

## Lint findings on authorship

`node tools/bundle_lint.mjs` adds these findings when `metadata.authoring` is present. WARN and INFO do not fail the run.

| Code | Level | When |
|---|---|---|
| `self_study_authoring` | INFO | always in self-study mode: mode, drafter, key classes |
| `self_study_open_book` | WARN | author-keyed scenes whose key the learner wrote |
| `self_study_agent_key` | WARN | author-keyed scenes whose key an agent drafted; check each against its passage |
| `self_study_no_external_key` | WARN | no production and no externally grounded scene |
| `learner_authored_validated` | INFO | a learner's lesson released as a teacher bundle |

## The approval record

A teacher records approval of a finished lesson with:

```bash
.venv/bin/python tools/experience_packet.py approve --bundle path/to/lesson.json --validated-by "Teacher name"
```

The command refuses a lesson with remaining placeholders, with lint errors, or in self-study mode (which includes lessons drafted with `create_lesson`). It sets `validated_by` and `validated_at`, then writes `approval.json` (schema `studium-approval/1`) next to the lesson with the SHA-256 of the exact bytes of `lesson.json`, the reviewer, the date, an optional checklist (`--checklist KEY=VALUE ...`) and the lint summary.

The server reads the record and reports `approval.matches`: any edit to `lesson.json` after approval makes it false. The record is a file anyone with write access can edit; it documents a review, it is not a signature. Teachers can inspect a draft without seeing its keys with the MCP tool `review_lesson`. See [Review and approve](../teach/review-and-approve.md).

## Rule 003: a teacher before any release

The project's rule 003 is strict human-in-the-loop: no content is released to students without a teacher's validation. In practice:

- a teacher bundle carries the name of the teacher in `validated_by`;
- a self-study or agent-drafted lesson is for the learner who made it, and says so in its notice;
- a learner's contribution reaches other learners only after a teacher's decision, see [Learner contributions](../teach/learner-contributions.md).

Studium makes provenance visible; it does not certify that a lesson is correct. The [privacy and limits](privacy-and-limits.md) page says what hashes, quotes and run checks do and do not prove.
