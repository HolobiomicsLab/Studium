---
name: studium-learner-report
description: Export or inspect a learner-selected Studium activity trace or private experiment journal as a standards-compatible ASTRA/MySTRA report. Use for local learner portfolios and teacher review of recorded actions, with explicit control over original text.
---

# Studium learner report

Resolve this skill's real path; its source repository is two directories above
it. Locate `tools/learner_report.py` and read
[Learner activity report](../../docs/learn/learner-report.md). Use the existing
Python venv and the repository's ASTRA validator and MySTRA renderer. Do not install
a parallel schema or copy another project's private report data.

## Select the record and sharing scope

Use the action file the learner explicitly exported, a journal snapshot they
selected, or explicitly labelled synthetic test data. Do not scan their data
store for other sessions. A request for a local report permits preparing the
redacted local report; uploading or emailing it is a separate action.

Keep the default that excludes original free text. Include original words only
when explicitly requested for this report. Consent to store the journal does not
by itself authorize including its contents in a teacher copy. Preserve exact
words and learner-supplied confidence when included; do not reconstruct missing
observations from the harness conversation or invent a score.

## Export and verify

Write to a new report directory, then verify it:

```bash
.venv/bin/python tools/learner_report.py export NEW_REPORT_DIR \
  --actions learner-actions.json --activity prepared-activity/activity.json
.venv/bin/python tools/learner_report.py verify NEW_REPORT_DIR
```

`--journal journal.json` adds a journal snapshot (alone or with `--actions`);
`--include-original-text` keeps the learner's own words, only on their explicit
request. Over MCP, `get_experiment_journal {session_id}` returns the journal to save
as that snapshot. Examine the actual `verify` result before calling the package
verified. Open the report's `index.html` (or its MySTRA view in the Observatory) and
show the learner the text policy, recorded actions, missing evidence and checks before
any sharing.

Keep three contracts distinct: the private host journal, the versioned Studium
activity sidecar and ASTRA provenance. Learner actions belong to declared
artifacts referenced by ASTRA, not new unrecognized fields inside ASTRA. Reuse
ARA links and MySTRA rendering as provided by the tool.

A browser event reports an interaction in that page. A harness event declares
assistance the harness recorded. Neither authenticates authorship or proves a
complete history. No assistance record means unknown, never “worked unaided”.
Preserve separate journal and browser sequences; their clocks are not proof of
one global chronology. Source hashes detect changes relative to the captured
record; they do not certify scientific correctness or learning.

## Read it with a teacher or learner

Describe the question attempted, recorded actions and available comparisons.
Separate the learner's statement, the tool's output and any teacher interpretation.
Flag absent or failed checks and partial traces without turning them into grades.
Do not submit a lesson answer, update mastery, approve content or publish a
student report as a side effect of exporting it. Use the existing
[teacher workflow](../studium-teacher/SKILL.md) for content review.

Reports are independent local copies: forgetting the host session does not erase
exports or harness history. Explain that scope when asked to erase a record.
