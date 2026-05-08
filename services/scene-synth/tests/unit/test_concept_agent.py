from unittest.mock import MagicMock

from agents.concept_agent import ConceptAgent
from scene_synth_schemas import ConceptScene


def test_concept_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = (
        '{"id": "s_concept_1", "type": "concept", "title": "Spectrométrie de masse", '
        '"content": {"markdown": "La spectrométrie de masse mesure le rapport masse/charge."}}'
    )
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = ConceptAgent(llm_client=fake_llm, critic=fake_critic)
    plan_section = {
        "concept_id": "c_ms",
        "def_short": "Mesure le rapport m/z des ions",
        "examples": ["LC-MS", "GC-MS"],
    }
    scene = agent.synthesize(plan_section, context={})

    assert isinstance(scene, ConceptScene)
    assert scene.type == "concept"
    assert "spectrométrie" in scene.content.markdown.lower()


def test_concept_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = [
        '{"invalid": true}',
        '{"id": "s1", "type": "concept", "title": "T", "content": {"markdown": "Définition."}}',
    ]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = ConceptAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {"concept_id": "c1", "def_short": "x", "examples": []}, context={}
    )
    assert scene.type == "concept"
    assert fake_llm.complete.call_count == 2


def test_concept_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = ConceptAgent(llm_client=fake_llm, critic=fake_critic)
    import pytest
    from agents.base import SceneSynthError
    with pytest.raises(SceneSynthError):
        agent.synthesize(
            {"concept_id": "c1", "def_short": "x", "examples": []}, context={}
        )
    assert fake_llm.complete.call_count == 3
