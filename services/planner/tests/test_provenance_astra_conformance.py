"""Conformance: a fully-built astra.yaml must satisfy the VENDORED ASTRA contract.

Builds the analysis exactly the way planner_app does (GraphBuilder + pedagogical
decisions -> emit_astra -> write_astra_yaml), reloads it from disk, and checks it
against provenance/astra_contract.py.

Deliberately NOT wrapped in pytest.importorskip: the contract is vendored and
offline, so this test can never skip silently. Silent absence of a real check is
how the emitter went on advertising v0.0.10 conformance while emitting ids the
spec's grammar rejects.
"""
import os
import re

import pytest
import yaml

from agentic.telemetry import InMemoryTelemetrySink
from graph.builder import GraphBuilder
from lesson_plan_schema import CorpusRef, LearningObjective, LessonPlan, SceneOutline
from provenance.astra_contract import ASTRA_ID_RE, ASTRA_SCHEMA_VERSION, is_valid_astra_id
from provenance.approval import _astra_for
from provenance.astra_emit import (
    SOURCE_ID_FIELD, analysis_body, baseline_universe, emit_astra, nest_universe,
    write_astra_yaml,
)
from provenance.universes import pedagogical_decisions, remedial_universe

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "abs_capsule")
# astra-spec's own `version` slot pattern.
_VERSION_RE = re.compile(r"^\d+\.\d+(\.\d+)?$")


class _StubAgent:
    """Proposes the single prerequisite edge the fixture plan supports."""

    def propose_prerequisites(self, concepts):
        return [{"source": "concept:obj-fft", "target": "concept:obj-fourier",
                 "rationale": "Fourier first"}]


def _plan() -> LessonPlan:
    """A plan whose ids are hostile to the ASTRA grammar (hyphens + colons)."""
    return LessonPlan(
        id="p1", title="Signal Processing", language="fr", target="L3",
        duration_minutes=45, source_manifest_id="sp-101",
        learning_objectives=[
            LearningObjective(id="obj-fourier", description="Fourier transform", bloom_level="understand"),
            LearningObjective(id="obj-fft", description="Apply the FFT", bloom_level="apply"),
        ],
        scene_outlines=[SceneOutline(id="s1", type="concept", title="Fourier basics",
                                     objective_refs=["obj-fourier"])],
        corpus_refs=[CorpusRef(ref_id="cap1", ref_type="abs_capsule",
                               abs_capsule_path=_FIXTURE, aligns_concept_ids=["obj-fourier"])],
    )


def _all_ids(doc: dict) -> list[tuple[str, object]]:
    """(path, identifier) for every id the emitted document declares or references."""
    ids: list[tuple[str, object]] = []
    ids.extend((f"inputs[{n}].id", i["id"]) for n, i in enumerate(doc.get("inputs") or []))
    ids.extend((f"outputs[{n}].id", o["id"]) for n, o in enumerate(doc.get("outputs") or []))
    for slug, analysis in (doc.get("analyses") or {}).items():
        ids.append((f"analyses.{slug}", slug))
        ids.append((f"analyses.{slug}.id", analysis["id"]))
        for section in ("decisions", "prior_insights", "findings"):
            for key, body in (analysis.get(section) or {}).items():
                ids.append((f"analyses.{slug}.{section}.{key}", key))
                ids.extend((f"analyses.{slug}.{section}.{key}.options.{o}", o)
                           for o in (body.get("options") or {}))
                if body.get("default") is not None:
                    ids.append((f"analyses.{slug}.{section}.{key}.default", body["default"]))
        ids.extend((f"analyses.{slug}.outputs[{n}].id", o["id"])
                   for n, o in enumerate(analysis.get("outputs") or []))
    return ids


