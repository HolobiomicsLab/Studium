import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

import pytest
from lesson_bundle_schema import LessonBundle, IntroScene, QuizScene, AdaptationRule

# ADR 010 — flat shape ; schema_version bumped to 1.1.
# ADR 014 — evidence fields ; schema_version bumped to 1.4.
VALID_BUNDLE = {
    "schema_version": "1.4",
    "bundle_id": "b-001",
    "source_plan_id": "p-001",
    "metadata": {
        "title": "Métabolomique", "target": "L3", "duration_minutes": 30,
        "language": "fr", "discipline": "métabolomique",
    },
    "concepts": [{"id": "c-001", "title": "LC-MS", "description": "x",
                  "bloom_level_target": "understand"}],
    "scenes": [{"id": "s-1", "type": "intro", "title": "B", "objective_refs": [],
                "concept_refs": ["c-001"], "estimated_seconds": 60,
                "adaptation_hooks": [],
                "markdown": "hello"}],
    "rules": [{"id": "r-1", "when": {"mastery_c": ">=0.8"},
               "action": {"kind": "skip_to_next_concept"},
               "modulator": "M1", "explanation_short": "ok"}],
    "validated_by": "prof.test@example.com",
    "validated_at": "2026-05-08T10:00:00Z",
}


def test_valid_bundle_parses():
    LessonBundle(**VALID_BUNDLE)


def test_rejects_missing_validated_by():
    invalid = dict(VALID_BUNDLE)
    invalid.pop("validated_by")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_rejects_short_validated_by():
    invalid = dict(VALID_BUNDLE, validated_by="ab")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_quiz_scene_min_choices():
    bad_scene = {"id": "s-q", "type": "quiz", "title": "Q",
                 "objective_refs": [], "concept_refs": [], "estimated_seconds": 60,
                 "adaptation_hooks": [],
                 "question": "?",
                 "choices": [{"id": "a", "text": "A", "correct": True}],
                 "feedback_correct": "y", "feedback_incorrect": "n", "hints": []}
    with pytest.raises(Exception):
        QuizScene(**bad_scene)


def test_meta_checkpoint_5_labels():
    bad = {"id": "m1", "type": "meta_checkpoint", "title": "M",
           "objective_refs": [], "concept_refs": [], "estimated_seconds": 30,
           "adaptation_hooks": [],
           "pre_question": "p", "post_question": "post",
           "scale_labels": ["a", "b"]}
    with pytest.raises(Exception):
        from lesson_bundle_schema import MetaCheckpointScene
        MetaCheckpointScene(**bad)


def test_reproduction_scene_validates():
    scene = {"id": "s-r", "type": "reproduction", "title": "R",
             "objective_refs": [], "concept_refs": [], "estimated_seconds": 300,
             "adaptation_hooks": [],
             "task_card_id": "tc-001",
             "steps": [{"step_id": "st1", "instruction": "x",
                        "expected_input_schema": {"type": "object"},
                        "expected_output": "y"}]}
    from lesson_bundle_schema import ReproductionScene
    ReproductionScene(**scene)


def test_ai_critique_scene_validates():
    scene = {"id": "s-c", "type": "ai_critique", "title": "C",
             "objective_refs": [], "concept_refs": [], "estimated_seconds": 180,
             "adaptation_hooks": [],
             "claims": [{"id": "c1", "text": "claim", "flaws_expected": ["f1"]}],
             "rubric": {"completeness": 0.8, "evidence_quality": 0.7, "tone": 0.9}}
    from lesson_bundle_schema import AICritiqueScene
    AICritiqueScene(**scene)


def test_rejects_legacy_schema_version_1_0():
    invalid = dict(VALID_BUNDLE, schema_version="1.0")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_discussion_scene_validates():
    scene = {
        "id": "s-disc-1",
        "type": "discussion",
        "title": "Débat",
        "objective_refs": [],
        "concept_refs": [],
        "estimated_seconds": 600,
        "adaptation_hooks": [],
        "topic": "x",
        "seed_claim": "y",
        "target_signals": ["justification"],
        "max_turns": 5,
    }
    from lesson_bundle_schema import DiscussionScene
    DiscussionScene(**scene)


def test_discussion_scene_rejects_invalid_signal():
    scene = {
        "id": "s-disc-1", "type": "discussion", "title": "x",
        "objective_refs": [], "concept_refs": [],
        "estimated_seconds": 60, "adaptation_hooks": [],
        "topic": "x", "seed_claim": "y",
        "target_signals": ["garbage"],
        "max_turns": 5,
    }
    from lesson_bundle_schema import DiscussionScene
    with pytest.raises(Exception):
        DiscussionScene(**scene)


