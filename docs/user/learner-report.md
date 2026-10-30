# Export a learner activity technical report

Studium can export learner-selected activity actions, an experiment-journal
snapshot, or both as a local technical report. The export validates record
shape and order. It does not infer a learning outcome, validate the science, or
grade the learner.

The learner-actions sidecar distinguishes browser-observed learner actions from
harness-declared assistance. A missing assistance event means coverage is
unknown; it does not show that no help occurred. An imported host journal is an
unauthenticated snapshot. When both sources are selected, the exporter requires
the activity scene identifier to appear in the journal, but that overlap does
not authenticate a learner, bundle, or session. Their clocks remain separate.

## Validate or publish the action schema

From the repository root:

```console
.venv/bin/python tools/learner_trace.py validate /path/to/learner-actions.json
.venv/bin/python tools/learner_trace.py schema --out /tmp/learner-actions.schema.json
```

The runtime Pydantic model generates the JSON Schema, so producers and the
report exporter share one contract.

## Export

Export actions with their exact prepared activity context:

```console
.venv/bin/python tools/learner_report.py export /tmp/learner-report \
  --actions /path/to/learner-actions.json \
  --activity /path/to/prepared-activity/activity.json
```

The sidecar's `activity_sha256` must match the canonical digest of the selected
prepared activity. This makes the labels, source statement, parameter, choices,
and control in the report specific to the captured definition. Without
`--activity`, the report marks context unavailable and does not infer labels
from a mutable template catalogue.

Add a selected host journal snapshot when it is relevant:

```console
.venv/bin/python tools/learner_report.py export /tmp/learner-report \
  --actions /path/to/learner-actions.json \
  --activity /path/to/prepared-activity/activity.json \
  --journal /path/to/journal.json
```

A journal can also be exported alone:

```console
.venv/bin/python tools/learner_report.py export /tmp/journal-report \
  --journal /path/to/journal.json
```

Free text and journal evidence locators are redacted by default. A learner may
make an explicit local export choice to retain their original words:

```console
.venv/bin/python tools/learner_report.py export /tmp/learner-report-with-text \
  --actions /path/to/learner-actions.json \
  --include-original-text
```

Journal storage consent controls local capture by the host. It is not consent
to share or publish the report. The exporter does not collect or copy dedicated
learner-identity or private-session fields. Activity IDs and supplied source
descriptions may themselves be identifying, so inspect the local report before
sharing it. Default redaction is a technical policy over the allowed text and
locator fields, not a general-purpose de-identification guarantee.

## Review and verify

Open `/tmp/learner-report/index.html` for the portable, escaped local view. It
shows the activity and journal as separate timelines and links the ASTRA, ARA,
MyST, and integrity artifacts.

To use the existing MySTRA Observatory, point its course root at the parent of
the report directory:

```console
.venv/bin/python services/observatory/observatory_app.py \
  --course-root /tmp --port 8004
```

Then open `http://127.0.0.1:8004/courses/learner-report/mystra`. The native
MySTRA page renders the sanitized action and journal events from the ARA trace.
Its surrounding summary is course-oriented, so it shows zero scenes judged for
this report. That is expected because learner assessment is outside the export.

Recheck an export before using it:

```console
.venv/bin/python tools/learner_report.py verify /tmp/learner-report
```

Verification revalidates the selected source schemas and bindings, recomputes
the report summary and ASTRA/ARA/rendered outputs, runs the installed
`astra-tools` validator for ASTRA 0.0.14, and checks SHA-256 coverage for every
standard output and selected sanitized source. `checks.json` does not hash
itself. The manifest is unsigned: it detects stale, missing, or accidentally
changed artifacts, but someone able to rewrite the entire report can also
rewrite its hashes.

The directory contains:

- `sources/learner-actions.json`, `sources/experiment-journal.json`, and/or
  `sources/activity.json`: only the selected sanitized records;
- `report.json`: the derived technical summary and scope boundaries;
- `astra.yaml`: the strict ASTRA 0.0.14 artifact declaration;
- `trace/exploration_tree.yaml`: separate, evidence-linked action journeys;
- `course_provenance.myst.md`: output from the shared MySTRA renderer;
- `index.html`: a portable escaped view; and
- `checks.json`: validator result and artifact hashes.

The default directory never contains a copy of the original raw trace.
