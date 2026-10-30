# Harness activity templates

Studium includes five ready local activity starters. The ready
templates turn a checked studium/operator-context/v1 scene into an editable
harness task, a self-contained browser page and the JSON Schema used by learner
action exports. Preparation does not execute retrieved code, install a library,
approve a lesson or submit a response.

| Template | State | Learner action |
| --- | --- | --- |
| linked-representations | Ready | Follow stable IDs across a thresholded edge table, a real peak plot and a candidate table. |
| parameter-comparison | Ready | Hold a synthetic input fixed, vary one gain and compare computed baseline and variation outputs. |
| evidence-claim | Ready | Read a supplied source statement and select the narrowest supported claim. |
| diagnose-analysis | Ready | Inspect analysis steps, choose a suspected flaw and compare supplied repair results. |
| conclusion-robustness | Ready | Compare supplied assumption scenarios against an explicit decision threshold. |

All five use the same preparation, recording and report contracts. A future
catalogue entry marked proposed remains non-runnable.

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

Replace the template ID with any ready entry in the table for the other starters. Add --config PUBLIC-CONFIG.json to adapt a ready template. A
config is closed: unknown fields, non-finite numbers, duplicate IDs, mismatched
template IDs and incomplete sources are rejected before the output directory is
created. Parameter baselines and variations must also lie on the declared slider
step grid; otherwise a browser would silently move them to a different value.

The parameter, evidence, diagnosis and robustness templates accept either:

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
are never reconstructed. In this mode, finish the activity without downloading
a trace; assistance notes are not claimed as recorded or cleared silently.
With tracing enabled, Export activity trace can download
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

## Diagnose an analysis

Adapt [the diagnosis config](../../examples/activity-templates/diagnose-analysis/config.json).
`steps` contain stable `id`, `label` and `description`; `repairs` contain `id`,
`label`, `explanation` and a finite numerical `result`. Set `flawed_result`,
`result_unit`, `supported_repair_id` and `oracle.repaired_result`. The oracle
must equal the supplied result of the referenced repair. This is a consistency
check, not independent scientific verification of that repair.

The learner selects a suspected step, then examines a repair and its result.
Selections use `step_<id>` and `repair_<id>` in the common action trace. There
is no automatic correctness assessment of the selected step. Describe how the
source or a separate calculation supports the repair criterion; do not encode
scientific judgments in template-specific application logic.

## Test conclusion robustness

Adapt [the robustness config](../../examples/activity-templates/conclusion-robustness/config.json).
Each `scenario` contains an `id`, `label`, explicit `assumption` and finite `value`.
Set `baseline_scenario_id`, `metric.label`, `metric.unit` and a `decision` containing
`operator` (`gte` or `lte`), finite `threshold`, and bounded `claim`.
`oracle.supporting_scenario_ids` must agree with all supplied scenario values,
in scenario order, including equality at the threshold. Both all-supporting and none-supporting
sets are valid outcomes. A scenario selection records `scenario_<id>`.

All IDs, including their trace prefixes, must fit the common 120-character
limit. Both new patterns reject unknown fields, duplicate IDs, invalid references
and non-finite numbers. They compare captured results: no arbitrary equation or
code is evaluated. Execute real analyses in the harness, record their provenance,
then regenerate the activity from those explicit outputs.

## Practice across disciplines

The same diagnosis structure can compare an incorrect denominator in ecology,
a unit conversion in astronomy, an omitted blank correction in chemistry, or an
aggregation error in survey analysis. The same robustness structure can compare
alternative background estimates, missing-data assumptions or calibration choices.
Keep domain terms and values in config files, with units and source locators.
These are adaptation patterns, not claims that one numerical criterion validates
an entire scientific conclusion.

Choose scenarios on scientific grounds. Three supplied scenarios do not estimate
a probability of truth; a threshold crossing does not establish causation.
For real source-backed content, check the source and result references and have the
teacher review the objective and interpretation before use with students.

## Visual design

Activities and portable/native reports share the [viewer charter](../design/viewer-charter.md). Completed recording and prediction steps stay available as collapsible summaries.

## Language and optional scientific supports

All five templates accept `--language`, `--translations` and `--supports`. See the
[preparation tutorial](../guides/language-and-scientific-presentation.md) for local
Mermaid, KaTeX, 2D chemistry and source/generated figures. The language selector
keeps student input intact; missing translations remain explicit.
