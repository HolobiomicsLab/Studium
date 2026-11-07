English · [Français](self-study-from-references.fr.md)

# Self-study from your references

Turn a text you chose into a lesson you can play on your own, without a teacher. Two routes lead to
the same kind of lesson: in a conversation with your assistant through the MCP tools (about 15
minutes, no shell), or with the command-line packet tools (30 to 45 minutes, more control over each
step). The [`studium-self-learner`](../../skills/studium-self-learner/SKILL.md) skill guides an
assistant through the command-line route.

The example is Émile Durkheim, *Les Règles de la méthode sociologique*, chapter I, « Qu'est-ce qu'un
fait social ? », on French Wikisource. The text is in the public domain; additions specific to the
site (notes, layout) follow the Wikisource licence. For another source, check its licence first: a
publisher PDF or an `NC`, `ND` or unknown licence restricts what you may do with the lesson.

You state the goal, supply the source, review the proposed outline and play the lesson. The
assistant extracts the passages, drafts the outline and scenes with exact quotes, and runs the
checks.

## Route 1: in a conversation (MCP)

With the Studium server connected to your assistant ([Connect your harness](../start/harnesses.md)),
send:

> I want to learn with Studium what distinguishes a social fact from an individual fact according
> to Durkheim, and apply it to a new example. Fetch chapter I of *Les Règles de la méthode
> sociologique* on French Wikisource (public domain) and build a French lesson from it. Favour
> scenes where I write (explain_back, comparison, summary_audit), with at most one quiz. Show me the
> outline without the answers.

The assistant then follows the steps of [Learn a topic in a conversation](learn-a-topic-in-a-conversation.md):

| Step | Tool | What you see |
|---|---|---|
| Read the brief | `get_authoring_guide {language: "fr"}` | The assistant asks for your goal if you did not give it |
| Cut the source into passages | `prepare_sources` with `{title, text, url, license: "public-domain"}` | Passages with ids such as `p:<source>:1` |
| Check and write the lesson | `create_lesson` | The outline (no key) and the authoring notice |
| Play | `start_lesson_session`, `submit_response`, `rate_recall` | One screen at a time, in your words |

The assistant fetches the page with its own web tool; Studium never fetches it. A source set holds
up to 20 sources and 200 000 characters in total, so a whole chapter fits. Each quote must match its
passage character for character, otherwise `create_lesson` refuses the draft and the assistant
corrects it. The lesson is written to your library (`~/.studium/library/<course_id>/lesson.json`) and
marked "AI-drafted, not checked by a teacher".

## Route 2: with the command-line tools

This route needs the Python environment from [Installation](../start/installation.md). Run the
commands from the repository root and choose a new working folder:

```bash
WORK="$HOME/studium-self-study"
```

### Extract the passages

```bash
.venv/bin/python tools/experience_packet.py passages \
  --url "https://fr.wikisource.org/wiki/Les_R%C3%A8gles_de_la_m%C3%A9thode_sociologique/Chapitre_1" \
  --title "Les Règles de la méthode sociologique, chapitre I" \
  --license public-domain --out "$WORK/passages.json"
```

`--html FILE`, `--pdf FILE` or `--text FILE` replace `--url`; `--min-chars` (default 200) and
`--max-chars` (default 1200) bound the passage size. The output is an inert envelope
(`origin: "self-study-passages/1.0"`): these are the only texts the lesson may quote. On a Wikimedia
page the command skips navigation, footer and categories; a short paragraph is merged with its
neighbours, and `dropped_short` counts what was still dropped. Skim the passages: a stray one (site
metadata, a lone footnote call) can simply stay uncited. If most are stray, start again from a
cleaned text file with `--text`.

### Prepare the authoring packet

```bash
.venv/bin/python tools/experience_packet.py prepare --passages "$WORK/passages.json" \
  --title "Qu'est-ce qu'un fait social ?" --target "Self-learner, undergraduate level" \
  --out "$WORK/packet"
```

The packet holds `evidence.json`, `author-task.md` and `response.schema.json`. Because the envelope
comes from `passages`, `prepare` writes the self-study brief and prefixes evidence ids with
`passage:` (`--self-study` forces the brief for an envelope of another origin). `prepare` refuses a
non-empty destination and has no `--force`.

### Have the assistant draft

> Read `author-task.md`, `evidence.json` and `response.schema.json` in the packet. My goal: say
> what distinguishes a social fact from an individual fact according to Durkheim, and apply it to a
> new example. Write `author-response.json` in French (`language: "fr"`) with exact quotes and their
> evidence ids. Favour scenes where I write; at most one quiz. Keep `status: draft` and
> `validated_by: null`. Then show me the outline without the expected answers.

