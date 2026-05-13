"""Tests unitaires EvidenceEnricher — skeleton phase (mocks Perspicacité + ABS)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import MagicMock
from datetime import datetime, timezone
from planner_schemas import (
    LessonPlan,
    PlanMetadata,
    LearningObjective,
    SceneOutline,
    SceneType,
    BloomLevel,
    PlanStatus,
    Evidence,
    BibliographicRef,
)
from evidence.enricher import EvidenceEnricher


def _empty_plan(scenes: list[SceneOutline]) -> LessonPlan:
    return LessonPlan(
        id="plan-test",
        title="Test Plan",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(
                id="o1",
                description="comprendre X",
                bloom_level=BloomLevel.understand,
            )
        ],
        scene_outlines=scenes,
        corpus_refs=[],
        status=PlanStatus.critic_reviewed,
    )


def test_enrich_returns_plan_unchanged_if_no_eligible_scenes():
    """Pas de scene_type éligible → plan sortie identique."""
    plan = _empty_plan([
        SceneOutline(id="s1", type=SceneType.quiz, title="Quiz", objective_refs=[]),
        SceneOutline(id="s2", type=SceneType.discussion, title="D", objective_refs=[]),
    ])
    enricher = EvidenceEnricher(
        perspicacite_client=MagicMock(),
        abs_reader=MagicMock(),
    )
    result = enricher.enrich(plan)
    assert all(s.evidence is None for s in result.scene_outlines)


def test_enrich_skips_scene_with_override_skip():
    """evidence_override='skip' bypass l'enrichment."""
    plan = _empty_plan([
        SceneOutline(
            id="s1",
            type=SceneType.concept,
            title="C",
            evidence_override="skip",
        ),
    ])
    enricher = EvidenceEnricher(
        perspicacite_client=MagicMock(),
        abs_reader=MagicMock(),
    )
    result = enricher.enrich(plan)
    assert result.scene_outlines[0].evidence is None


def test_enrich_processes_eligible_scene_with_force():
    """evidence_override='force' déclenche enrichment même hors heuristique."""
    plan = _empty_plan([
        SceneOutline(
            id="s1",
            type=SceneType.quiz,
            title="Quiz",
            evidence_override="force",
        ),
    ])
    mock_perspicacite = MagicMock()
    mock_perspicacite.search.return_value = {
        "status": "ok",
        "docs": [
            {
                "id": "doc-1",
                "title": "Ref forced",
                "authors": ["A"],
                "excerpt": "x",
                "relevance_score": 0.9,
            }
        ],
    }
    enricher = EvidenceEnricher(
        perspicacite_client=mock_perspicacite,
        abs_reader=MagicMock(),
    )
    result = enricher.enrich(plan)
    assert result.scene_outlines[0].evidence is not None
    assert result.scene_outlines[0].evidence.bibliographic_refs is not None
    assert len(result.scene_outlines[0].evidence.bibliographic_refs) == 1
