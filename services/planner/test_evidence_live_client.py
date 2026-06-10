"""Tests: EvidenceEnricher wired to a fake PerspicaciteClient (Task 4).

Tests the behavioral contract:
- enrich populates scene.evidence with refs from the client
- perspicacite_mode_used == "passages" (honest M1 recording)
- degraded=False when docs returned, degraded=True when empty docs
"""
import sys, os
_here = os.path.dirname(__file__)
sys.path.insert(0, _here)
sys.path.insert(0, os.path.join(_here, "evidence"))
from evidence.enricher import EvidenceEnricher
from planner_schemas import (
    LessonPlan,
    LearningObjective,
    BloomLevel,
    SceneOutline,
    SceneType,
    PlanStatus,
)


class _FakeClient:
    def __init__(self, docs): self._docs = docs
    def search(self, *, query, mode, max_results, kb_names=None):
        return {"status": "ok", "docs": self._docs}


def _plan_with_concept():
    return LessonPlan(
        id="L1",
        title="Test Lesson",
        language="fr",
        target="L1",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(
                id="o1",
                description="comprendre les métabolites",
                bloom_level=BloomLevel.understand,
            )
        ],
        scene_outlines=[
            SceneOutline(
                id="s1",
                type=SceneType.concept,
                title="Metabolite size",
                objective_refs=[],
            ),
        ],
        status=PlanStatus.draft,
    )


DOCS = [{"id": "x2024", "doi": "10.1/x", "title": "Paper X", "authors": ["A B"],
         "year": 2024, "excerpt": "n=3 small sample", "relevance_score": 0.9}]


def test_enrich_populates_evidence_and_records_passages_mode():
    plan = _plan_with_concept()
    EvidenceEnricher(perspicacite_client=_FakeClient(DOCS), abs_reader=None).enrich(plan)
    ev = plan.scene_outlines[0].evidence
    assert ev is not None
    assert ev.bibliographic_refs[0].doi == "10.1/x"
    assert ev.enrichment_metadata.perspicacite_mode_used == "passages"
    assert ev.enrichment_metadata.degraded is False


def test_enrich_degrades_when_no_docs():
    plan = _plan_with_concept()
    EvidenceEnricher(perspicacite_client=_FakeClient([]), abs_reader=None).enrich(plan)
    assert plan.scene_outlines[0].evidence.enrichment_metadata.degraded is True
