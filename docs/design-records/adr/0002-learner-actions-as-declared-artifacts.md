# Learner actions as declared ASTRA artifacts

2026-09-11 · INT-STUDIUM-045 · Implementation through owner-delegated design.

## Context

The private host experiment journal records a learner's prediction, beginning,
observation and conclusion. An interactive viewer also exposes useful actions,
such as selecting a representation or changing a threshold. The owner requests a
standardized report that remains compatible with the common ASTRA/MySTRA tooling.

ASTRA is a structured provenance contract, not a browser-event schema. The existing
Studium contract pins its version in `services/planner/provenance/astra_contract.py`;
its validated fields must remain compatible with the shared ecosystem. The ARA
exploration contract already has a single local definition in `exploration_trace.py`.

## Decision

Keep semantic activity events in a strict versioned Studium sidecar and declare
that artifact through supported ASTRA fields. Generate MySTRA from the structured
record using the existing reader/renderer, and retain the ARA version and node
contract. Do not add learner-specific fields to ASTRA or copy a second contract
constant from another application. This is not an xAPI or LRS implementation.

The sidecar separates browser-observed interactions and harness-declared help.
Sequence numbers order one stream; timestamps do not authenticate authorship or
synchronize independent clocks. Missing assistance events remain unknown. The
host journal and browser log retain distinct sources and sequences; an export
cannot become a retroactive pre-assistance journal entry.

The default report excludes original free text. Explicit original-text inclusion
is a separate export choice. Export only the records the learner selected; no
background collection, automatic upload, answer submission or mastery update.
The report is evidence for discussion, not a derived proficiency score.

## Consequences

The template and report tools share the Pydantic-generated activity schema, so
browser downloads can be checked against the same versioned contract. Hashes
check package integrity, not completeness of the record or scientific truth.
A future change to semantic events needs a compatible schema evolution or new
version; clients must not silently accept unknown event data.

A small number of versioned templates supplies editable teaching structures.
Scientific claims, inputs, controls and reference checks remain explicit. Draft
patterns are labelled proposed and cannot masquerade as runnable activities.

The inspected common contract cites ASB donor revision
`2795f9ec4910e039ac7bb4dc02f574ae1645ca2c`; the local ASB checkout inspected during
this change was `ca2cb3ce5d7ff71042f1fe12002a4a0e80005028` (astra_export/model.py and
trace_extract/model.py). Existing Studium emit_astra, run_astra_validate,
build_exploration_tree, astra_render.render and Observatory views are reused.
No other project's learner data or application frontend was copied.
