"""Tests unitaires de ``AICritiqueAgent`` (A2 — A.5).

Convention rule 003 : 3 tests standards (succès, retry, échec) +
2 extras (claims >= 2 ; rubric weights ≈ 1.0).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from agents.ai_critique_agent import AICritiqueAgent
from scene_synth_schemas import AICritiqueScene


_VALID_CRITIQUE_JSON = (
    '{"id": "s_aicrit_1", "type": "ai_critique", "title": "Critique sur biais",'
    ' "claims": ['
    '  {"id": "c1", "text": "L\'auteur omet de mentionner les conditions experimentales.", "flaws_expected": ["bias_omission_methodology"]},'
    '  {"id": "c2", "text": "Le resultat est generalisable a toutes les especes.", "flaws_expected": ["overgeneralization"]}'
    ' ],'
    ' "rubric": {"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2}}'
)


def test_ai_critique_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_CRITIQUE_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = AICritiqueAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {"objective_text": "Esprit critique", "concept_id": "c1"}, context={}
    )

    assert isinstance(scene, AICritiqueScene)
    assert scene.type == "ai_critique"
    assert len(scene.claims) >= 2
    weights_sum = (
        scene.rubric.completeness + scene.rubric.evidence_quality + scene.rubric.tone
    )
    assert abs(weights_sum - 1.0) < 0.05


def test_ai_critique_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = ['{"invalid": true}', _VALID_CRITIQUE_JSON]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = AICritiqueAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {"objective_text": "x", "concept_id": "c1"}, context={}
    )

    assert scene.type == "ai_critique"
    assert fake_llm.complete.call_count == 2


def test_ai_critique_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = AICritiqueAgent(llm_client=fake_llm, critic=fake_critic)

    import pytest

    from agents.base import SceneSynthError

    with pytest.raises(SceneSynthError):
        agent.synthesize({"objective_text": "x", "concept_id": "c1"}, context={})
    assert fake_llm.complete.call_count == 3
