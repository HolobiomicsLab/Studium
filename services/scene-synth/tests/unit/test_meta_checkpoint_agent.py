from unittest.mock import MagicMock

from agents.meta_checkpoint_agent import MetaCheckpointAgent
from scene_synth_schemas import MetaCheckpointScene


_VALID_META_JSON = (
    '{"id": "s_meta_1", "type": "meta_checkpoint", '
    '"title": "Calibration confiance", '
    '"content": {'
    '"pre_question": "À quel point te sens-tu prêt·e sur ce concept ?", '
    '"post_question": "Après cette section, à quel point te sens-tu prêt·e ?", '
    '"scale_labels": ['
    '"Pas du tout", "Peu", "Moyennement", "Bien", "Très bien"'
    ']'
    '}}'
)


def test_meta_checkpoint_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_META_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = MetaCheckpointAgent(llm_client=fake_llm, critic=fake_critic)
    plan_section = {
        "concept_id": "c_ms",
        "objective_text": "Identifier la technique m/z",
        "checkpoint_position": "post_concept",
    }
    scene = agent.synthesize(plan_section, context={})

    assert isinstance(scene, MetaCheckpointScene)
    assert scene.type == "meta_checkpoint"
    assert scene.content.pre_question
    assert scene.content.post_question


def test_meta_checkpoint_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = ['{"invalid": true}', _VALID_META_JSON]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = MetaCheckpointAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {
            "concept_id": "c1",
            "objective_text": "x",
            "checkpoint_position": "post_concept",
        },
        context={},
    )
    assert scene.type == "meta_checkpoint"
    assert fake_llm.complete.call_count == 2


def test_meta_checkpoint_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = MetaCheckpointAgent(llm_client=fake_llm, critic=fake_critic)
    import pytest
    from agents.base import SceneSynthError
    with pytest.raises(SceneSynthError):
        agent.synthesize(
            {
                "concept_id": "c1",
                "objective_text": "x",
                "checkpoint_position": "post_concept",
            },
            context={},
        )
    assert fake_llm.complete.call_count == 3


def test_meta_checkpoint_agent_scale_has_exactly_5_labels():
    """Couverture additionnelle : invariant Likert 5 points."""
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_META_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = MetaCheckpointAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {
            "concept_id": "c1",
            "objective_text": "x",
            "checkpoint_position": "post_concept",
        },
        context={},
    )
    assert len(scene.content.scale_labels) == 5
