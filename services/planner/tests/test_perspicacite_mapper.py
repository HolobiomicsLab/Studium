"""Tests unitaires perspicacite_mapper — mode selection + extraction refs."""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from planner_schemas import SceneType, BibliographicRef
from evidence.perspicacite_mapper import (
    select_mode,
    extract_refs,
)


@pytest.mark.parametrize("scene_type, expected_mode", [
    (SceneType.intro, "advanced"),
    (SceneType.concept, "advanced"),
    (SceneType.simulation, "profound"),
    (SceneType.reproduction, "agentic"),
])
def test_select_mode_fixed_mapping(scene_type, expected_mode):
    assert select_mode(scene_type) == expected_mode


def test_select_mode_default_for_non_eligible():
    """Fallback : tout autre type retourne 'advanced'."""
    assert select_mode(SceneType.quiz) == "advanced"


def test_extract_refs_from_perspicacite_response():
    """Convertit la réponse Perspicacité en list[BibliographicRef]."""
    response = {
        "status": "ok",
        "docs": [
            {
                "id": "p1",
                "doi": "10.1234/x",
                "title": "A",
                "authors": ["A. Author"],
                "year": 2024,
                "excerpt": "ex",
                "relevance_score": 0.8,
            },
            {
                "id": "p2",
                "title": "B",
                "authors": ["B. Author"],
                "excerpt": "ex2",
                "relevance_score": 0.6,
            },
        ],
    }
    refs = extract_refs(response)
    assert len(refs) == 2
    assert refs[0].perspicacite_doc_id == "p1"
    assert refs[0].doi == "10.1234/x"
    assert refs[1].doi is None
    assert refs[0].prov_derived_from == "urn:perspicacite:doc:p1"


def test_extract_refs_handles_offline_status():
    response = {"status": "offline"}
    assert extract_refs(response) == []


def test_extract_refs_truncates_excerpt_to_500_chars():
    long_excerpt = "x" * 800
    response = {
        "status": "ok",
        "docs": [
            {
                "id": "p1",
                "title": "T",
                "authors": [],
                "excerpt": long_excerpt,
                "relevance_score": 0.5,
            }
        ],
    }
    refs = extract_refs(response)
    assert len(refs[0].excerpt) == 500
