"""Tests unitaires pour ``ReproductionAgent`` (A.4).

Vérifie :
- chargement du ``task_card`` ABS depuis la capsule fixture
  (``fixtures/m2/abs_capsule_minimal/``) et injection dans le prompt rendu ;
- avertissement (``context["warnings"]``) lorsque le ``task_card_id`` demandé
  n'existe pas dans la capsule.
"""

from unittest.mock import MagicMock

from agents.reproduction_agent import ReproductionAgent
from scene_synth_schemas import ReproductionScene


def test_reproduction_agent_uses_abs_capsule(fixture_dir):
    fake_llm = MagicMock()
    fake_llm.complete.return_value = (
        '{"id": "s_repro", "type": "reproduction", "title": "Repro task_001", '
        '"task_card_id": "task_001", '
        '"steps": [{"step_id": "1", "instruction": "Mesurer pH", '
        '"expected_input_schema": {"type": "number"}, "expected_output": "7.4"}], '
        '"prov_derived_from": "ro-crate://abs_capsule_minimal/task_001"}'
    )
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = ReproductionAgent(
        llm_client=fake_llm,
        critic=fake_critic,
        abs_capsule_root=fixture_dir / "m2" / "abs_capsule_minimal",
    )
    plan_section = {
        "objective_text": "Reproduire la mesure de pH",
        "abs_task_card_id": "task_001",
    }
    context: dict = {}
    scene = agent.synthesize(plan_section, context=context)

    assert isinstance(scene, ReproductionScene)
    assert scene.task_card_id == "task_001"
    assert len(scene.steps) >= 1
    rendered = fake_llm.complete.call_args[0][0]
    assert "task_001" in rendered
    # No warning expected when the task_card resolves successfully.
    assert not context.get("warnings")


def test_reproduction_agent_warns_when_abs_missing(tmp_path):
    fake_llm = MagicMock()
    fake_llm.complete.return_value = (
        '{"id": "s", "type": "reproduction", "title": "T", '
        '"task_card_id": "task_999", '
        '"steps": [{"step_id": "1", "instruction": "x", '
        '"expected_input_schema": {}, "expected_output": "y"}]}'
    )
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = ReproductionAgent(
        llm_client=fake_llm,
        critic=fake_critic,
        abs_capsule_root=tmp_path,
    )
    context: dict = {"warnings": []}
    scene = agent.synthesize(
        {"objective_text": "x", "abs_task_card_id": "task_999"},
        context=context,
    )
    assert isinstance(scene, ReproductionScene)
    assert any("task_999" in w for w in context["warnings"])
