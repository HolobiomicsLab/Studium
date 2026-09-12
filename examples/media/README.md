# Provider-neutral media handoff

`teacher-brief.json` separates a human-written teaching request from any provider.
Its `source_refs` distinguish primary evidence from reconstruction constraints, and
its two filenames distinguish the downloaded text prompt from the expected media
output. The downloaded prompt is self-contained: it includes the target language,
output contract, accessibility requirements, source references, fallback, and the
boundary between observed evidence and generated reconstruction. Preparing the
request makes no model or network call:

```sh
.venv/bin/python tools/media_workflow.py prepare \
  --activity /path/to/prepared-activity \
  --brief examples/media/teacher-brief.json \
  --out /path/to/prepared-activity/media-request.json
```

Use an available generation tool when the teacher or learner requests it with its
cost and latency understood, or supply an existing local file. Attach the actual local output
with an authored source and rights claim:

```sh
.venv/bin/python tools/media_workflow.py attach \
  --request /path/to/prepared-activity/media-request.json \
  --media /path/to/output.png \
  --source-metadata examples/media/source-metadata.json \
  --out /path/to/new-enriched-activity
```

Audio additionally requires `--transcript`; video requires both `--transcript` and
WebVTT `--captions`. The attachment tool checks bytes through the shared RenderAsset
support validator, rebuilds the portable viewer, and records parent, request, media,
presentation, and viewer hashes. Rights fields remain authored claims. An unknown
claim stays private, and a source URL alone is never treated as evidence of trust or
permission. `placement` controls where the resulting media appears. The passive
prompt asset itself stays after the prediction because it is workflow guidance.

The example points to the Met's Hippopotamus ("William") record, also used by the
[photograph activity](../archaeology/README.md). Adapt the prompt and selected
references to your actual activity. The preparation tool does not read the linked
page or infer source trust from its URL. Inspect the source and resulting media.
Update `source-metadata.json` with the actual creator, tool, review state and rights;
its supplied values are a draft example, not evidence that generation occurred.

Preparation writes a sibling text prompt. Attachment includes the inspectable prompt
card and retains previous requests/rights in a bounded provenance history. Repeated
attachments share the same cumulative asset and media budgets. The tiny PNG is a
technical test fixture, not a generated educational illustration.
