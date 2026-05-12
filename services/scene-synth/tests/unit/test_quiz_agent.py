from unittest.mock import MagicMock

from agents.quiz_agent import QuizAgent
from scene_synth_schemas import QuizScene


_VALID_QUIZ_JSON = (
    '{"id": "s_quiz_1", "type": "quiz", "title": "Quiz métabolomique", '
    '"question": "Quelle technique mesure le rapport masse/charge ?", '
    '"choices": ['
    '{"id": "a", "text": "Spectrométrie de masse", "correct": true}, '
    '{"id": "b", "text": "RMN", "correct": false}, '
    '{"id": "c", "text": "Chromatographie", "correct": false}, '
    '{"id": "d", "text": "PCR", "correct": false}'
    '], '
    '"feedback_correct": "Bravo !", '
    '"feedback_incorrect": "La spectrométrie de masse est la bonne réponse.", '
    '"hints": ["Pense à m/z"]'
    '}'
)


def test_quiz_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_QUIZ_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = QuizAgent(llm_client=fake_llm, critic=fake_critic)
    plan_section = {
        "concept_id": "c_ms",
        "objective_text": "Identifier la technique m/z",
        "bloom_level": "understand",
    }
    scene = agent.synthesize(plan_section, context={})

    assert isinstance(scene, QuizScene)
    assert scene.type == "quiz"
    assert len(scene.choices) >= 2


def test_quiz_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = ['{"invalid": true}', _VALID_QUIZ_JSON]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = QuizAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {"concept_id": "c1", "objective_text": "x", "bloom_level": "understand"},
        context={},
    )
    assert scene.type == "quiz"
    assert fake_llm.complete.call_count == 2


def test_quiz_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = QuizAgent(llm_client=fake_llm, critic=fake_critic)
    import pytest
    from agents.base import SceneSynthError
    with pytest.raises(SceneSynthError):
        agent.synthesize(
            {"concept_id": "c1", "objective_text": "x", "bloom_level": "understand"},
            context={},
        )
    assert fake_llm.complete.call_count == 3


def test_quiz_agent_choices_have_exactly_one_correct():
    """Couverture additionnelle : invariant ``une seule bonne réponse``."""
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_QUIZ_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = QuizAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(
        {"concept_id": "c1", "objective_text": "x", "bloom_level": "understand"},
        context={},
    )
    correct_count = sum(1 for choice in scene.choices if choice.correct)
    assert correct_count == 1, (
        f"un quiz QCM standard doit avoir exactement une bonne réponse, "
        f"trouvé {correct_count}"
    )
