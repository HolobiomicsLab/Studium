---
name: studium-visual-support
description: Help a Studium learner inspect source photographs or request an adapted image, Mermaid map, audio explanation or short video through their existing harness. Use for source-grounded media support and stated access needs; use studium-harness for lesson responses and grading.
---

# Studium visual support

Resolve this skill's real directory; the Studium checkout is two levels above.
Read [Media and visual support](../../docs/teach/media-and-visual-support.md) for
current capabilities, example assets and the source-to-receipt workflow, and
[Language and supports](../../docs/learn/language-and-supports.md) for what the
learner can ask for. This skill uses the tools actually available in the chosen
harness; it does not install a model, create an image tool, or attach generated
assets to a live lesson automatically. The media workflow provides a checked local
attachment into a new portable activity, not a live session replacement or a
universal provider bridge. For portable activities, use the checked `--supports`
option of `tools/experience_templates.py prepare`.

## Start from the learner and the scene

Use [studium-harness](../studium-harness/SKILL.md) to obtain the current public
operator context, and keep its scene, objective and response contract. The public
context deliberately excludes private learner history and answer keys. Do not
read a raw bundle or private history to bypass that boundary.

Use already stated familiarity, preferred language and current question. Follow
`language.effective_language` from `get_operator_context` for explanations and captions.
A changed language never rewrites learner answers, source material, notation,
quantities, code or identifiers; translations of quotations stay labelled. If one
missing fact would change the support, ask one short question, such as whether
the difficulty is the axes, the method or the conclusion. Unknown familiarity
stays unknown. A degree, role or one wrong answer does not establish mastery.

Reflect a compact working brief: concept, stated familiarity, current obstacle,
time available if given, requested format. Let the learner correct it. Keep it
in the current session unless they request a private saved note; do not write
named learner profiles into shared skills or Git. An observed error is a specific
response in context, not a fixed learner trait or a diagnostic label.

## Select the support

Prefer the smallest useful representation:

- Original paper/ASB figure: inspect the actual file and caption, identify page or
  panel, explain axes and uncertainty. Preserve the original; mark crops/overlays.
- Measured comparison: use actual data and a deterministic plotting tool. Keep
  axes, units, stable IDs, baseline and errors; never estimate exact data from a
  generated illustration.
- Concept map or process: author inspectable Mermaid source with a textual
  equivalent. Portable activities render Mermaid locally from a `code` asset with
  `language: "mermaid"`; retain the source and accessible `meta.alt`. Native
  reports still show Mermaid source. If no renderer is available, keep source/text.
- Equations and structures: use KaTeX for explicit mathematical notation and
  a real chemistry renderer for SMILES or structure files. A 2D depiction is not
  a 3D conformer. Do not ask an image model to invent exact molecular connectivity.
- Graphical abstract or analogy: use the harness's image-generation capability
  only when it is available, requested and useful. Explain possible delay and
  allowance/cost before generation, reuse an existing support, and keep a local
  diagram or text fallback. Never generate on every slider movement. Provide selected sources, the current
  learning question and a short de-identified support brief. Describe the result
  as generated explanatory material, not a source figure or executed result.
  Set image `meta.origin` to `generated`; keep the standard possible-inaccuracy
  notice visible and include provenance and `meta.alt`.

Keep exact source/caption attribution in text outside generated image pixels.
Check symbols, numbers, arrows and implied causal relationships against the
sources. A multimodal model's interpretation is not independent verification.
If generation fails, keep the original/source explanation; don't claim an image
was made. Don't silently switch to a paid API or another account.

## Preserve the pedagogical boundary

Source photographs and non-answer orientation can use
`meta.placement: "before_prediction"`. The learner must see the primary material
they are asked to observe. Keep annotation and generated reconstruction distinct
from that original; explanatory supports default to `after_prediction`.

If the requested support would reveal the answer or measured result, first collect
the learner's own prediction using the current lesson workflow. Before that,
explain notation or show a separate non-answer example. Never populate their
prediction, confidence, observation or conclusion.

Offer one support, then ask the learner to interpret it or try a related case.
Fade detail when they request it or demonstrate understanding. Keep criteria and
objectives fixed. New scientific claims, exercises or alternate lessons are
teacher-review drafts under the existing release workflow.

## Keep a reusable record

For a requested media generation, use `tools/media_workflow.py prepare --activity
ACTIVITY --brief BRIEF.json --out ACTIVITY/media-request.json` with the existing public activity and
an adapted teacher brief. Inspect the bound canonical
`protocol_md` request. Confirm the connected tool is available and its allowance
before invoking the requested generation; use only necessary public/de-identified
context. Never invent a provider result or silently use another paid route.
Record the actual prompt/tool/model/date with the existing exploration receipt.

Inspect/play the returned local file, then use `tools/media_workflow.py attach
--request ACTIVITY/media-request.json --media FILE --source-metadata META.json
[--transcript FILE] [--captions FILE.vtt] --out NEW_ACTIVITY` with authored source/rights metadata. Audio requires a transcript; video also
requires WebVTT captions. Describe meaningful visual information, not just speech.
The attachment creates a new directory and preserves the original activity and
student files. Export any active browser trace before opening a new run; do not
claim seamless in-place migration. Unknown rights stay private and unresolved;
local use does not itself authorize redistribution or provider uploads.

Prefer an existing source or teacher-generated reusable support to repeated
generation. Keep a text fallback, native playback controls and the generated
notice. Do not infer disability or diagnose needs from learner errors. Check
current official provider documentation before selecting a route; model names in
the guide are dated observations, not installed capabilities.

Use existing `RenderAsset` kinds for a reviewed lesson asset: `image` for a passive
PNG, `svg` only when trusted/sanitized, `plot_spec` for supported declarative plots.
Do not invent a new graphical-abstract or mindmap schema. Do not label generated
illustration `executed_result`.

Record selected sources, caption, page/panel/crop and reuse status with the files.
Use the existing exploration receipt described in the guide for generator inputs,
model/tool actually used, output, source diagram/code, environment and checks.
No raw student history or authentication in prompts/logs. Keep generated support
and its authorship separate from learner actions; a viewer navigation event is
not proof of understanding. MySTRA currently carries a linked technical summary,
not automatic figure embedding or a private learner profile.