def test_rejects_legacy_schema_version_1_1():
    invalid = dict(VALID_BUNDLE, schema_version="1.1")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_bundle_with_blueprint_valid():
    bundle = dict(VALID_BUNDLE, schema_version="1.4", assessment_blueprint={
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 0.6,
             "metrics": [{"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 1.0}]},
            {"id": "d2", "label": "D2", "weight": 0.4,
             "metrics": [{"endpoint": "calibration", "field": "brier_score", "weight_in_dimension": 1.0}]},
        ],
    })
    LessonBundle(**bundle)


def test_blueprint_dimensions_weights_must_sum_to_one():
    bundle = dict(VALID_BUNDLE, schema_version="1.4", assessment_blueprint={
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 0.3, "metrics": [{"endpoint": "progress", "field": "completion_rate", "weight_in_dimension": 1.0}]},
        ],
    })
    with pytest.raises(Exception):
        LessonBundle(**bundle)


def test_blueprint_invalid_endpoint_rejected():
    bundle = dict(VALID_BUNDLE, schema_version="1.4", assessment_blueprint={
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 1.0,
             "metrics": [{"endpoint": "garbage", "field": "x", "weight_in_dimension": 1.0}]},
        ],
    })
    with pytest.raises(Exception):
        LessonBundle(**bundle)


def test_rejects_legacy_schema_version_1_2():
    invalid = dict(VALID_BUNDLE, schema_version="1.2")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_schema_version_bumped_to_1_4():
    from lesson_bundle_schema import SCHEMA_VERSION
    assert SCHEMA_VERSION == "1.4"


def test_intro_scene_accepts_evidence():
    from lesson_bundle_schema import IntroScene, Evidence, EnrichmentMetadata
    scene = IntroScene(
        type="intro",
        id="s1",
        title="t",
        objective_refs=[],
        concept_refs=[],
        estimated_seconds=30,
        adaptation_hooks=[],
        markdown="x",
        evidence=Evidence(
            enrichment_metadata=EnrichmentMetadata(
                enricher_version="1.0",
                perspicacite_mode_used="advanced",
                timestamp="2026-05-13T10:00:00Z",
                degraded=False,
            )
        ),
    )
    assert scene.evidence is not None


def test_concept_scene_accepts_evidence():
    from lesson_bundle_schema import ConceptScene, Evidence, EnrichmentMetadata
    scene = ConceptScene(
        type="concept",
        id="s2",
        title="c",
        objective_refs=[],
        concept_refs=[],
        estimated_seconds=60,
        adaptation_hooks=[],
        markdown="y",
        evidence=Evidence(
            enrichment_metadata=EnrichmentMetadata(
                enricher_version="1.0",
                perspicacite_mode_used="basic",
                timestamp="2026-05-13T10:00:00Z",
                degraded=False,
            )
        ),
    )
    assert scene.evidence is not None


def test_reproduction_scene_accepts_evidence():
    from lesson_bundle_schema import ReproductionScene, ReproductionStep, Evidence, EnrichmentMetadata
    scene = ReproductionScene(
        type="reproduction",
        id="s3",
        title="r",
        objective_refs=[],
        concept_refs=[],
        estimated_seconds=120,
        adaptation_hooks=[],
        task_card_id="tc-001",
        steps=[ReproductionStep(
            step_id="st1",
            instruction="x",
            expected_input_schema={"type": "object"},
            expected_output="y",
        )],
        evidence=Evidence(
            enrichment_metadata=EnrichmentMetadata(
                enricher_version="1.0",
                perspicacite_mode_used="profound",
                timestamp="2026-05-13T10:00:00Z",
                degraded=False,
            )
        ),
    )
    assert scene.evidence is not None


def test_rejects_legacy_schema_version_1_3():
    invalid = dict(VALID_BUNDLE, schema_version="1.3")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def _minimal_bundle_dict() -> dict:
    return dict(VALID_BUNDLE)


def test_bundle_accepts_universes():
    d = _minimal_bundle_dict()
    d["universes"] = {"variants": [{"id": "baseline", "description": "d", "decisions": {"prereq_strictness": "standard"}}], "active": "baseline"}
    b = LessonBundle.model_validate(d)
    assert b.universes["active"] == "baseline"


def test_bundle_carries_optional_lwg():
    d = _minimal_bundle_dict()
    d["learning_workflow_graph"] = {"schema_version": "1.0", "course_id": "c", "nodes": [], "edges": []}
    b = LessonBundle.model_validate(d)
    assert b.learning_workflow_graph["course_id"] == "c"


def test_bundle_without_lwg_is_valid():
    b = LessonBundle.model_validate(_minimal_bundle_dict())
    assert b.learning_workflow_graph is None
