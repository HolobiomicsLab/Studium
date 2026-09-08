# ADR 0001 — ASB-shaped ASTRA documents and ARA exploration traces

Date: 2026-08-20 · Status: accepted

## Context

Studium's provenance layer emits ASTRA artifacts (`astra.yaml` + `universes/*.yaml`)
so that course-build decisions are explainable in the same vocabulary as the wider
ASB ecosystem (ASTRA = the analysis/decision layer; indicium = claims+evidence).
Until now the emitter produced a **flat** document — decisions/findings at the
root — while ASB emitters (`AgenticScienceBuilder astra_export`) and real
documents (`asb_benchmark_metabolomics_v1/q_metlinkr/astra/astra.yaml`) nest each
analysis under an `analyses:` container, with universes carrying their overrides
under `analyses.<slug>.decisions`. Two documents both claiming ASTRA could not be
read by one loader. Separately, ARA (arXiv 2604.24658) makes the research
*journey* — alternatives and dead ends — a first-class artifact; ASB ships an
exploration-trace spec (0.1.0, `trace_extract`, branch `feat/exploration-trace-spec`).

## Decision

1. `emit_astra` produces the **ASB document shape**: root `version / name /
   description / inputs / outputs` (no root `id`; `description` because 0.0.12
   dropped `Narrative`), the course as **one sub-analysis** under `analyses:`
   keyed by the slugified analysis id, and root outputs re-exporting sub-analysis
   outputs via `from`. Universes are written nested (`nest_universe`).
2. The in-API `lesson_plan.universes` payload keeps the **flat** shape — it is an
   internal API, not an interop artifact.
3. Readers go through `analysis_body(doc)` / `_universe_decisions(u)`, which
   accept both shapes, so pre-nesting artifacts on disk keep resolving.
4. Studium's universes record a **complete option selection** (ASB baseline
   records `{}` = no overrides). Both satisfy the shape; a loader must treat a
   missing decision key as "default".
5. Every course build also writes `trace/exploration_tree.yaml` — the ARA
   exploration trace (schema 0.1.0, contract vendored in
   `provenance/exploration_trace.py`): a `question` root plus one `decision` node
   per build decision (choice + alternatives), each with `source_refs` into
   `astra.yaml`. Built FROM the emitted document so refs cannot drift. Findings →
   `experiment` nodes and authoring dead ends are future work.

## Consequences

- A Studium `astra.yaml` and an ASB `astra.yaml` now differ at the root only by
  `description`-vs-`narrative`, which is precisely the 0.0.10→0.0.12 spec change.
- `astra validate` could not be run when this ADR was written (no `astra` CLI
  offline); structural conformance was enforced by
  `tests/test_provenance_astra_conformance.py` against the vendored contract only.
  **2026-09-03:** the real validator ran for the first time (the CLI ships in PyPI
  `astra-tools`, not in `astra-spec`): the set emitted at that date failed under
  astra-tools 0.2.12 / astra-spec 0.0.12 (the version pinned then) and under 0.2.17 /
  0.0.14 — `source_edge_id` as an extra key on decisions and findings (`extra=forbid`),
  evidence without `id` and with a non-schema `confidence`, universes omitting the edge
  decisions, no sub-analysis `inputs`, evidence artifacts not declared as outputs;
  `review/astra.yaml` added a string `quote` and a missing `created_at`.
  **Closed 2026-09-03 (INT-STUDIUM-010, astra-tools 0.2.17 / astra-spec 0.0.14, commit
  `3801f0d`):** the contract is pinned to 0.0.14 and every emitted document validates
  with the real CLI (`tools/astra_validate_check.py`: "All 4 file(s) passed
  validation."). Fix shape: the raw edge id lives in-schema as a `source_edge_id:<raw>`
  tag, read back by `astra_emit.source_edge_id()` (tag, then the legacy key of
  pre-2026-09-03 files, then the container key), so the `approval.py` join and
  `tools/astra_render.py` survive; evidence gets `id = <owner>_ev<n>`, a
  `TextQuoteSelector` quote and its confidence in `notes`; every cited artifact is a
  declared sub-analysis output (`artifact_<slug>`); the sub-analysis declares
  `inputs`; universes assign every emitted decision (`nest_universe(...,
  analysis_decisions)`, edge decisions at their default); `Output.format` is emitted —
  the one field a 0.0.12 validator rejects (ASB's exporter stays 0.0.12; its documents
  still load here). Proof on every run: `tests/test_provenance_astra_validate_cli.py`
  (real CLI, negative control, loud skip outside CI, failure in CI) and the CI step
  "ASTRA validator (INT-STUDIUM-010)". The vendored contract stays the offline
  fallback for the id grammar.
- Consumers that assumed root-level `decisions` were updated (`approval.py`);
  external consumers of old artifacts are unaffected (readers accept both).
