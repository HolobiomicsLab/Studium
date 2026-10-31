English · [Français](learner-report.fr.md)

# Learner activity report

Export what you did in a portable activity, a snapshot of your experiment journal, or both, as a local report
you can open in a browser, check and choose to share. The export checks that the records are well formed and in
order. It does not grade you, infer what you learned or validate the science.

Two record types can go in:

- **Learner actions**: a sidecar file written by a portable activity. It separates actions the browser
  observed from assistance the harness declared. A missing assistance event means coverage is unknown, not
  that no help occurred.
- **Journal snapshot**: a copy of your [experiment journal](experiment-journal.md). It is not authenticated.
  When both are selected, the activity's scene id must appear in the journal; that overlap still does not
  authenticate a learner, lesson or session, and the two clocks stay separate.

The [activity-to-report tutorial](../tutorials/activity-to-report.md) walks through a full example.

## Check the actions file

From the repository root:

```bash
.venv/bin/python tools/learner_trace.py validate path/to/learner-actions.json
.venv/bin/python tools/learner_trace.py schema --out learner-actions.schema.json
```

The JSON Schema is generated from the same model the exporter uses, so producers and the report share one
contract.

## Export

Export the actions with the exact prepared activity they came from:

```bash
.venv/bin/python tools/learner_report.py export reports/learner-report \
  --actions path/to/learner-actions.json \
  --activity path/to/prepared-activity/activity.json
```

The sidecar's `activity_sha256` must match the digest of that prepared activity, so labels, source statement,
parameters, choices and controls in the report belong to the captured definition. Without `--activity`, the
report marks the context as unavailable instead of guessing labels.

| To include | Add |
|---|---|
| A journal snapshot alongside the actions | `--journal path/to/journal.json` |
| A journal alone | `--journal` without `--actions` |
| Your original free text | `--include-original-text` |

Free text and journal evidence locators are redacted by default. Keeping your own words is an explicit local
choice. Consent to store the journal is not consent to share or publish the report. The exporter does not copy
learner-identity or private-session fields, but activity ids and source descriptions can still identify you:
read the report before sharing it. Redaction is a policy over the allowed fields, not a general
de-identification guarantee.

## Open and verify

Open `reports/learner-report/index.html`: a portable, escaped view showing the activity and the journal as
separate timelines, with links to the ASTRA, ARA, MyST and integrity files (see the
[glossary](../concepts/glossary.md) for these formats).

To view it in the MySTRA Observatory, point the course root at the report's parent folder:

```bash
.venv/bin/python services/observatory/observatory_app.py --course-root reports --port 8124
```

Then open `http://127.0.0.1:8124/courses/learner-report/mystra`. The page shows the redacted actions and
journal events. Its summary is course-oriented and shows zero scenes judged: expected, since assessment is
outside the export. More on the Observatory: [observatory](../teach/observatory.md).

Check an export before relying on it:

```bash
.venv/bin/python tools/learner_report.py verify reports/learner-report
```

Verification revalidates the selected sources and their bindings, recomputes the summary and the rendered
outputs, runs the installed `astra-tools` validator (ASTRA 0.0.14) and checks the SHA-256 hash of every
standard output and selected source. The manifest is unsigned: it detects stale, missing or accidentally
changed files, but someone who can rewrite the whole report can rewrite its hashes too.

## What the folder contains

| File | Content |
|---|---|
| `sources/learner-actions.json`, `sources/experiment-journal.json`, `sources/activity.json` | Only the selected, redacted records |
| `report.json` | The derived technical summary and its scope |
| `astra.yaml` | The ASTRA 0.0.14 artifact declaration |
| `trace/exploration_tree.yaml` | Separate, evidence-linked action journeys |
| `course_provenance.myst.md` | Output of the shared MySTRA renderer |
| `index.html` | The portable view |
| `checks.json` | Validator result and file hashes (it does not hash itself) |

The folder never contains a copy of the original raw trace. The code is in
[tools/learner_report.py](../../tools/learner_report.py) and [tools/learner_trace.py](../../tools/learner_trace.py).