@pytest.fixture
def built(tmp_path):
    """(analysis reloaded from astra.yaml, GraphBuildResult) for the fixture course."""
    builder = GraphBuilder(graph_agent=_StubAgent(), telemetry=InMemoryTelemetrySink(),
                           clock=lambda: "2026-06-11T00:00:00+00:00", asserted_by="urn:x")
    res = builder.build(_plan())
    analysis = emit_astra(
        analysis_id=f"{res.graph['course_id']}-analysis", name="Signal Processing",
        decisions=res.decisions + pedagogical_decisions(), prior_insights=[],
        findings=res.findings, outputs=[{"id": "lwg", "type": "data"}],
    )
    write_astra_yaml(analysis, str(tmp_path))
    return yaml.safe_load((tmp_path / "astra.yaml").read_text(encoding="utf-8")), res


def test_fixture_exercises_the_hostile_ids(built):
    """Guard the guard: the built analysis must contain a capsule-link finding,
    whose raw id carries the colons the grammar rejects."""
    _, res = built
    raw = [f["id"] for f in res.findings]
    assert any(":" in r for r in raw), f"fixture no longer produces colon ids: {raw}"


def test_built_analysis_declares_the_vendored_schema_version(built):
    analysis, _ = built
    assert analysis["version"] == ASTRA_SCHEMA_VERSION
    assert _VERSION_RE.match(analysis["version"]), analysis["version"]


def test_document_has_the_asb_analyses_shape(built):
    """Root mirrors what ASB emits (asb_benchmark q_metlinkr): version/name/inputs/
    outputs at root, NO root id, the course as one sub-analysis whose id equals its
    key, and root outputs re-exporting sub-analysis outputs via `from`."""
    doc, _ = built
    assert "id" not in doc
    assert set(doc) >= {"version", "name", "inputs", "outputs", "analyses"}
    slug, body = analysis_body(doc)
    assert list(doc["analyses"]) == [slug] and body["id"] == slug
    assert all("from" in o for o in doc["outputs"])
    assert all(o["from"].split(".", 1)[0] == slug for o in doc["outputs"])


def test_every_emitted_id_matches_the_astra_id_grammar(built):
    analysis, _ = built
    bad = [(path, value) for path, value in _all_ids(analysis) if not is_valid_astra_id(value)]
    assert not bad, f"ids violating {ASTRA_ID_RE.pattern}: {bad}"


def test_raw_edge_ids_survive_for_the_indicium_join(built):
    """approval.py joins a Claim to its ASTRA entry through the edge id carried in
    astra_insight_ref, so every such id must remain recoverable after slugification."""
    doc, res = built
    _, analysis = analysis_body(doc)
    refs = {e["astra_insight_ref"].split("/", 1)[1]
            for e in res.graph["edges"] if e.get("astra_insight_ref")}
    kept = {body.get(SOURCE_ID_FIELD) for body in analysis["findings"].values()}
    kept |= {body.get(SOURCE_ID_FIELD) for body in analysis["decisions"].values()}
    assert refs and refs <= kept, f"lost raw edge id(s): {sorted(refs - kept)}"


def test_approval_join_resolves_every_astra_insight_ref(built):
    """The join itself, not just the surviving field: _astra_for must return an entry for
    every astra_insight_ref the graph emits, including the colon-bearing edge ids."""
    analysis, res = built
    refs = [e["astra_insight_ref"] for e in res.graph["edges"] if e.get("astra_insight_ref")]
    assert refs, "fixture emitted no astra_insight_ref to join on"
    unresolved = [ref for ref in refs
                  if _astra_for({"astra_insight_ref": ref}, analysis) == (None, None)]
    assert not unresolved, f"astra_insight_ref(s) that join to nothing: {unresolved}"


def test_universe_decisions_reference_emitted_decision_ids(built):
    """A nested universe selects options under the analysis slug; its decision keys
    must be emitted ids and its slug must be the document's one sub-analysis."""
    doc, _ = built
    slug, analysis = analysis_body(doc)
    ped = pedagogical_decisions()
    for universe in (nest_universe(baseline_universe(ped), slug),
                     nest_universe(remedial_universe(ped), slug)):
        assert list(universe["analyses"]) == [slug]
        unknown = set(universe["analyses"][slug]["decisions"]) - set(analysis["decisions"])
        assert not unknown, f"universe {universe['id']} references unknown: {sorted(unknown)}"
