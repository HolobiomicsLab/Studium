from provenance.graph_to_indicium import graph_to_claims

LWG = {
    "schema_version": "1.0",
    "course_id": "signal-processing-101",
    "nodes": [
        {"id": "concept:fft", "node_kind": "concept", "title": "FFT", "bloom_level": "apply"},
        {"id": "concept:fourier-basics", "node_kind": "concept", "title": "Fourier basics", "bloom_level": "understand"},
    ],
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
            "objective_id": "obj:fft-1", "bloom_level": "apply",
        },
    ],
}


def test_emits_jsonld_with_context_and_graph():
    doc = graph_to_claims(LWG, asserted_by="urn:studium:graphagent:run-7f3a")
    assert "@context" in doc and "@graph" in doc
    assert doc["@context"]["asb"].startswith("https://w3id.org/asb")


def test_prerequisite_edge_dual_carry_and_draft_status():
    doc = graph_to_claims(LWG, asserted_by="urn:studium:graphagent:run-7f3a")
    claim = next(n for n in doc["@graph"] if n.get("id") == "urn:studium:edge:e1")
    assert claim["@type"] == "asb:Claim"
    assert claim["subject"] == "concept:fft" and claim["object"] == "concept:fourier-basics"
    assert claim["qualifier"] == "requires"
    assert claim["domain_qualifier"] == "prerequisite_for"
    assert claim["claim_status"] == "draft"
    assert claim["asserted_by"] == "urn:studium:graphagent:run-7f3a"
    assert claim["astra_insight_ref"] == "course-analysis/e1"


def test_assesses_edge_domain_qualifier_only():
    doc = graph_to_claims(LWG, asserted_by="x")
    claim = next(n for n in doc["@graph"] if n.get("id") == "urn:studium:edge:e2")
    assert "qualifier" not in claim
    assert claim["domain_qualifier"] == "assesses"


def test_evidence_node_links_to_claim_with_artifact():
    doc = graph_to_claims(LWG, asserted_by="x")
    ev = next(n for n in doc["@graph"] if n.get("@type") == "sepio:0000002")
    assert ev["supports_claim"] == "urn:studium:edge:e1"
    assert ev["of_source"] == "teacher-doc:lecture2.pdf#sec.2"
    assert ev["confidence"] == 0.72
