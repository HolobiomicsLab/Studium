"""Tests for the ontology conformance generator. Run: python -m pytest tools/test_ontology_report.py
(tools/ is outside pytest.ini testpaths, so run it explicitly; the tool's __main__ smoke check also guards
the core derivations). The staleness test is what keeps docs/ontology/conformance.md honest in review."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ontology_report as ort  # noqa: E402


def test_active_modulators_are_the_registry_active_set():
    assert ort.active_modulators() == ["M1", "M3", "M6"]


def test_ghost_edge_relations_are_detected():
    declared, produced = ort.edge_relations()
    assert {"prerequisite_for", "assesses", "part_of"} <= produced
    assert "decomposes_into" not in produced and "aligns_with" not in produced


def test_bundle_scene_mirrors_agree_and_simulation_is_a_graph_only_ghost():
    sites = ort.scene_type_sites()
    mirrors = {k: v for k, v in sites.items() if "learning-workflow" not in k}
    assert len({frozenset(v) for v in mirrors.values()}) == 1  # the two Python mirrors agree
    graph_only = sites["TS · learning-workflow-schema"] - set().union(*mirrors.values())
    assert "simulation" in graph_only  # declared in the graph vocab, no bundle scene schema


def test_conformance_doc_is_not_stale():
    committed = ort.DOC.read_text()
    assert committed == ort.build(), "docs/ontology/conformance.md is stale — run: python tools/ontology_report.py"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
