English · [Français](activity-templates.fr.md)

# Activity templates

Five ready starters turn the current scene of a lesson into an interactive activity your students
open in a browser: a self-contained page, the instructions for their assistant and the format of
the action trace they may export. You adapt the data, units, sources and criteria in a small
configuration file. Preparing an activity runs no retrieved code, installs nothing, approves no
lesson and submits no answer.

| Template | The learner |
|---|---|
| `linked-representations` | Follows stable identifiers across an edge table, a peak plot and a candidate table |
| `parameter-comparison` | Holds an input fixed, varies one parameter and compares baseline and variation |
| `evidence-claim` | Reads a supplied source statement and picks the narrowest supported claim |
| `diagnose-analysis` | Inspects analysis steps, picks a suspected flaw and compares supplied repairs |
| `conclusion-robustness` | Compares assumption scenarios against an explicit decision threshold |

The `studium-activity-templates` skill lets your assistant do these steps for you
(see [skills](../start/skills.md)). A full walk-through is in the
[activity to report tutorial](../tutorials/activity-to-report.md).

## Prepare an activity

```bash
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py prepare \
  --template linked-representations --context operator-context.json --out activity-linked
```

`--context` is the public scene context, the JSON your assistant gets from the
`get_operator_context` MCP tool (or from `task.md` in the file channel). `--out` must not exist.
`list --json` prints the full catalogue; an entry marked proposed is not runnable.

| Option | Use |
|---|---|
| `--config FILE.json` | Adapt the template; examples in `examples/activity-templates/<template>/config.json` |
| `--language`, `--translations` | Presentation language and translation dictionaries |
| `--supports FILE.json` | Figures, equations, chemistry, media (see [media and visual support](media-and-visual-support.md)) |

A configuration is closed: unknown fields, non-finite numbers, duplicate identifiers, mismatched
template ids and incomplete sources are refused before anything is written. Slider baselines and
variations must sit on the declared step grid. The parameter, evidence, diagnosis and robustness
templates take either synthetic data (`data_status: "synthetic teaching fixture"`,
`source_kind: "synthetic_fixture"`) or supplied evidence (`"supplied source-backed data"`,
`"supplied_evidence"`). The linked-spectrum starter stays synthetic: it reuses a checked example
core and refuses a network whose numbers differ from its oracle.

The output directory holds:

| File | Content |
|---|---|
| `activity.json` | The validated definition and its scene binding |
| `index.html` | The self-contained local page |
| `task.md` | Editable instructions for the assistant, with the exact report commands |
| `learner-actions.schema.json` | The schema of the exported trace |
| `provenance.json` | Input and generator hashes, and the stated validation limits |

## What the student sees and keeps

The page first asks whether to keep an in-memory trace. Without a trace the activity still works,
and nothing is reconstructed later. With a trace, **Export activity trace** can download a partial
trace before results are revealed; **Complete and export final trace** adds the completion event and
locks the controls. The export carries the SHA-256 of `activity.json`, so a later definition with the
same identifiers cannot reinterpret the events.

```bash
.venv/bin/python tools/learner_trace.py validate LEARNER_ACTIONS.json
.venv/bin/python tools/learner_report.py export REPORT_DIR \
  --actions LEARNER_ACTIONS.json --activity activity-linked/activity.json
.venv/bin/python tools/learner_report.py verify REPORT_DIR
```

The page has no network sink and no automatic storage, holds no learner identity or answer key, and
keeps the learner's optional text only in an explicit download. The report is described in
[learner report](../learn/learner-report.md).

## Diagnose an analysis

In [the diagnosis config](../../examples/activity-templates/diagnose-analysis/config.json), `steps`
have an `id`, `label` and `description`; `repairs` have an `id`, `label`, `explanation` and a numeric
`result`. Set `flawed_result`, `result_unit`, `supported_repair_id` and `oracle.repaired_result`,
which must equal the result of the referenced repair. That is a consistency check, not a scientific
verification. Selections are recorded as `step_<id>` and `repair_<id>`; the selected step is not
graded automatically.

## Test conclusion robustness

In [the robustness config](../../examples/activity-templates/conclusion-robustness/config.json),
each `scenario` has an `id`, `label`, explicit `assumption` and numeric `value`. Set
`baseline_scenario_id`, `metric.label`, `metric.unit` and a `decision` with `operator` (`gte` or
`lte`), `threshold` and a bounded `claim`. `oracle.supporting_scenario_ids` must agree with the
values, in order, including equality at the threshold. A selection is recorded as `scenario_<id>`.

Identifiers, with their prefixes, are limited to 120 characters. The templates compare captured
results; no equation or code is evaluated. Run real analyses with your assistant, keep their
provenance, then regenerate the activity from those outputs.

## Across disciplines

The diagnosis pattern fits a wrong denominator in ecology, a unit conversion in astronomy, an
omitted blank correction in chemistry or an aggregation error in survey analysis. The robustness
pattern fits alternative background estimates, missing-data assumptions or calibration choices.
Keep domain terms and values in the config files, with units and source locators.

## Limits

- Three supplied scenarios do not estimate a probability of truth, and a threshold crossing does not
  establish causation.
- The checks shown after reveal are instructions unless a separate workflow records that they ran.
- Neither the page nor its report measures learning or approves anything for students: review the
  objective and interpretation of source-backed content before class.

Code: [`tools/experience_templates.py`](../../tools/experience_templates.py).
