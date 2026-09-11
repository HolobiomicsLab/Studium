# Harness activity templates

Studium includes three ready local activity starters and two proposals. The ready
templates turn a checked studium/operator-context/v1 scene into an editable
harness task, a self-contained browser page and the JSON Schema used by learner
action exports. Preparation does not execute retrieved code, install a library,
approve a lesson or submit a response.

| Template | State | Learner action |
| --- | --- | --- |
| linked-representations | Ready | Follow stable IDs across a thresholded edge table, a real peak plot and a candidate table. |
| parameter-comparison | Ready | Hold a synthetic input fixed, vary one gain and compare computed baseline and variation outputs. |
| evidence-claim | Ready | Read a supplied source statement and select the narrowest supported claim. |
| diagnose-analysis | Proposed | Diagnose a consequential flaw and connect it to a detecting check. |
| conclusion-robustness | Proposed | Vary defensible assumptions and locate where a conclusion changes. |

The proposals have no sample config and the prepare command refuses them. Their
catalogue entries describe possible later work without presenting an unbuilt
activity as runnable.

List the complete catalogue:

~~~sh
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py list --json
~~~

Prepare a ready starter from a fresh public scene context into a directory that
does not already exist:

~~~sh
.venv/bin/python tools/experience_templates.py prepare \
  --template linked-representations \
  --context operator-context.json \
  --out activity-linked
~~~

Replace the template ID with parameter-comparison or evidence-claim for the
other starters. Add --config PUBLIC-CONFIG.json to adapt a ready template. A
config is closed: unknown fields, non-finite numbers, duplicate IDs, mismatched
template IDs and incomplete sources are rejected before the output directory is
created.

The parameter and evidence templates accept either:

- data_status "synthetic teaching fixture" with source_kind "synthetic_fixture"; or
- data_status "supplied source-backed data" with source_kind "supplied_evidence".

The linked-spectrum starter remains synthetic because it reuses the existing
checked examples/literature-experience/linked-viewer-core.mjs, whose input
contract requires that label. Preparation runs that core against the baseline
and variation and refuses a network whose numerical oracle differs. It does not
turn the teaching fixture into a measured paper result.

Each prepared directory contains:

- activity.json, the validated definition and scene binding;
- index.html, the self-contained local viewer;
- task.md, the editable harness instructions and exact report commands;
- learner-actions.schema.json, generated from the shared runtime model; and
- provenance.json, input and generator hashes plus explicit validation limits.

The page first asks whether to enable an in-memory local trace. Choosing no trace
keeps the activity usable and cannot be changed later without reloading; events
are never reconstructed. With tracing enabled, Export activity trace can download
a legitimate partial trace before results are revealed. Complete and export final
trace adds the single final completion event and locks further controls and
logging.

The browser export includes the SHA-256 digest of the complete validated
activity.json. This prevents a later activity definition with the same IDs from
silently reinterpreting parameter or choice events. Validate or report a download:

~~~sh
.venv/bin/python tools/learner_trace.py validate LEARNER_ACTIONS.json
.venv/bin/python tools/learner_report.py export REPORT_DIR \
  --actions LEARNER_ACTIONS.json \
  --activity activity-linked/activity.json
.venv/bin/python tools/learner_report.py verify REPORT_DIR
~~~

The expected checks shown after reveal remain instructions unless a separate
workflow records that they actually ran. The page has no network sink or automatic
persistence, includes no learner identity or private lesson answer key, and preserves optional
learner text exactly only in an explicit download. Consent to a local export does
not imply consent to share it. Neither the viewer nor its report measures learning
or grants teacher approval for student release.
