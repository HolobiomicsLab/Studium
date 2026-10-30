# Durkheim self-study example

This is a finished, short French self-study lesson built from the committed HTML capture of chapter I of Émile Durkheim's *Les Règles de la méthode sociologique*. It teaches how Durkheim distinguishes a social fact by externality, coercion, and an existence independent of individual manifestations.

The lesson takes about 18 minutes. Its four scenes combine a sourced introduction, one open-book quiz, a comparison, and a teach-back exercise. The two production scenes ask the learner to reason in their own words rather than only recognize an answer.

## Files

- `passages.json` is the portable capture of the 29 passages extracted from `tools/fixtures/self-study/durkheim-ch1.html`. Four passages are cited by the lesson.
- `author-response.json` is the draft LessonPlan and its four character-for-character source links.
- `lesson.json` is the finished LessonBundle 1.4 generated from that plan and then filled with the learner-facing content and grading references.

The bundle declares `metadata.authoring.mode = "self_study"`, `author_is_learner = true`, and `validated_by = "SELF-STUDY — not teacher-validated"`. The quiz key therefore remains open-book and learner-authored. This example is for private study; it is not a teacher approval or a release to students.

## Reproduce the pipeline

Run from the repository root with the project virtual environment:

```bash
.venv/bin/python tools/experience_packet.py passages \
  --html tools/fixtures/self-study/durkheim-ch1.html \
  --title "Les Règles de la méthode sociologique — chapitre I" \
  --license Public-Domain \
  --out /tmp/durkheim-passages.json

.venv/bin/python tools/experience_packet.py prepare \
  --passages /tmp/durkheim-passages.json \
  --title "Comprendre le fait social chez Durkheim" \
  --target "Licence 1 — étude autonome" \
  --self-study \
  --out /tmp/durkheim-packet

.venv/bin/python tools/experience_packet.py check \
  --packet /tmp/durkheim-packet \
  --response examples/self-study-durkheim/author-response.json \
  --out /tmp/durkheim-course

.venv/bin/python tools/experience_packet.py bundle \
  --course /tmp/durkheim-course \
  --self-study \
  --out /tmp/durkheim-skeleton.json
```

The `bundle` command deliberately produces an authoring skeleton. The committed `lesson.json` supplies the finished scene fields while retaining the generated IDs, concepts, graph, rules, metadata, and disclosure. The end-to-end test performs that fill and checks the result:

```bash
.venv/bin/python -m pytest tools/test_self_study_e2e.py -q
node tools/bundle_lint.mjs examples/self-study-durkheim/lesson.json
pnpm exec tsx tools/bundle_validate.ts examples/self-study-durkheim/lesson.json
```

## Source

Émile Durkheim, *Les Règles de la méthode sociologique*, chapter I, 1895. The saved public-domain Wikisource page is the sole source used here; no live fetch is needed.