Review the outline and ask for corrections. Do not open `author-response.json` yourself: it already
contains the expected answers. Its `learning_workflow_graph` is optional: `bundle` derives the graph
from each concept's `prerequisites`.

### Check the draft

```bash
.venv/bin/python tools/experience_packet.py check --packet "$WORK/packet" \
  --response "$WORK/author-response.json" --out "$WORK/courses/durkheim-fait-social"
```

A quote that is not an exact substring of its passage produces an `ERROR`: the assistant fixes the
draft, never the evidence. `--json` prints one machine-readable report; `--force` replaces an
existing output. The `Key classes:` line sorts scenes by who holds their key:

| Class | Scene types | What it means here |
|---|---|---|
| `ungraded` | intro, concept, meta_checkpoint | Nothing is graded |
| `author_keyed` | quiz, spot_the_flaw | The key was written by whoever answers: open book |
| `production` | explain_back, comparison, summary_audit, prompt_practice, communication_sim, discussion, ai_critique | You write a text; without a judge model you compare with the reference and rate your recall |
| `externally_grounded` | reproduction | Graded against an attested run; a sociology text provides none |

### Build and lint the lesson

```bash
.venv/bin/python tools/experience_packet.py bundle --course "$WORK/courses/durkheim-fait-social" \
  --out "$WORK/bundles/durkheim-fait-social/lesson.json" --self-study \
  --note "Personal study of chapter I, Wikisource"
```

`--self-study` records `metadata.authoring = {mode: "self_study", author_is_learner: true, note}` and
`validated_by: "SELF-STUDY — not teacher-validated"`. The bundle is a skeleton: the assistant replaces
every `TODO:` text from the passages (quiz choices, key points and their 2 to 4 short `cues`, model
answers). In a `summary_audit`, each `flaws_expected` entry is one planted flaw: one phrasing per
flaw, each named in `model_correction`. Then validate and lint:

```bash
apps/lesson-mcp/node_modules/.bin/tsx tools/bundle_validate.ts "$WORK/bundles/durkheim-fait-social/lesson.json"
node tools/bundle_lint.mjs "$WORK/bundles/durkheim-fait-social/lesson.json"
```

| Lint line | Meaning |
|---|---|
| `INFO self_study_authoring` | The lesson declares itself self-authored |
| `WARN self_study_open_book` | Lists the `author_keyed` scenes: the quiz is open book |
| `INFO lwg_single_graded_item` / `WARN lwg_prereq_unassessable` | A concept has one, or no, scene graded by a key: expected with mostly production scenes |
| `WARN concept_few_recall_questions` | A concept has fewer than two quizzes of its own: a learner who says « I know it » of that concept is asked one check question, or none, instead of two |
| `WARN self_study_no_external_key` | No production or reproduction scene: add one rather than ignore it |

An `ERROR` fails the command and must be fixed. Rules for filling a skeleton are in
[Author a lesson](../teach/author-a-lesson.md).

### Play it

Do not open `plan.json` or `lesson.json` before playing: the key is in plain text there. The server
removes expected answers from what it shows, but cannot erase what you already read.

To play through your assistant, copy the lesson into your library (`~/.studium/library`, or
`<STUDIUM_HOME>/library`), which the server always searches:

```bash
mkdir -p "$HOME/.studium/library" && cp -R "$WORK/bundles/durkheim-fait-social" "$HOME/.studium/library/"
```

Then ask: "Start the Studium lesson `durkheim-fait-social/lesson.json`." In VS Code, set
`studium.bundlesRoot` to the full path of your `bundles` folder and run **Studium: Pick a course**. The first screen shows
the notice of a learner-drafted lesson:

> Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre
> ouvert). Sans juge modèle, les scènes de production ne sont pas évaluées : compare ta réponse à la
> référence affichée et note ton rappel […]

The notice follows the lesson's language; the English version begins "Self-authored lesson: quiz and
spot-the-flaw keys were written by the learner (open book)." Answer in your own words, as in
[Your first lesson](first-lesson.md). After a graded answer, when the lesson moves on, the feedback
shows the reference and the passage the scene cites.

## What this lesson is not

- **A validated lesson.** No teacher has reviewed it. Exact quotes and a valid schema do not
  guarantee the interpretation; check the central claims in the text itself.
- **An assessment, without a judge model.** With `LITELLM_BASE_URL` empty (the default), production
  scenes show the reference and ask you to rate your recall; the rating schedules reviews and never
  moves mastery. Only keyed questions such as the quiz do. A judge model is a paid route, to decide
  before enabling it ([Configuration](../reference/configuration.md)).
- **A shared contribution.** The lesson stays in your library and nothing is sent to other
  learners. A lesson for students goes through teacher review first (rule 003): see
  [Learner contributions](../teach/learner-contributions.md).
