from provenance.education_adapter import EducationAdapter, route_qualifier


def test_adapter_identity_and_vocab():
    a = EducationAdapter()
    assert a.domain_id == "education"
    assert "prerequisite_for" in a.qualifiers and "assesses" in a.qualifiers
    assert a.ontology_prefixes["BLOOM"] == "urn:studium:bloom:"


def test_route_qualifier_dual_carry_for_bucur_analog():
    assert route_qualifier("prerequisite_for") == ("requires", "prerequisite_for")
    assert route_qualifier("part_of") == ("is_part_of", "part_of")


def test_route_qualifier_domain_only_for_non_analog():
    assert route_qualifier("assesses") == (None, "assesses")
    assert route_qualifier("aligns_with") == (None, "aligns_with")


def test_enrich_claim_is_pure_and_adds_ontology_terms():
    a = EducationAdapter()
    claim = {"id": "c1", "object": "concept:fft", "bloom_level": "apply"}
    out = a.enrich_claim(claim)
    assert out is not claim
    assert claim == {"id": "c1", "object": "concept:fft", "bloom_level": "apply"}
    assert out["ontology_terms"]["bloom"] == "urn:studium:bloom:apply"
