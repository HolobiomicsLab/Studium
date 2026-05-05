import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch


SAMPLE_MANIFEST = {
    "manifest_id": "m-001",
    "target": "L3",
    "duration_minutes": 45,
    "language": "fr",
    "keywords": "metabolomics",
    "corpus_refs": [
        {"ref_id": "ref-1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}
    ],
    "text_preview": "Metabolomics is the study of metabolites.",
}


def test_generate_returns_lesson_plan():
    from mimosa_wrapper import generate
    from schemas import LessonPlan
    plan = generate(SAMPLE_MANIFEST, target="L3")
    assert isinstance(plan, LessonPlan)
    assert plan.target == "L3"
    assert len(plan.learning_objectives) >= 1
    assert len(plan.scene_outlines) >= 1
    assert plan.status == "draft"


def test_generate_validates_pydantic():
    """Result must always pass Pydantic validation (rule 002)."""
    from mimosa_wrapper import generate
    from schemas import LessonPlan
    plan = generate(SAMPLE_MANIFEST, target="M1")
    # Re-validate by constructing from dict
    plan_dict = plan.model_dump()
    plan2 = LessonPlan(**plan_dict)
    assert plan2.id == plan.id


def test_generate_sets_corpus_refs():
    from mimosa_wrapper import generate
    plan = generate(SAMPLE_MANIFEST, target="L3")
    assert len(plan.corpus_refs) >= 1


def test_generate_includes_audit_trace():
    from mimosa_wrapper import generate, get_last_audit
    generate(SAMPLE_MANIFEST, target="L3")
    audit = get_last_audit()
    assert audit is not None
    assert "provider" in audit
    assert "alias" in audit
    assert "status" in audit
