English · [Français](report-and-contribute.fr.md)

# Report a problem or contribute

Studium is a research prototype, and it improves through what its users run into. This page tells you
where to send a defect, a confusing step or a missing feature, what to put in a report, and how to
propose a change yourself.

## Where it goes

| What is wrong | Where it goes |
|---|---|
| Studium itself: the server and its tools, the VS Code extension, the lesson panel, the teacher dashboard, the command-line tools, the documentation, the skills | an issue on the [repository](https://github.com/HolobiomicsLab/studium/issues), or a change proposed as a pull request |
| A demo lesson that ships with Studium (under `fixtures/`) | the repository as well |
| The content of your teacher's lesson: a key that looks wrong, an unclear statement, a doubtful source | your teacher. Studium has no tool that sends them a remark: tell them the lesson, the scene's title and the sentence. Not the repository: the lesson is not public |
| A self-study lesson your assistant drafted from your sources | your assistant: ask it to correct the draft and create the lesson again |
| A way to read someone's data, to see a key before answering, or to bypass a teacher's approval | the private report of the [security policy](../../SECURITY.md), never a public issue |

## What your assistant does

When Studium itself fails, contradicts its documentation or cannot do what you ask, a connected
assistant is told to say so plainly and to help you on first. Then it offers, once and at a pause, to
prepare a report with you: it drafts the text, you read it and you post it. It does not interrupt a
question you are answering, it does not ask twice, and it posts nothing on its own.

You can also ask at any time:

```text
Help me report to Studium what just happened. Draft the text; I will post it myself.
```

The addresses come from the server (`feedback` in `get_server_info`), so the assistant does not have to
guess them. The full procedure is the `studium-contribute` skill ([Skills](skills.md)).

## Write a useful report

1. What you were doing, in one or two sentences, and your role: learner, teacher, developer.
2. What you expected and what happened, with the exact message, shortened if it is long.
3. The smallest way to see it again: the request to the assistant, the tool call, the command, or the
   page and the step.
4. The version of Studium (`get_server_info` gives `version` and `build`; the extension shows its
   version in VS Code), your assistant and your platform.
5. For a missing feature: the need in your own words, who it would serve, and what you do today
   instead.

## Leave out

- A learner's answers, texts, journal or results.
- Names, email addresses, a school or a class, a learner identifier that names someone.
- The answer key, the hints or the model answers of a teacher's lesson, and the lesson itself.
- Tokens, access codes, API keys, a `.env` file.
- A data folder, a telemetry file, a whole conversation.
- Text copied from a source whose licence does not allow it.

A demo lesson under `fixtures/` usually shows the same defect without any of this.

## Open the issue

1. Search the [open issues](https://github.com/HolobiomicsLab/studium/issues): a comment on an
   existing one is as useful as a new one.
2. Open a [new issue](https://github.com/HolobiomicsLab/studium/issues/new/choose) and pick a form:
   "Problem or difficulty", "Feature request", or "Tester feedback" after the walkthrough of
   [TESTING.md](../../TESTING.md).
3. Write in English or in French.

An issue is public and is posted from your own GitHub account. Without an account, give the text to
your teacher, or use the contact listed on the form page. A report is read by a maintainer, who may ask
you a question; it does not commit the project to a date.

## Propose a change yourself

A typo, a dead link, a wrong sentence in a guide or a skill, a missing translation: on GitHub, the
pencil on a file opens an edit that becomes a pull request, with no checkout. For code, follow
[CONTRIBUTING](../../CONTRIBUTING.md): branch from `dev`, a failing test first, both languages of a
page together, and for anything larger than a small fix, an issue first. Two limits hold for every
contribution: no lesson reaches students without a teacher's approval, and no learner data enters the
repository.

Related pages: [Troubleshooting](troubleshooting.md), [Skills](skills.md),
[Privacy and limits](../concepts/privacy-and-limits.md).
