"""Conformance: every node the LWG emitter produces uses only LEGAL indicium
LinkML slots / enum values / IRIs. Two layers:

  (1) OFFLINE (always runs): validate against the vendored enum/slot sets
      (provenance.indicium_schema_vendored, copied from indicium.yaml). This is
      the self-contained CI guard — no skip path.
  (2) GATED round-trip (skips offline): when the real `indicium` package is
      pip-installed, round-trip every node through the generated Pydantic model
      (Claim/Evidence.model_validate, extra="forbid"). Mirrors the existing
      gated pattern in test_provenance_indicium_roundtrip.py.

Catches exactly the ontology-lens violations: @type as a model field, the
illegal Evidence `doi` slot, `of_source` as a bare string, and any
illegal/enum-invalid value.
"""
from __future__ import annotations

import pytest

from provenance.graph_to_indicium import graph_to_claims
from provenance.indicium_schema_vendored import (
    assert_claim_conformant,
    assert_evidence_conformant,
)

# LWG exercising BOTH evidence paths: a DOI-backed citation edge AND an
# artifact-backed (of_source) inference edge.
LWG = {
    "schema_version": "1.0",
    "course_id": "signal-processing-101",
    "nodes": [],
    "edges": [
        {
            "id": "e1", "relation": "prerequisite_for",
            "source": "concept:fft", "target": "concept:fourier-basics",
            "confidence": 0.72,
            "evidence": [{"artifact": "teacher-doc:lecture2.pdf#sec.2", "page": 4, "confidence": 0.72}],
            "astra_insight_ref": "course-analysis/e1",
        },
        {
            "id": "e2", "relation": "assesses",
            "source": "task:quiz-fft", "target": "concept:fft",
        },
        {
            "id": "e9", "relation": "prerequisite_for",
            "source": "a", "target": "b",
            "evidence": [{"doi": "10.1234/test", "confidence": 0.9, "quote": "FFT needs Fourier."}],
        },
    ],
}


def _doc():
    return graph_to_claims(LWG, asserted_by="urn:studium:graphagent:run-7f3a")


def test_all_nodes_use_only_legal_slots_and_enums_offline():
    doc = _doc()
    seen_claim = seen_evidence = False
    for node in doc["@graph"]:
        if node.get("@type") == "asb:Claim":
            assert_claim_conformant(node)
            seen_claim = True
        elif node.get("@type") == "sepio:0000002":
            assert_evidence_conformant(node)
            seen_evidence = True
        else:  # pragma: no cover - guards against an unexpected node kind
            raise AssertionError(f"Unexpected node @type: {node.get('@type')!r}")
    assert seen_claim and seen_evidence


def test_doi_evidence_carries_doi_on_source_not_top_level():
    doc = _doc()
    doi_ev = next(
        n for n in doc["@graph"]
        if n.get("@type") == "sepio:0000002" and n.get("evidence_type") == "citation"
    )
    assert "doi" not in doi_ev  # doi is NOT an Evidence slot
    assert doi_ev["of_source"]["doi"] == "10.1234/test"  # it lives on the Source


def test_artifact_evidence_wraps_of_source_as_object():
    doc = _doc()
    art_ev = next(
        n for n in doc["@graph"]
        if n.get("@type") == "sepio:0000002"
        and isinstance(n.get("of_source"), dict)
        and n["of_source"].get("identifier", "").startswith("teacher-doc:")
    )
    assert art_ev["of_source"]["identifier"] == "teacher-doc:lecture2.pdf#sec.2"


def test_context_iris_match_canonical_indicium():
    doc = _doc()
    ctx = doc["@context"]
    assert ctx["asb"] == "https://asb.holobiomics.org/ns/asb#"
    assert ctx["sepio"] == "http://purl.obolibrary.org/obo/SEPIO_"
    assert ctx["prov"] == "http://www.w3.org/ns/prov#"


# --- Gated round-trip against the REAL generated Pydantic model ----------
def test_roundtrip_through_real_indicium_model_when_available():
    indicium_model = pytest.importorskip("indicium.generated.model")
    doc = _doc()
    for node in doc["@graph"]:
        body = {k: v for k, v in node.items() if k not in ("@type", "@context")}
        if node.get("@type") == "asb:Claim":
            indicium_model.Claim.model_validate(body)
        elif node.get("@type") == "sepio:0000002":
            indicium_model.Evidence.model_validate(body)
