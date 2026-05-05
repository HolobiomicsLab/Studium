"""Tests Pydantic mirror for lesson-schema v1 (ADR 003)."""
import json
import pathlib
import pytest

SAMPLE_PATH = pathlib.Path(__file__).parents[3] / "architecture" / "examples" / "lesson_sample.json"


def test_sample_valid_pydantic():
    from lesson_schema import Lesson

    sample = json.loads(SAMPLE_PATH.read_text())
    lesson = Lesson.model_validate(sample)
    assert lesson.schema_version == "1.0"


def test_invalid_raises():
    from lesson_schema import Lesson
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Lesson.model_validate({})


def test_scene_types_exhaustive():
    from lesson_schema import SceneType

    expected = {"intro", "concept", "quiz", "simulation", "reproduction", "discussion", "meta_checkpoint", "ai_critique"}
    assert {t.value for t in SceneType} == expected
