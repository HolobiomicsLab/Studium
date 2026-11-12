"""The Studium vocabulary served at https://holobiomicslab.cnrs.fr/ns/studium (INT-STUDIUM, 12 Nov 2026).

What these tests pin:
  * the terms ARE the scene types of the lesson bundle schema, so a type added to the schema without a
    term (or a term without a type) fails here;
  * the four published files are the generator's output, and say the same thing (rdflib, when present);
  * the document identity is on the canonical host, holobiomicslab.cnrs.fr, and nowhere on .eu;
  * the w3id.org rule sends https://w3id.org/studium to that document.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NS_DIR = ROOT / "ns"
W3ID = NS_DIR / "w3id" / "ids" / "studium"
FILES = ["studium.ttl", "studium.jsonld", "studium.rdf", "studium.html"]


def _load_builder():
    spec = importlib.util.spec_from_file_location("build_studium_vocab", ROOT / "tools" / "ns" / "build_studium_vocab.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # a dataclass resolves its annotations through sys.modules
    spec.loader.exec_module(module)
    return module


B = _load_builder()


def _bundle_scene_types() -> set[str]:
    source = (ROOT / "packages" / "lesson-bundle-schema" / "python" / "lesson_bundle_schema" / "__init__.py").read_text()
    block = re.search(r"^SceneType = Literal\[(.*?)\]", source, re.S | re.M)
    assert block, "SceneType Literal not found in lesson_bundle_schema"
    return set(re.findall(r'"([a-z_]+)"', block.group(1)))


def test_the_terms_are_the_scene_types_of_the_bundle_schema():
    assert {t.id for t in B.SCENE_TYPES} == _bundle_scene_types()
    assert len(B.SCENE_TYPES) == 13


def test_every_term_has_an_english_and_a_french_definition():
    for t in B.SCENE_TYPES:
        assert t.en.strip() and t.fr.strip(), t.id
        assert t.en != t.fr, t.id


def test_term_iris_are_the_bundle_values_under_the_w3id_namespace():
    assert B.NS == "https://w3id.org/studium#"
    ttl = (NS_DIR / "studium.ttl").read_text()
    for t in B.SCENE_TYPES:
        assert f"studium:{t.id} a skos:Concept" in ttl, t.id


@pytest.mark.parametrize("name", FILES)
def test_the_four_files_are_shipped(name):
    assert (NS_DIR / name).read_text().strip()


def test_the_document_identity_is_on_the_canonical_host():
    ttl = (NS_DIR / "studium.ttl").read_text()
    assert "<https://holobiomicslab.cnrs.fr/ns/studium> a owl:Ontology" in ttl
    assert 'vann:preferredNamespaceUri "https://w3id.org/studium#"' in ttl
    for name in FILES:
        assert "holobiomicslab.eu" not in (NS_DIR / name).read_text(), name


def test_the_html_page_has_one_article_per_term():
    html = (NS_DIR / "studium.html").read_text()
    for t in B.SCENE_TYPES:
        assert f'<article id="{t.id}">' in html, t.id
    assert 'id="SceneTypeScheme"' in html
    assert html.count("<article ") == len(B.SCENE_TYPES) + 1


def test_the_files_are_the_generator_output():
    pytest.importorskip("rdflib")
    built = B.build()
    for name in FILES:
        assert (NS_DIR / name).read_text() == built[name], f"{name} is stale: run tools/ns/build_studium_vocab.py"


def test_the_three_rdf_files_describe_the_same_graph():
    rdflib = pytest.importorskip("rdflib")
    from rdflib.compare import isomorphic

    graphs = []
    for name, fmt in [("studium.ttl", "turtle"), ("studium.jsonld", "json-ld"), ("studium.rdf", "xml")]:
        g = rdflib.Graph()
        g.parse(NS_DIR / name, format=fmt)
        graphs.append(g)
    assert len(graphs[0]) > 13 * 5
    assert isomorphic(graphs[0], graphs[1])
    assert isomorphic(graphs[0], graphs[2])


def test_the_w3id_rule_sends_the_namespace_to_the_cnrs_document():
    rule = (W3ID / ".htaccess").read_text()
    assert "RewriteRule ^$ https://holobiomicslab.cnrs.fr/ns/studium [R=303,L]" in rule
    assert "holobiomicslab.eu" not in rule
    assert "Options -MultiViews" in rule
    readme = (W3ID / "README.md").read_text()
    assert "https://w3id.org/studium#" in readme
    assert "holobiomicslab.eu" not in readme
