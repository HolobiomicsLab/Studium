from unittest.mock import MagicMock

from agents.intro_agent import IntroAgent
from scene_synth_schemas import IntroScene


def test_intro_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = (
        '{"id": "s1", "type": "intro", "title": "Bienvenue", '
        '"markdown": "Ce cours porte sur la métabolomique."}'
    )
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = IntroAgent(llm_client=fake_llm, critic=fake_critic)
    plan_section = {"objective_text": "Introduire la métabolomique", "concept_ids": ["c1"]}
    scene = agent.synthesize(plan_section, context={})

    assert isinstance(scene, IntroScene)
    assert scene.type == "intro"
    assert "métabolomique" in scene.markdown.lower()


def test_intro_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = [
        '{"invalid": true}',
        '{"id": "s1", "type": "intro", "title": "T", "markdown": "B"}',
    ]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = IntroAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize({"objective_text": "x", "concept_ids": []}, context={})
    assert scene.type == "intro"
    assert fake_llm.complete.call_count == 2


def test_intro_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = IntroAgent(llm_client=fake_llm, critic=fake_critic)
    import pytest
    from agents.base import SceneSynthError
    with pytest.raises(SceneSynthError):
        agent.synthesize({"objective_text": "x", "concept_ids": []}, context={})
    assert fake_llm.complete.call_count == 3
