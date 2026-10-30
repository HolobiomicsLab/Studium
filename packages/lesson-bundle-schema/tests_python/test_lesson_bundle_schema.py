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


def test_metadata_authoring_is_optional_and_mirrors_zod():
    from lesson_bundle_schema import BundleAuthoring, BundleMetadata

    base = dict(title="T", target="L1", duration_minutes=30, language="fr", discipline="chimie")
    assert BundleMetadata(**base).authoring is None
    meta = BundleMetadata(**base, authoring={"mode": "self_study"})
    assert meta.authoring == BundleAuthoring(mode="self_study", author_is_learner=False, note=None)
    full = BundleAuthoring(mode="self_study", author_is_learner=True, note="Durkheim ch. 1")
    assert full.model_dump() == {
        # learner_profile: declared on 2026-10-30 (RFR-06), optional like in Zod.
        "mode": "self_study", "author_is_learner": True, "drafted_by": None, "note": "Durkheim ch. 1",
        "learner_profile": None,
    }
    import pytest

    with pytest.raises(Exception):
        BundleAuthoring(mode="peer")


@pytest.mark.parametrize("drafted_by", ["agent", "learner", "teacher"])
def test_metadata_authoring_drafted_by_mirrors_zod(drafted_by):
    """C3 (sprint 2026-10-30): who drafted the content and its keys, optional like in Zod."""
    from lesson_bundle_schema import BundleAuthoring

    assert BundleAuthoring(mode="self_study", drafted_by=drafted_by).drafted_by == drafted_by
    assert BundleAuthoring(mode="self_study").drafted_by is None


def test_metadata_authoring_rejects_an_unknown_drafter():
    from lesson_bundle_schema import BundleAuthoring

    with pytest.raises(Exception):
        BundleAuthoring(mode="self_study", drafted_by="model")


_EVIDENCE = {
    "bibliographic_refs": [{
        "perspicacite_doc_id": "p:source:1", "title": "Source", "authors": [], "excerpt": "un extrait exact",
        "relevance_score": 1, "prov_derived_from": "https://example.org/source",
    }],
    "enrichment_metadata": {
        "enricher_version": "test/1", "perspicacite_mode_used": "passages",
        "timestamp": "2026-10-30T00:00:00Z", "degraded": False,
    },
}
_RUBRIC = {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1}
_KEY_POINTS = [{"id": "kp1", "text": "k", "cues": ["k"]}]
_FLAW_CLAIMS = [{"id": "c1", "text": "t", "flaws_expected": ["f"]}]
_SCENE_FIELDS = {
    "intro": {"markdown": "m"},
    "concept": {"markdown": "m"},
    "quiz": {"question": "q", "choices": [{"id": "a", "text": "A", "correct": True}, {"id": "b", "text": "B", "correct": False}],
             "feedback_correct": "y", "feedback_incorrect": "n"},
    "meta_checkpoint": {"pre_question": "a", "post_question": "b", "scale_labels": ["1", "2", "3", "4", "5"]},
    "reproduction": {"task_card_id": "t", "steps": [{"step_id": "1", "instruction": "i", "expected_input_schema": {}, "expected_output": "o"}]},
    "ai_critique": {"claims": _FLAW_CLAIMS, "rubric": _RUBRIC},
    "discussion": {"topic": "t", "seed_claim": "s", "target_signals": ["justification"], "max_turns": 4},
    "spot_the_flaw": {"flawed_content": "x", "claims": _FLAW_CLAIMS, "model_correction": "f", "rubric": _RUBRIC},
    "explain_back": {"prompt": "p", "key_points": _KEY_POINTS, "model_explanation": "m", "rubric": _RUBRIC},
    "comparison": {"prompt": "p", "artifact_a": "a", "artifact_b": "b", "key_points": _KEY_POINTS, "model_answer": "m", "rubric": _RUBRIC},
    "summary_audit": {"source_content": "s", "ai_summary": "a", "claims": _FLAW_CLAIMS, "model_correction": "f", "rubric": _RUBRIC},
    "prompt_practice": {"task": "t", "key_points": _KEY_POINTS, "model_prompt": "m", "rubric": _RUBRIC},
    "communication_sim": {"scenario": "s", "prompt": "p", "key_points": _KEY_POINTS, "model_response": "m", "rubric": _RUBRIC},
}


def test_scene_evidence_fixture_covers_every_scene_type():
    from typing import get_args
    from lesson_bundle_schema import SceneType

    assert sorted(_SCENE_FIELDS) == sorted(get_args(SceneType))


@pytest.mark.parametrize("scene_type", sorted(_SCENE_FIELDS))
def test_every_scene_type_keeps_its_evidence(scene_type):
    """Mirror of scene-evidence.test.ts: evidence is declared on every scene since 2026-10-30."""
    from pydantic import TypeAdapter
    from lesson_bundle_schema import Scene

    scene = {"id": f"s-{scene_type}", "type": scene_type, "title": "T", "concept_refs": ["c1"],
             **_SCENE_FIELDS[scene_type], "evidence": _EVIDENCE}
    parsed = TypeAdapter(Scene).validate_python(scene)
    assert parsed.evidence is not None
    assert parsed.evidence.model_dump(mode="json", exclude_none=True) == _EVIDENCE


def test_metadata_authoring_learner_profile_mirrors_zod():
    """RFR-06: only the scheduling part of the learner's intake travels with a lesson."""
    from lesson_bundle_schema import BundleAuthoring

    a = BundleAuthoring(mode="self_study", learner_profile={"minutes_per_day": 20, "target_date": "2026-12-01"})
    assert a.learner_profile.minutes_per_day == 20 and a.learner_profile.target_date == "2026-12-01"
    # Like Zod's z.object, unknown keys are dropped, so an older lesson holding prior/interests still reads.
    old = BundleAuthoring(mode="self_study", learner_profile={"prior": "lycée", "minutes_per_day": 10})
    assert old.learner_profile.model_dump() == {"minutes_per_day": 10, "target_date": None}
    for bad in ({"minutes_per_day": 0}, {"minutes_per_day": 601}, {"target_date": "1er décembre"}):
        with pytest.raises(Exception):
            BundleAuthoring(mode="self_study", learner_profile=bad)
