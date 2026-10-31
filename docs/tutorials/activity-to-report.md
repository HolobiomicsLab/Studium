English · [Français](activity-to-report.fr.md)

# From an interactive activity to an ASTRA/MySTRA report

Prepare an interactive activity with your harness, experiment with it in the browser, then let
Studium turn what you chose to keep into a local report you can check before sharing anything. The
viewer contains no agent. The five templates ship with synthetic examples; a technical example is not
a validated teaching experience.

## Prepare the activity

In a Studium session already started, ask the harness:

> Use the studium-activity-templates skill. Get the public context of my current scene, choose a
> template suited to its question and prepare it in a new folder. Show its sources and limits. Wait
> for my prediction.

The harness calls `get_operator_context` and saves the JSON reply as `context.json`. It can then run,
from the repository and its Python environment:

```bash
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py prepare \
  --template parameter-comparison --context context.json --out activity
```

`activity/task.md` guides the adaptation and `activity/index.html` is the viewer to open. The
templates `linked-representations`, `evidence-claim`, `diagnose-analysis` and
`conclusion-robustness` use the same command. The default examples are not derived from your scene's
sources: a shared identifier does not prove a scientific link. If the needed inputs are missing, the
harness must say so and present the sample as a separate illustration.

| Option | Effect |
|---|---|
| `--language fr` | Start the viewer in French (default `en`) |
| `--translations FILE` | Local translation dictionaries; untranslated content stays in its source language, flagged |
| `--supports FILE` | A local manifest of supporting media; see [Language and supports](../learn/language-and-supports.md) |
| `--config FILE` | Your own inputs, following the [template contract](../teach/activity-templates.md) |

No translation API is called. Preparing does not link new data to a publication: keep the sources,
reference values and controls actually performed. A new objective or scientific conclusion is for
the teacher to review.

## Experiment and choose what to keep

In the viewer, choose whether a local trace should be prepared for a possible export. Write your
prediction before showing the results, vary the control or choose a representation, then write your
observation and conclusion. Optional fields, confidence included, may stay empty. The path without a
trace also completes the activity, without any download.

Download the trace only if you want to. A partial export is possible and does not claim the activity
is finished. Save the chosen file as `actions.json`. The download holds what you submitted in the
viewer; the report then applies its own choice about including your texts.

If the harness also uses the private [experiment journal](../learn/experiment-journal.md), the
prediction must be recorded there before the results are revealed. A later download must not be
re-entered as a prediction the engine would have recorded earlier.

## Produce a copy to review

Ask the harness:

> Use studium-learner-report to prepare a local report from this actions.json file and the
> definition of my activity. Exclude my personal texts and show me the result before any sharing.

```bash
.venv/bin/python tools/learner_trace.py validate actions.json
.venv/bin/python tools/learner_report.py export report \
  --actions actions.json --activity activity/activity.json
.venv/bin/python tools/learner_report.py verify report
```

Open `report/index.html`. The report also holds ASTRA, the ARA trace, the MySTRA source and the
structured files that can be verified. Actions keep their declared origins and sequence; the
activity definition makes choice identifiers and parameters readable.

To include your original words on purpose, generate a new copy with `--include-original-text`. That
choice applies to this report only; it does not follow from consenting to journal storage. A journal
can also be selected with `--journal`; the browser and engine timelines stay separate, and matching
scene identifiers do not prove two files come from the same person. None of the commands above sends
the report to a teacher or an external service.

## What the teacher can examine

The question, recorded actions, parameters, evidence and any texts the student chose to include. A
missing help trace means "unknown". ASTRA checks and file fingerprints verify structure and technical
consistency, not learning nor authorship. The [learner report guide](../learn/learner-report.md)
details the limits and how to open the report in the shared MySTRA viewer.

## Two more activities to ask for

To diagnose an analysis:

> Use `diagnose-analysis` for the public steps and results of this scene. Prepare several plausible
> repairs, with their explicitly provided results and how to check them. Let me pick the suspect step
> and explain my diagnosis before discussing the repair. If a result is missing, say so; never present
> an invented value as an executed computation.

To stress-test a conclusion:

> Use `conclusion-robustness`. Compare a reference hypothesis with defensible alternatives, their
> results and an explicit criterion with units. Let me predict the consequences, then examine where
> the conclusion changes. State what remains unknown outside these scenarios.

A teacher can adapt these formats to another discipline by replacing sources, steps, hypotheses,
units and values in the configuration; the viewer code stays the same. A new scientific run is the
harness's job; the viewer then shows the captured results and traces local choices.
