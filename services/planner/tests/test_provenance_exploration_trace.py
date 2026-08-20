"""Conformance: the emitted exploration trace must satisfy the vendored ARA
trace contract (ASB trace_extract, schema 0.1.0): N-prefixed node ids, per-type
required fields, and explicit nodes carrying source_refs into astra.yaml.

Built from the emitted ASTRA document (never from raw decisions) so the trace's
source_refs cannot drift from the ids astra.yaml actually carries."""
import yaml

from provenance.astra_emit import analysis_body, emit_astra
from provenance.exploration_trace import (
    NODE_ID_PATTERN, REQUIRED_FIELDS_BY_TYPE, TRACE_SCHEMA_VERSION,
    build_exploration_tree, write_exploration_trace,
)
from provenance.universes import pedagogical_decisions


def _doc():
    return emit_astra(analysis_id="sp-101-analysis", name="Signal Processing",
                      decisions=pedagogical_decisions(), prior_insights=[],
                      findings=[], outputs=[{"id": "lwg", "type": "data"}])


def _walk(nodes):
    for n in nodes:
        yield n
        yield from _walk(n.get("children") or [])


def test_tree_declares_schema_version_and_question_root():
    tree = build_exploration_tree(_doc())
    assert tree["schema_version"] == TRACE_SCHEMA_VERSION
    assert len(tree["nodes"]) == 1 and tree["nodes"][0]["type"] == "question"


def test_every_node_conforms_to_the_vendored_contract():
    tree = build_exploration_tree(_doc())
    for n in _walk(tree["nodes"]):
        assert NODE_ID_PATTERN.match(n["id"]), n["id"]
        assert n["type"] in REQUIRED_FIELDS_BY_TYPE, n["type"]
        for req in REQUIRED_FIELDS_BY_TYPE[n["type"]]:
            key = "from" if req == "from_" else req
            assert n.get(key), f"{n['id']} ({n['type']}) missing {key}"
        assert n["support_level"] in ("explicit", "inferred")
        if n["support_level"] == "explicit":
            assert n["source_refs"], f"explicit node {n['id']} has no source_refs"


def test_decision_nodes_mirror_the_astra_decisions():
    doc = _doc()
    slug, analysis = analysis_body(doc)
    tree = build_exploration_tree(doc)
    children = tree["nodes"][0]["children"]
    assert len(children) == len(analysis["decisions"])
    for node, (dslug, body) in zip(children, analysis["decisions"].items()):
        assert node["type"] == "decision"
        assert node["choice"] == body["options"][body["default"]]["label"]
        alt_labels = [o["label"] for oid, o in body["options"].items() if oid != body["default"]]
        assert node["alternatives"] == alt_labels
        assert node["source_refs"] == [f"astra.yaml#analyses/{slug}/decisions/{dslug}"]


def test_node_ids_are_unique_and_sequential():
    tree = build_exploration_tree(_doc())
    ids = [n["id"] for n in _walk(tree["nodes"])]
    assert len(ids) == len(set(ids))
    assert ids[0] == "N01"


def test_write_exploration_trace_lands_in_trace_dir(tmp_path):
    tree = build_exploration_tree(_doc())
    write_exploration_trace(tree, str(tmp_path))
    loaded = yaml.safe_load((tmp_path / "trace" / "exploration_tree.yaml").read_text(encoding="utf-8"))
    assert loaded["schema_version"] == TRACE_SCHEMA_VERSION
    assert loaded["nodes"][0]["id"] == "N01"
