# Exploration information flow

Public scene and assets → operatorContext() → identical MCP/task.md context.
The additive exploration guidance names a workflow and local record tool; it
does not enumerate available tools, grant permission or change lesson state.

Captured context → prepare_exploration → context.json, empty experiment.json,
Pydantic JSON Schema and separately versioned prompts/exploration_task.md.
Question, hypothesis and learner observation are never populated by the utility.

Harness-owned retrieval/skills/provisioning/execution → explicit source snapshots,
named files, reported actions/checks and optional learner-requested observation.
No provider call, environment read, web request or subprocess exists in the tool.

Experiment → Pydantic strict field validation → session/scene/context hash binding,
reference/role/claim consistency checks → named local-file capture → new receipt.
The full public context preserves concept/objective links even when empty. No
private bundle lookup supplies omitted context. File paths must be relative and
normalized, without symlink components or conventional credential directories.

Portable receipt → hash/size/document validation → integrity report, optional
comparison to freshly supplied public context. No remote authority is consulted;
all hashes are self-contained, so coherent fabrication is outside this guarantee.
The source title/locator are captured claims, not verified attribution.

Learner response and capsule run submissions continue exclusively through their
existing protocols. The receipt does not change mastery, trust calibration,
publication, consent or teacher approval. Local observation retention is optional
and independent of the telemetry deletion lifecycle.

Explicit teacher attachment through `experience_approval.py attach-exploration`
verifies the portable receipt, checks the scene exists in the review package and
stores a technical summary in `exploration-summaries.json`. MySTRA shows source,
artifact hash and operator-reported check references. Structured learner fields,
session IDs and material contents are not copied. This is verification at attachment,
not independent execution attestation; keep the original receipt for re-verification.
Adding the summary changes the approval inputs and requires renewed review.

The separate learner `studium/experiment-journal/v1` records reasoning contributions
through MCP/files. It is not an exploration receipt and never feeds this teacher view.
