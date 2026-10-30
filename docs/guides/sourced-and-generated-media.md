# Photographs, audio and video in Studium

Studium activities can carry primary photographs, explanatory images and short
audio/video supports. Teachers can prepare reusable media before a course; a
learner can ask their connected harness for a new support during a session.
The learning objective, source attribution and learner's own answer stay separate
from the media. No image, audio or video model is required to complete an activity.

## Choose the role before the format

| Role | Example | Placement |
| --- | --- | --- |
| Primary observation | Photograph of an archaeological object | `before_prediction` |
| Orientation | Short introduction without the answer | `before_prediction` |
| Explanation | Concept map, annotated diagram, narrated analogy | `after_prediction` (default) |
| Feedback | Explanation of a specific submitted response | After that response; use only learner-approved context |

A photograph, an annotation of it and a generated reconstruction are different
objects. A reconstruction must not masquerade as documentary evidence. Never use
an image model to supply missing measurements, exact chemical bonds or unseen
archaeological details as facts. Keep the original image and identify alterations.

The [archaeology example](../../examples/archaeology/README.md) uses a museum
photograph of *Hippopotamus ("William")*. Its photograph is visible before the
prediction; candidate claims and feedback appear afterwards. Material and dating
are attributed to the museum catalogue, not inferred from the pixels.

## Teacher preparation

1. Select the source, teaching purpose and a useful alternative description.
   Inspect the actual image or play the complete clip. A search thumbnail or an
   AI interpretation is not a source-quality check.
2. Record creator, original object/page/panel, source URL, license or reuse status,
   date checked, intended scope and modifications. Prefer original institutional
   collections and explicit reuse licenses. Keep unknown rights visibly unknown.
3. Prepare a `render_assets` sidecar. Images use `kind: "image"`; local WAV/MP3
   use `audio`, MP4/WebM use `video`. Each has `path`, `provenance` and `meta.alt`.
   Set `meta.origin` to `source` or `generated`. Put authored rights in
   `meta.rights: {creator, license, evidence_url, scope, adaptations}`; scope is
   `private`, `course` or `public`. Audio/video require these rights fields.
   Record the date checked, original page/panel and source URL in `provenance`;
   these are not additional top-level fields accepted by the attachment CLI.
4. Audio/video also require `meta.transcript`. Video requires a local WebVTT
   `meta.captions_path` and `meta.captions_language`. Put important visual meaning
   in the transcript or an audio description; subtitles alone do not describe it.
5. Set `meta.placement: "before_prediction"` only for material the learner needs
   before answering. Otherwise leave the default or choose `after_prediction`.
6. Build using the existing activity command and `--supports SIDECAR.json`.
   Review the resulting activity before offering it to students.

All supplied media paths must stay under the sidecar directory. The preparer
embeds local files in the portable HTML. It checks supported container signatures,
metadata and size limits; that does not certify scientific truth, rights clearance
or codec compatibility. Test the final file in the browsers students will use.
Images are limited to 5 MiB each; audio/video to 20 MiB each and 30 MiB together.
Long lectures and high-resolution video need a different delivery path.

## Learner request through the harness

Use the `studium-visual-support` skill. Start with a source-backed text explanation
or local Mermaid figure when sufficient. For optional generation:

```sh
# ACTIVITY is an existing prepared activity directory.
.venv/bin/python tools/media_workflow.py prepare \
  --activity ACTIVITY --brief examples/media/teacher-brief.json \
  --out ACTIVITY/media-request.json
```

Adapt the example brief to the actual public sources, language, question,
preferred format and explicitly stated access needs. It is an authoring example,
not a verified archaeological source. The prepared request is a canonical
`protocol_md` RenderAsset, bound to the activity identity and digest. It contains
the prompt and expected output, a textual fallback and source references.
It does not read private learner files or call a model.
Preparation also writes the standalone `.txt` instructions beside the request,
using the brief's `download_filename`; existing files are never overwritten.

The harness reads that request, checks which generation tools are actually
available and explains likely delay or allowance use. The learner can keep the
text fallback. If generation is requested, pass only necessary context and the
selected source files through the available tool. Keep the actual model/tool,
prompt, date and output in the existing exploration receipt; do not claim a model
was used merely because the request names it. Review the returned content.

