"""Tests pour _evaluate_enrichment du CriticAgent."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))

import pytest
from lesson_plan_schema import SceneOutline, SceneType
from agents.critic_agent import CriticAgent


@pytest.mark.parametrize("scene_type, override, expected", [
    (SceneType.intro, None, True),
    (SceneType.concept, None, True),
    (SceneType.simulation, None, True),
    (SceneType.reproduction, None, True),
    (SceneType.quiz, None, False),
    (SceneType.discussion, None, False),
    (SceneType.meta_checkpoint, None, False),
    (SceneType.ai_critique, None, False),
    (SceneType.quiz, "force", True),         # override gagne
    (SceneType.intro, "skip", False),         # override gagne
])
def test_evaluate_enrichment_matrix(scene_type, override, expected):
    scene = SceneOutline(
        id="s",
        type=scene_type,
        title="t",
        evidence_override=override,
    )
    agent = CriticAgent()
    assert agent._evaluate_enrichment(scene) is expected
