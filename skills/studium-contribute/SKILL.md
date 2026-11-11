---
name: studium-contribute
description: When Studium itself gets in the way, say so and help the person report it or propose a change on the project's repository. Use whenever, while using Studium, a tool fails or answers something its documentation or a skill contradicts, a step of a guide does not work, a screen or a message is confusing, a translation is wrong, or the person asks for something Studium cannot do today; and when someone asks how to report a bug, suggest a feature, give feedback on Studium or contribute to it. Tells apart a defect of the framework (the repository), an error in a lesson's content (its teacher or author) and a vulnerability (private report), drafts the report with the person without learner data, and leaves the posting to them.
---

# Studium: report a difficulty, ask for a feature, contribute

Studium is a research prototype, and it improves through what its users meet. A difficulty that
stays in one conversation is lost: the next learner or teacher meets it again. When Studium itself
is at fault, or lacks what the person needs, your job has three parts: say it plainly, help the
person on, then invite them, once, to report it or to propose the change. They decide, and they
post it.

Use the person's language and register (« tu » for a learner who uses it, « vous » otherwise).

## Recognise the moment

| You observe | It is |
|---|---|
| A tool returns an error on a call written as its description says, or a result that contradicts its description, a guide or a skill | a defect |
| A command or a step of the documentation does not work at this revision; two pages disagree; a link is dead | a defect, often of the documentation |
| A screen, a message or a notice the person does not understand, or misreads, after a fair reading; a wrong or missing translation | a difficulty of use |
| The person asks for something no tool, command or page offers | a missing feature |
| You had to work around Studium to finish the task | a defect or a missing feature: say which |

First rule out what is not Studium's: your own mistake in a call (read the error, fix the call), a
setup that is not finished ([Troubleshooting](../../docs/start/troubleshooting.md)), an old build
(`get_server_info`: `version`, `build`), the assistant's account or quota. If you are not sure the
fault is Studium's, say that you are not sure and what would settle it.

## Send it to the right place

| What is wrong | Where it goes |
|---|---|
| Studium itself: server, tools, extension, panel, dashboard, command-line tools, documentation, skills | the repository: an issue, or a change proposed as a pull request |
| A lesson that ships with Studium (the demo lessons under `fixtures/`) | the repository as well |
| The content of a teacher's lesson: a wrong key, an unclear statement, a doubtful source | its teacher. Studium has no tool that sends a remark to the teacher: the learner tells them, with the lesson, the scene's title and the sentence in question. Never the repository: the lesson is not public |
| A self-study lesson, or a lesson drawn from a conversation | its author is the learner's own assistant: correct the draft and call `create_lesson` again with `overwrite: true` ([studium-self-learner](../studium-self-learner/SKILL.md)) |
| A contribution a learner proposed to a course | the teacher's decision in the dashboard ([Learner contributions](../../docs/teach/learner-contributions.md)) |
| A way to read someone's data, to reach a key before an answer, or to bypass approval | a vulnerability: the private report of the [security policy](../../SECURITY.md), never a public issue |

Inside a lesson, a learner who doubts a concept's verdict has a move of their own:
`submit_response {kind: "contest", concept_id, claim}` asks for check questions
([studium-harness](../studium-harness/SKILL.md)). That is about their mastery, not a report on the
lesson.

## Say it plainly, help first

- Name what happened in one sentence, without softening it and without blaming the person:
  "This call failed although it follows the documentation; the fault is on Studium's side."
- For a missing feature: "Studium cannot do this today." Then what comes closest, if anything
  does, and what it does not cover. Never present a workaround as the feature, and never invent a
  tool, a flag or a setting.
- Get them moving again before anything else: the workaround, the other route, or the honest
  statement that there is none.

## Invite once, at the right moment

The rules of [studium-suggest](../studium-suggest/SKILL.md) hold here:

- **Never between a question and its answer**, and never while a self-rating is owed. Keep the
  remark for after the verdict, a pause, or the end of the session.
- **Once per difficulty.** A no holds for the session; do not rephrase the invitation. A second,
  different difficulty may be mentioned once too. At the end of a session with several, name them
  together in one invitation.
- **An explicit request is not an invitation**: when the person asks how to report something or to
  contribute, go straight to the draft.
