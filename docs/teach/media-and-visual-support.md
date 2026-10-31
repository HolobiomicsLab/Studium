English · [Français](media-and-visual-support.fr.md)

# Media and visual support

You can give a lesson the figures, equations, concept maps, photographs and short audio or video
clips that help students reason, each with its source and rights recorded. You prepare reusable
media once; a student can also ask their assistant for a new support during a session. The
learning objective, the attribution and the student's own answer always stay separate from the
media, and no image, audio or video model is needed to complete an activity.

The `studium-visual-support` skill guides an assistant through this work
(see [skills](../start/skills.md)). Language options and scientific notation for students are in
[language and supports](../learn/language-and-supports.md).

## What works today

| Need | Status |
|---|---|
| Figures, SVG, equations, plots, tables, spectra, 3D molecules, audio, video | The lesson asset contract (`render_assets`); the VS Code pane renders the widest set, other surfaces fewer: test the one you use |
| A local figure in a lesson folder | Resolved from the lesson folder; a file outside it, even through a symlink, is refused: copy it into `assets/` |
| Mermaid diagrams | Rendered locally in activity templates (`--supports`); shown as source text in MySTRA |
| A new image during a session | Only if the student's assistant actually has an image tool |
| Supports generated from a student's history | Not implemented; the public scene context excludes that history |

## Three kinds of figure

**Source figure.** Keep the file, its caption, the DOI or capsule id, page and panel, and any crop.
Record provenance and reuse status before distributing a copy. A multimodal reading of a figure is
an interpretation to check.

**Computed plot.** Draw it from the data actually used, with script, parameters, units and checks.
Use a plotting tool or a `plot_spec` when exact values matter. Keep failures and null results.

**Generated explanatory support.** A concept map, a visual analogy or a schematic abstract can
summarise a difficulty. Label it as generated and keep the original source separately: generated
pixels are not a measurement, a validation or a capsule result.

[`examples/visual-support/figure-asset.json`](../../examples/visual-support/figure-asset.json) shows
an `image` asset to place in `scene.render_assets`, with the real file in the lesson's `assets/`.
[`examples/visual-support/concept-map.mmd`](../../examples/visual-support/concept-map.mmd) is a
Mermaid concept map; its text doubles as the accessible alternative. Where no Mermaid renderer is
available, ship a passive PNG rendered from it and keep the `.mmd` next to it.

## Differentiate without labelling students

Use two independent axes: familiarity with the domain and familiarity with the method or tool. A
short brief in the student's own words is often enough: "I know spectra, I am new to molecular
networks, I confuse similarity and identity." If the assistant only supposes a difficulty, it
presents it as a hypothesis and checks with a short question.

| Situation | Possible support | Next check |
|---|---|---|
| Axes or units misread | Original figure with text landmarks and a simple example | Read another point or panel |
| Similarity confused with identity | Relation map and a sourced counter-example | Say what the score does not prove |
| Method hard to follow | Diagram of inputs, operations and outputs | Locate where an assumption enters |
| High familiarity | Compact view, assumptions and limit cases | A new variation chosen by the student |

A preferred format is not a fixed "learning style", and errors must not become a medical or
psychological profile. Never change the grading silently.

## Prepare media for a course

Choose the role before the format:

| Role | Example | Placement |
|---|---|---|
| Primary observation | Photograph of an archaeological object | `before_prediction` |
| Orientation | Short introduction without the answer | `before_prediction` |
| Explanation | Concept map, annotated diagram, narrated analogy | `after_prediction` (default) |

A photograph, an annotation of it and a generated reconstruction are different objects; a
reconstruction must never pass as documentary evidence.

1. Select the source and purpose, inspect the actual image or play the whole clip, and write a
   useful text alternative.
2. Write a supports file: `kind` (`image`, `audio` for WAV or MP3, `video` for MP4 or WebM), `path`,
   `provenance`, `meta.alt` and `meta.placement`; `meta.origin` is `source` or `generated`.
3. For audio and video, add `meta.rights` (`creator`, `license`, `evidence_url`, `scope` = `private`,
   `course` or `public`) and `meta.transcript`; video also needs a WebVTT `meta.captions_path` and
   `meta.captions_language`.
4. Build the activity with `--supports SUPPORTS.json` (see [activity templates](activity-templates.md))
   and review the result before class.

Media paths must stay under the supports file's folder. Limits: 5 MiB per image, 20 MiB per audio or
video file and 30 MiB in total. The checks cover file signatures, metadata and size, not scientific
truth, rights clearance or codec support. The
[archaeology example](../../examples/archaeology/README.md) shows a museum photograph placed before
the prediction.

## A student asks for a new support

```bash
.venv/bin/python tools/media_workflow.py prepare \
  --activity ACTIVITY --brief examples/media/teacher-brief.json --out ACTIVITY/media-request.json
```

The request is provider-neutral: a prompt, the expected output, a text fallback and source
references, bound to the activity's identity and digest, plus a `.txt` copy for download. It reads no
private learner file and calls no model. The assistant checks which generation tools it really has,
passes only the necessary context, never private history or answer keys, and records the actual tool
and prompt in the exploration receipt. After reviewing the output:

```bash
.venv/bin/python tools/media_workflow.py attach --request ACTIVITY/media-request.json \
  --media RETURNED_FILE.png --source-metadata SOURCE_METADATA.json --out ENRICHED_ACTIVITY
```

Add `--transcript` for audio or video and `--captions` for video. Attachment writes a new folder with
the same activity identity and records parent, request and media hashes; the original activity and
learner files are untouched. An open browser session is not reloaded: export its trace first.

## Accessibility and rights

Players have native controls, no autoplay and no preloading; generated media carries a visible notice
that it may be inaccurate. Offer a still image or text version and keep essential instructions outside
the media. Do not infer a disability or a stable trait from one error. Captions and transcripts help,
but do not establish conformance: review with real users and the
[W3C media accessibility guidance](https://www.w3.org/WAI/media/av/).

Rights fields are an inspectable record, not a legal certification. Private use is not a blanket
exemption: in France, the private-copy exception depends in particular on a lawful source and
strictly private use, and course distribution is a different scope
([Code de la propriété intellectuelle, L122-5](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048603495/2026-04-11)). A source with `license: "unknown"` and
`scope: "private"` records uncertainty; it does not authorise publishing it or sending it to a model
provider.

## Check media in the browser

```bash
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/prepare_media_audit.py --out .studium-session/media-check
node tools/audit-media-presentation.mjs .studium-session/media-check/activity .studium-session/media-check/audit
```

This needs ffmpeg and Playwright with Chrome. It builds a museum-photo activity and short synthetic
clips, then checks playback, captions, placement, prompt download and layout in `report.json`. It does
not generate an AI clip or evaluate learning. Use a fresh output folder each run.

Code: [`tools/activity_support.py`](../../tools/activity_support.py),
[`tools/media_workflow.py`](../../tools/media_workflow.py).
