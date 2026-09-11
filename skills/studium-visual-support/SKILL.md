---
name: studium-visual-support
description: Help a Studium learner understand a source figure or request an adapted visual explanation, graphical abstract or Mermaid concept map through their existing harness. Use for source-grounded visual support and learner-stated familiarity; use studium-harness for lesson responses and grading.
---

# Studium visual support

Resolve this skill's real directory; the Studium checkout is two levels above.
Read [the practical guide](../../docs/guides/adaptive-visual-support.md) for current
capabilities, example assets and the source-to-receipt workflow. This skill uses
the tools actually available in the chosen harness; it does not install a model,
create an image tool, or attach generated assets to a live lesson automatically.

## Start from the learner and the scene

Use [studium-harness](../studium-harness/SKILL.md) to obtain the current public
operator context, and keep its scene, objective and response contract. The public
context deliberately excludes private learner history and answer keys. Do not
read a raw bundle or private history to bypass that boundary.

Use already stated familiarity, preferred language and current question. If one
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
  equivalent. Render outside the learner viewer using an available renderer;
  retain the source. If unavailable, supply source/text honestly. Studium's native
  reports currently show Mermaid source, not a rendered mindmap.
- Graphical abstract or analogy: use the harness's image-generation capability
  only when it is available and useful. Provide selected sources, the current
  learning question and a short de-identified support brief. Describe the result
  as generated explanatory material, not a source figure or executed result.

Keep exact source/caption attribution in text outside generated image pixels.
Check symbols, numbers, arrows and implied causal relationships against the
sources. A multimodal model's interpretation is not independent verification.
If generation fails, keep the original/source explanation; don't claim an image
was made. Don't silently switch to a paid API or another account.

## Preserve the pedagogical boundary

If the requested support would reveal the answer or measured result, first collect
the learner's own prediction using the current lesson workflow. Before that,
explain notation or show a separate non-answer example. Never populate their
prediction, confidence, observation or conclusion.

Offer one support, then ask the learner to interpret it or try a related case.
Fade detail when they request it or demonstrate understanding. Keep criteria and
objectives fixed. New scientific claims, exercises or alternate lessons are
teacher-review drafts under the existing release workflow.

## Keep a reusable record

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