- Not while they are under time pressure or say they are discouraged: help, and keep it for later.
- When the learner chose the `quiet` level of attention, say what failed (they need it to go on)
  and keep the invitation for after the session ends.

Words that work:

- « Nous venons de rencontrer une difficulté qui vient de Studium, pas de vous : [une phrase].
  Studium s'améliore grâce à ces retours. Voulez-vous la signaler ? Je prépare le texte, vous le
  relisez et vous le publiez sur le dépôt du projet ; cela prend quelques minutes. »
- « Ce que vous demandez n'est pas possible aujourd'hui dans Studium, et ce serait utile à
  d'autres. Voulez-vous le proposer ? Je rédige la demande avec vous. »
- "This came from Studium, not from you: [one sentence]. Reports like this are how it improves.
  Would you like to report it? I draft the text, you read it and post it on the project's
  repository."

Do not promise that it will be fixed, or when. Say what a report does: the maintainers read it.

## Draft the report with the person

Call `get_server_info {}`: `feedback` gives the addresses (`new_issue_url`, `issues_url`,
`contributing_url`, `security_url`) and `version` and `build` identify what ran. Without a
connected server, use the repository this skill came from:
<https://github.com/HolobiomicsLab/studium/issues/new/choose>. Never invent another address.

A useful report holds:

1. what the person was doing, in one or two sentences (role: learner, teacher, developer);
2. what they expected, and what happened: the exact message, shortened if long;
3. the smallest way to see it again: the call with its arguments, the command, or the page and
   the step;
4. the version and build (`get_server_info`), the assistant (Claude Code, Codex, Copilot in VS
   Code, …) and the platform;
5. for a missing feature: the need in the person's words, who it would serve, and what they do
   today instead. The need first, a solution only if they have one.

A report never holds:

- a learner's answers, free text, journal or results: describe what was answered ("a wrong choice
  on a quiz"), do not quote it;
- a name, an email, a school, a class, a `learner_id` that names someone, a pseudonym of the
  telemetry;
- an answer key, a hint or a model answer of a teacher's lesson, or the lesson itself;
- a token, an access code, an API key, the content of a `.env`;
- a data folder, a telemetry file, a transcript of the conversation;
- text copied from a source whose licence does not allow it;
- a path that names a person: write `~/…` or `<repo>/…`.

Reduce the example until none of this is needed: a demo lesson under `fixtures/` usually shows
the same defect.

Show the full draft, in English or French (both are read), and change what they ask. Suggest a
title that states the fact ("`start_review_session` returns `nothing_due` the day a review is
due"), not a judgement.

## The person posts it

An issue is public and is posted from the person's own account, so it is their act.

- Give the address and the form to pick: "Problem or difficulty" or "Feature request". Suggest a
  search of the open issues first (`issues_url`); a comment on an existing one is as useful as a
  new one.
- Post it yourself only when the person asks you to, after they have read the final text, and
  only with a tool they already use for GitHub. A yes to "shall I draft it?" is not a yes to
  posting.
- A student need not create an account to be heard: they can give the draft to their teacher, who
  posts it or passes it on. The issue forms also list a contact by email.
- If they decline, carry on. Do not file it for them, and do not keep the draft anywhere.

## Propose the change directly

Some reports are quicker as a change: a typo, a dead link, a sentence of a guide or of a skill
that is wrong, a missing translation.

- On GitHub, the pencil on a file opens an edit that becomes a pull request, with no checkout.
- With a checkout, follow [CONTRIBUTING](../../CONTRIBUTING.md): branch from `dev`, a failing test
  first for a behaviour, English and French pages together, the checks listed there, a pull
  request against `dev`. For anything larger than a small fix, an issue first.
- Do not change the person's checkout, open a branch or push on your own initiative: a
  contribution is a task they give you.
- Two limits no contribution moves: no lesson reaches students without a teacher's approval, and
  no learner data enters the repository.

## What this does not replace

- [Troubleshooting](../../docs/start/troubleshooting.md) comes first for an installation that does
  not start.
- A teacher's review of a lesson: [studium-teacher](../studium-teacher/SKILL.md).
- The person's own page on the subject: [Report a problem or contribute](../../docs/start/report-and-contribute.md).
