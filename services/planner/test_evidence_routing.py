"""Tests: hybrid KB routing in EvidenceEnricher (Task 3 — Phase C).

Contract:
  - _kb_for(SceneType.intro, ...) → [domain_kb]
  - _kb_for(content types, ...) → [course_kb]
  - EvidenceEnricher.enrich passes routed kb_names to .search for each scene
"""
import sys, os
_here = os.path.dirname(__file__)
sys.path.insert(0, _here)
sys.path.insert(0, os.path.join(_here, "evidence"))

from evidence.enricher import EvidenceEnricher, _kb_for
from planner_schemas import (
    LessonPlan,
    LearningObjective,
    BloomLevel,
    SceneOutline,
    SceneType,
    PlanStatus,
)


def test_kb_for_routes_intro_to_domain_and_content_to_course():
    assert _kb_for(SceneType.intro, course_kb="C", domain_kb="D") == ["D"]
    assert _kb_for(SceneType.concept, course_kb="C", domain_kb="D") == ["C"]
    assert _kb_for(SceneType.reproduction, course_kb="C", domain_kb="D") == ["C"]
    assert _kb_for(SceneType.simulation, course_kb="C", domain_kb="D") == ["C"]


class _SpyClient:
    def __init__(self):
        self.kb_seen = []

    def search(self, *, query, mode, max_results, kb_names=None):
        self.kb_seen.append(kb_names)
        return {
            "status": "ok",
            "docs": [{"id": "d", "title": "T", "authors": [], "relevance_score": 0.5}],
        }


def _make_plan_with_intro_and_concept():
    """Build a LessonPlan with source_manifest_id='m1', one intro + one concept scene."""
    return LessonPlan(
        id="plan-routing-test",
        title="Routing Test Plan",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(
                id="o1",
                description="comprendre les fondements",
                bloom_level=BloomLevel.understand,
            )
        ],
        scene_outlines=[
            SceneOutline(
                id="s-intro",
                type=SceneType.intro,
                title="Introduction au domaine",
                objective_refs=["o1"],
            ),
            SceneOutline(
                id="s-concept",
                type=SceneType.concept,
                title="Concepts clés",
                objective_refs=["o1"],
            ),
        ],
        corpus_refs=[],
        status=PlanStatus.draft,
        source_manifest_id="m1",
    )


def test_enricher_passes_routed_kb_names():
    plan = _make_plan_with_intro_and_concept()
    spy = _SpyClient()
    enricher = EvidenceEnricher(
        perspicacite_client=spy,
        abs_reader=None,
        domain_kb="domain-science",
    )
    enricher.enrich(plan)

    # Two eligible scenes → two search calls
    assert len(spy.kb_seen) == 2

    # First scene is intro → domain KB
    assert spy.kb_seen[0] == ["domain-science"], (
        f"intro scene should route to domain KB, got {spy.kb_seen[0]}"
    )
    # Second scene is concept → course KB (studium-course-m1)
    assert spy.kb_seen[1] == ["studium-course-m1"], (
        f"concept scene should route to course KB, got {spy.kb_seen[1]}"
    )


def test_enricher_uses_course_kb_from_source_manifest_id():
    """source_manifest_id drives the course_kb name."""
    plan = _make_plan_with_intro_and_concept()
    plan.source_manifest_id = "course-42"
    plan.scene_outlines = [
        SceneOutline(
            id="s-concept",
            type=SceneType.concept,
            title="Métabolites",
            objective_refs=["o1"],
        )
    ]
    spy = _SpyClient()
    enricher = EvidenceEnricher(
        perspicacite_client=spy,
        abs_reader=None,
        domain_kb="domain-science",
    )
    enricher.enrich(plan)
    assert spy.kb_seen[0] == ["studium-course-course-42"]


def test_enricher_no_domain_kb_falls_back_to_empty_list_for_intro():
    """When domain_kb is empty, intro routes to [] (Perspicacité default behaviour)."""
    plan = _make_plan_with_intro_and_concept()
    plan.scene_outlines = [
        SceneOutline(
            id="s-intro",
            type=SceneType.intro,
            title="Introduction",
            objective_refs=["o1"],
        )
    ]
    spy = _SpyClient()
    enricher = EvidenceEnricher(
        perspicacite_client=spy,
        abs_reader=None,
        # domain_kb defaults to ""
    )
    enricher.enrich(plan)
    assert spy.kb_seen[0] == [""]
