English · [Français](language-and-supports.fr.md)

# Language and supports

Learn in the language you prefer, ask for the representation that helps you (an equation, a diagram, a
molecule, a plain explanation), and open short help on why a step is asked of you. Changing the language
changes only what you see: the original sources, your answers, identifiers, numbers, units and scientific
notation stay as they are. A translation helps you understand; it is not new evidence.

## Choose your language

**With an assistant.** Say it at the start or at any time: "Continue in French; keep the original quotations
next to the translations." The assistant translates its explanations, instructions, feedback and captions with
its own text abilities; no image model is needed and Studium calls no translation service in the background.
Studium's ready-made chat text exists in English and French; for any other language the assistant translates
it. Check specialised terms, negations and assessment instructions in a translation.

Under the hood, the assistant passes `presentation_language` (a BCP 47 tag such as `fr` or `de`) to
`start_lesson_session`, or calls `set_session_language` with `{session_id, presentation_language}` to change it;
`null` returns to the lesson's own language. The choice lasts for the live session, not as an account setting.

**With the file channel.** Start the runner with `--language=fr`, or write `session-language.json` with the same
session id and the new language, then wait for the refreshed `task.md`.

**In VS Code.** The pane's interface follows VS Code's display language (English or French); the lesson text
stays in the language it was written in.

**In a portable activity.** The language selector switches between the translations the teacher supplied,
without resetting your prediction, choices, confidence or trace. Text with no translation stays in its source
language, with a visible notice; the selector never pretends to machine-translate a lesson.

A translated lesson offered to other students still goes through the teacher's review
([review and approve](../teach/review-and-approve.md)).

## Ask for a representation

| You need | What renders locally |
|---|---|
| An equation | KaTeX, with accessible MathML |
| A process, a relation between concepts, a mind map | A Mermaid diagram |
| Molecular connectivity | A 2D structure drawn from SMILES (SmilesDrawer), labelled as a 2D depiction |
| An original figure or a generated explanation | A still image with its source and alternative text |
| Narration or a short clip | A native player with transcript or captions |

These are the supports of portable activities. The VS Code pane also renders scene figures, equations, plots,
spectra and 3D structures, and the `studium.modalityPreference` setting (`visual`, `textual` or `balanced`, the
default) puts figures or text first; nothing is removed, the other modality is collapsed.

Prefer one or two useful supports to a gallery. Explanatory supports are offered after your prediction. A
support is learning material: it is not evidence that a computation ran or that you were assessed. A
malformed equation or an unsupported representation shows its source text instead of an invented graphic.

### An AI-generated image

If your assistant has an image tool, you may ask it for a graphical explanation. Prefer an existing figure, a
diagram or a calculated plot first. Image generation can take time and may use a limited or paid allowance;
the assistant should use the route you have and ask you, never switch providers silently. A generated image is
shown with the notice "AI-generated image; details may be inaccurate." and must never stand in for a measured plot, a molecular
structure or a source figure. Check its symbols, atoms, numbers and arrows. Nothing generates images
automatically. Teachers attach and document such files as described in
[media and visual support](../teach/media-and-visual-support.md).

## Help on every step

The **?** symbols open short help, by click, touch, or Enter or Space after Tab; Escape or a click elsewhere
closes it in activities and the Observatory. A second level gives the method, its limits and its source in the
project. Help is optional: instructions, warnings, privacy choices and scientific limits always stay on the
page itself. It explains why a step is asked and suggests an approach, never the answer.

| Principle | What it is for | What not to conclude |
|---|---|---|
| Explicit goal | Link the activity to a skill to practise | Finishing does not prove mastery |
| Prediction before result | Make your first reasoning visible | Being wrong is not a diagnosis |
| Declared confidence | Look at your own uncertainty | Certainty is not accuracy |
| Controlled comparison | See the effect of one choice against a reference | A comparison shown is not necessarily a new run |
| Observation, then conclusion | Separate a result from its interpretation | A fluent explanation is not proof |
| Scaffolding | Temporary support, then you act | An adaptation is not a fixed learner profile |
| Critical review | Justify agreement or objection with evidence | Rejecting everything is no better than accepting everything |
| Transfer | Apply an idea to another case | The first activity does not measure later retention |
| Provenance | Find sources, decisions and checks | A hash does not certify scientific truth |
| Human review | Examine an exact revision before teaching with it | Opening MySTRA neither validates nor publishes a course |

These describe design intentions; they do not claim that Studium is pedagogically effective. Background:
[learning principles](../concepts/learning-principles.md).

Help is available in English and French. In activities it follows the language selector; for another language
English is shown, marked `lang="en"`, and the assistant can explain it. The help works without JavaScript, does
not rely on colour alone, has an accessible name tied to its subject and opens inside the page so it never
hides a control on a small screen. Help reading is never recorded as evidence of learning or as a request for
assistance.

You find it in the portable activity templates, the linked spectrum viewer, the Observatory and MySTRA, new
portable reports, the web interfaces and the VS Code pane. Reports and viewers built earlier do not gain it
after the fact; in a chat or notebook, the assistant gives the explanation in text.

## For teachers: prepare an activity in another language

```bash
pnpm install --frozen-lockfile
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/experience_templates.py prepare \
  --template conclusion-robustness --context PUBLIC_CONTEXT.json --out ACTIVITY \
  --language fr \
  --translations examples/visual-support/robustness-fr.json \
  --supports examples/visual-support/robustness-support.json
```

- A translation file maps a language tag to exact original text and its translation:
  `{"fr": {"Original sentence": "Phrase traduite"}}`. Keep formulas, numbers, units, ids, code and chemical
  notation unchanged; text is inserted as text, never HTML. Version reviewed translations with the material.
- The supports manifest is an object with `render_assets`, following the
  [RenderAsset contract](../../packages/lesson-bundle-schema/src/render-asset.ts). Each support states its
  scope and names its source in `provenance`. `meta.placement: "before_prediction"` makes a source photograph
  or a non-answer introduction available before the prediction; `meta.origin: "generated"` marks a generated
  image.
- Preparation bundles assets into the HTML and runs renderers locally, with no CDN or model call. Rich
  supports add several megabytes; text-only activities stay light. Unsupported kinds are refused.
- `presentation.json` keeps the initial language, the dictionaries and the prepared assets, with its own digest
  in the preparation provenance. The learner-actions export does not record language switches or which supports
  were viewed.

Rights, accessible audio and video, and attaching a file generated by a learner's assistant:
[media and visual support](../teach/media-and-visual-support.md).

## For developers: reuse the help catalogue

One source holds the texts and the scene-to-topic map: [ui/context-help.json](../../ui/context-help.json)
(schema `studium/context-help/v1`). Each topic has a stable id, a title, a definition, student and teacher
advice, a goal, a method, a limit and a source path in the repository.

| Context | Entry point |
|---|---|
| Python | `help_tip("prediction", "student")` and `add_contextual_help(page)` in [tools/contextual_help.py](../../tools/contextual_help.py); place `<!-- HELP:prediction -->` in a section |
| JavaScript | `renderHelp("prediction", catalogue, "student")` from [ui/context-help.mjs](../../ui/context-help.mjs), with `ui/context-help.css` |
| React | `ContextHelp` from `@studium/activity-presentation/react`, with `topic`, `audience` and `language` |
| Chat | The relevant fields, in text, in the requested language |

Place help next to its section, never inside numeric cells, form labels, answer controls or titles rewritten by
script. Never put scene objects, answer keys, profiles or learner text in the catalogue. Renderers escape text
and refuse unknown topics; a new topic needs both languages, a concrete goal, a limit and an existing source.
