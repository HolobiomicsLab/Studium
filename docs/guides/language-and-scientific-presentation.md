# Languages and scientific representations

Studium separates the source lesson, what the learner sees, and what the learner
writes. A language change affects presentation; it must preserve the original
source, learner responses, identifiers, numerical values, units and scientific
notation. A translation is an aid to understanding, not new scientific evidence.

## In an AI harness

Use the `studium-harness` skill and state your preferred language at the start,
for example: “Continue in French; keep original quotations alongside translations.”
You can change it during the session. The public operator context carries the
presentation language. The harness translates its explanations, instructions,
feedback and support captions in that language. This uses the harness's text
capability; it does not require an image-generation model. Source quotations and
student responses remain attributable to their original authors.

For MCP, pass `presentation_language: "fr"` to `start_lesson_session`, then use
`set_session_language` with `{session_id, presentation_language: "de"}` to change it;
`null` restores the lesson's source language. For the file runner, use `--language=fr`
at startup, or write `session-language.json` with the same session ID and selected
language. Wait for the refreshed `task.md` before presenting the next explanation.
The preference lasts for the live session; this is not a global account setting.

Automatic translation is performed by the connected harness when instructed.
Studium does not call a translation API in the background. Check specialised terms,
negations and assessment instructions. The existing teacher review boundary still
applies to a translated lesson offered to other students.

## In portable activities

All five templates accept an initial language and optional text dictionaries.
Their selector can be changed during the activity without resetting the prediction,
choices, confidence or local trace. The interface includes French translations of
common controls. Untranslated content remains in its source language with a visible
notice; the selector does not pretend to machine-translate an arbitrary lesson.

```sh
pnpm install --frozen-lockfile
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/experience_templates.py prepare \
  --template conclusion-robustness --context PUBLIC_CONTEXT.json --out ACTIVITY \
  --language fr \
  --translations examples/visual-support/robustness-fr.json \
  --supports examples/visual-support/robustness-support.json
```

A translation file maps language tags to exact original text and its translation:
`{"fr": {"Original sentence": "Phrase traduite"}}`. The harness can prepare this
file from the public activity, keeping mathematical expressions, numbers, units,
IDs, code and chemical notation unchanged. Text is inserted as text, never HTML.
Keep translations under version control with teaching material after review.

`presentation.json` retains the selected initial language, translation dictionaries
and prepared assets. Its digest is recorded in preparation provenance separately
from the existing scientific activity identity. The current learner-actions export
does **not** record language switches or which visual supports were viewed; do not
infer either from an activity trace. ASTRA/MySTRA reports and the other legacy GUIs
retain their existing interface language until their own localization migration.

## Choose a representation without requiring multimodal access

| Need | Local representation | Input |
| --- | --- | --- |
| Equation or mathematical description | KaTeX, with accessible MathML | `equation_latex`, or explicit `\(...\)`, `\[...\]`, `$$...$$` delimiters in descriptions |
| Process, concept relation, mind map | Mermaid | `code` asset with `language: "mermaid"` |
| Molecular connectivity | SmilesDrawer 2D structure | `mol_3d` asset with `format: "smiles"`; labelled as a 2D depiction |
| Original figure or generated explanation | Embedded passive raster image | `image` with a local path, provenance and alternative text |
| Narration or short clip | Native player, transcript, video captions | `audio` (WAV/MP3) or `video` (MP4/WebM) |
| Optional generation through the harness | Inspectable prompt and local download | `protocol_md`, `format: "studium-media-prompt"` |
| Other domain | Existing specialised lesson renderer or passive figure + explanation | Canonical `RenderAsset`; use a passive figure for other kinds |

The historical `mol_3d` kind also accepts SMILES; a SMILES support is rendered in
**2D**, with no inferred 3D geometry. The VS Code artifact pane already supports
additional scene-specific renderers such as spectra, Vega plots and 3D structures;
these have not all been ported into the portable activity viewer.

The supports manifest is an object with `render_assets`, using the existing
[RenderAsset contract](../../packages/lesson-bundle-schema/src/render-asset.ts).
Every support should explain its scope and name its source in `provenance`.
Prefer one or two useful supports to a gallery. Explanatory supports are collapsed
and offered after the learner's prediction. Source photographs and non-answer
introductions can set `meta.placement: "before_prediction"` so they are available
for the initial observation. They are learning material, not evidence that
a scientific computation or learner assessment took place.

The preparation command bundles local assets into the generated HTML. Installed
renderer libraries run locally, with no CDN fetch or model call. Renderer source
and fonts add several megabytes when rich supports are included; text-only
activities remain lightweight. Reuse the prepared file rather than rebuilding or
generating an image on each interaction. Mathematical syntax errors and unsupported
representations retain source text instead of invented graphics. Preparation accepts
only the supported input profiles above and rejects other kinds explicitly.

See [sourced and generated media](sourced-and-generated-media.md) for rights,
accessible audio/video, teacher preparation and checked attachment of a file
generated through the learner's harness.

## Optional AI image

The student can ask their harness for a graphical explanation if it has an image
tool. Prefer an existing figure, local Mermaid or a calculated plot first. Explain
that image generation may take time and may use a limited/paid allowance; use the
student's available route and request, without silently switching providers.

Attach the resulting file as `image`, keep source/prompt/model/tool details in the
existing exploration receipt, and explicitly mark `meta.origin: "generated"`.
The viewer displays a short “AI-generated; may contain inaccuracies” notice.
Keep the caption, original source and textual explanation outside the pixels.
Verify scientific symbols, atom/bond identity, numbers and causal arrows; a generated
image must not serve as a measured plot, molecular structure or source figure.
There is no automatic image generation or background billable call in these viewers.

Renderer documentation: [KaTeX options](https://katex.org/docs/options),
[Mermaid configuration and security](https://mermaid.js.org/config/usage.html),
[SmilesDrawer](https://github.com/reymond-group/smilesDrawer).