```sh
.venv/bin/python tools/media_workflow.py attach \
  --request ACTIVITY/media-request.json --media RETURNED_FILE.png \
  --source-metadata SOURCE_METADATA.json --out ENRICHED_ACTIVITY
# For audio/video, also supply --transcript TRANSCRIPT.txt;
# for video add --captions CAPTIONS.vtt.
```

Attachment validates the binding and media, then renders a **new directory** with
the same scientific activity identity and separate presentation provenance. It
records the parent, request and media hashes and retains an attachment history
when more than one support is added. The original activity and learner
files remain intact; private files are not copied into the new artifact. The
harness can perform this attachment after obtaining a file. An already open
browser session is not hot-reloaded or migrated: finish/export its trace before
opening the enriched artifact for a new run.

Prompt cards offer a local instructions download. This is a handoff to the harness,
not a universal browser button that invokes any provider. Studium has no paid
generation adapter or background generation loop in this implementation.

## Accessibility and pacing

Players have native controls, no autoplay and no automatic media preloading.
Transcripts and video captions are retained alongside the original clip. Generated
media carries a visible notice that it may contain inaccuracies. Offer a still
image/text version and keep essential instructions outside the media.

Ask about preferred representation, language, pace or stated needs. Do not infer
a disability, reading level or stable learner trait from one error. Avoid flashing
effects and unnecessary background music. Captions, transcripts and native controls
help, but do not establish accessibility conformance; review with actual users and
the [W3C media accessibility guidance](https://www.w3.org/WAI/media/av/).

## Rights and private use

Rights fields are an inspectable author record, not a legal certification.
The [Met Open Access policy](https://www.metmuseum.org/hubs/open-access) offers
eligible images under CC0; verify the individual object's public-domain flag.
Other museum websites and article figures can have different conditions.

Private use is not a blanket exemption. In France, the private-copy exception
depends in particular on a lawful source and strictly private, non-collective use;
course distribution is a different scope. See
[Code de la propriété intellectuelle, L122-5](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048603495/2026-04-11).
An unresolved local source can retain `license: "unknown"` and `scope: "private"`.
That label records uncertainty; it does not authorize publishing the source or
uploading it to a model provider. Reassess reuse and provider terms before sharing.

## Current provider options — checked 12 September 2026

These are optional harness routes, not installed Studium dependencies or promises
of account access. Subscription access and API billing may differ.

| Need | Documented option | Practical use |
| --- | --- | --- |
| Narrated explanation | OpenAI `gpt-4o-mini-tts` | Short reviewed script; explicit synthetic-voice disclosure |
| Controlled speech | Google `gemini-3.1-flash-tts-preview` | Reviewed script and vocal instructions; preview availability |
| Short generated video | Google's video API, including Veo 3.1 | Brief storyboard, reference imagery, captions/transcript; check current model and account support |

Official references: [OpenAI speech generation](https://developers.openai.com/api/docs/guides/text-to-speech),
[Google speech generation](https://ai.google.dev/gemini-api/docs/speech-generation),
[Google video generation](https://ai.google.dev/gemini-api/docs/video) and
[Veo 3.1](https://ai.google.dev/gemini-api/docs/veo).
Google's video index currently recommends Gemini Omni Flash for new video work;
Veo has its own documented controls. Resolve the current endpoint from those docs
when invoking the tool rather than hard-coding a transient model in a course.

OpenAI's Sora video endpoint is deprecated with shutdown announced for
24 September 2026 in the [official API reference](https://developers.openai.com/api/reference/typescript/resources/videos/methods/create).
Do not build a new Studium video integration around that endpoint.

Prefer teacher generation once and reuse across a course. Learner generation
should be an explicit, occasional aid: a short clip for a specific obstacle,
not a new paid output for every interaction. Provider-independent requests and
local attachment keep the teaching material usable when models change.

## Reproduce the browser media check

This creates a real museum-photo activity plus synthetic two-second tone/colour
fixtures. It tests playback, captions, placement, prompt download and layout;
it does not generate an AI clip or evaluate learning or accessibility outcomes.

```sh
# ffmpeg and the repository's existing Playwright/Chrome setup are required.
pnpm --filter @studium/activity-presentation build
.venv/bin/python tools/prepare_media_audit.py --out .studium-session/media-check
node tools/audit-media-presentation.mjs \
  .studium-session/media-check/activity .studium-session/media-check/audit
```

Use a fresh output directory for each run. The generated `report.json` names each
check; screenshots and the downloaded text prompt are retained beside it.
