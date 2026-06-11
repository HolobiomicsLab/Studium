from provenance.universes import pedagogical_decisions, remedial_universe
from provenance.astra_emit import baseline_universe


def test_pedagogical_decisions_shape():
    ds = pedagogical_decisions()
    ids = {d["id"] for d in ds}
    assert ids == {"prereq_strictness", "scaffolding", "pacing"}
    for d in ds:
        assert d["default"] in d["options"]


def test_baseline_universe_uses_defaults():
    u = baseline_universe(pedagogical_decisions())
    assert u["decisions"] == {"prereq_strictness": "standard", "scaffolding": "standard", "pacing": "standard"}


def test_remedial_universe_overrides_to_supportive_options():
    u = remedial_universe(pedagogical_decisions())
    assert u["id"] == "remedial"
    assert u["decisions"] == {"prereq_strictness": "lenient", "scaffolding": "heavy", "pacing": "standard"}
