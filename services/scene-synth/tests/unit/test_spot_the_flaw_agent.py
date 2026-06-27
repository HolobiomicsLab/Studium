"""Tests unitaires de ``SpotTheFlawAgent`` (capsule-grounded judgment scene).

Convention rule 002/003 : 3 tests standards (succès, retry, échec) + 2 extras :
- l'ancrage (reference_run) est injecté dans le prompt rendu ;
- le « cadran de fiabilité » (trustworthiness.n_flaws) change le prompt
  (la subtilité/le nombre de défauts est paramétrable par l'auteur, pas codé en dur).

Hermétique : LLM + critic mockés, aucune clé API, aucune capsule exécutée.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from jinja2 import Template

from agents.spot_the_flaw_agent import SpotTheFlawAgent
from agents.base import SceneSynthError
from scene_synth_schemas import SpotTheFlawScene


# a valid spot_the_flaw scene whose flawed reading + correction are anchored on a REAL landmark
_VALID_FLAW_JSON = (
    '{"id": "s_flaw_1", "type": "spot_the_flaw", "title": "Lecture IA du k mesuré",'
    ' "concept_refs": ["c-kinetics"],'
    ' "flawed_content": "Le fit donne k=0.42 : reaction lente, demi-vie au-dela d une heure.",'
    ' "claims": [{"id": "f1", "text": "demi-vie > 1 h", "flaws_expected": ["demi-vie", "unites"]}],'
    ' "model_correction": "k=0.42 par unite de temps -> demi-vie ~1.65, pas une heure.",'
    ' "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1}}'
)

_REFERENCE_RUN = {
    "title": "Estimate a first-order rate constant",
    "research_question": "What is k (and the half-life) of a first-order decay?",
    "landmark": "LANDMARK k_fit=0.4212 half_life=1.6457",
    "checks": [{"check": "file exists: outputs/stats.csv", "passed": True}],
}


def _outline(n_flaws: int = 1, level: str = "subtle") -> dict:
    return {
        "objective_text": "Auditer une lecture IA d'un resultat reel",
        "concept_id": "c-kinetics",
        "concept_refs": ["c-kinetics"],
        "reference_run": _REFERENCE_RUN,
        "trustworthiness": {"level": level, "n_flaws": n_flaws, "guidance": "subtil et credible"},
    }


def test_spot_the_flaw_agent_synthesizes_valid_scene():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = _VALID_FLAW_JSON
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = SpotTheFlawAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(_outline(), context={})

    assert isinstance(scene, SpotTheFlawScene)
    assert scene.type == "spot_the_flaw"
    assert len(scene.claims) >= 1
    assert scene.claims[0].flaws_expected  # answer key non-empty (RC-1)
    assert scene.model_correction


def test_spot_the_flaw_agent_retries_on_validation_error():
    fake_llm = MagicMock()
    fake_llm.complete.side_effect = ['{"invalid": true}', _VALID_FLAW_JSON]
    fake_critic = MagicMock()
    fake_critic.review.return_value.passed = True

    agent = SpotTheFlawAgent(llm_client=fake_llm, critic=fake_critic)
    scene = agent.synthesize(_outline(), context={})

    assert scene.type == "spot_the_flaw"
    assert fake_llm.complete.call_count == 2


def test_spot_the_flaw_agent_fails_after_3_attempts():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"invalid": true}'
    fake_critic = MagicMock()

    agent = SpotTheFlawAgent(llm_client=fake_llm, critic=fake_critic)
    with pytest.raises(SceneSynthError):
        agent.synthesize(_outline(), context={})
    assert fake_llm.complete.call_count == 3


def test_prompt_grounds_in_the_real_run():
    """The rendered prompt injects the REAL landmark + question — the scene is anchored on
    a genuine execution, not free-floating prose."""
    template = Template(SpotTheFlawAgent.prompt_path.read_text())
    rendered = template.render(plan_section=_outline(), context={}, last_error=None, evidence_block="")
    assert "LANDMARK k_fit=0.4212" in rendered
    assert "first-order decay" in rendered


def test_trustworthiness_dial_is_authorable_not_hardcoded():
    """Varying trustworthiness.n_flaws changes the prompt — the flaw count/subtlety is an
    AUTHORED dial (so output trustworthiness can be deliberately varied for calibration)."""
    template = Template(SpotTheFlawAgent.prompt_path.read_text())
    subtle = template.render(plan_section=_outline(n_flaws=1, level="subtle"), context={}, last_error=None, evidence_block="")
    blatant = template.render(plan_section=_outline(n_flaws=3, level="blatant"), context={}, last_error=None, evidence_block="")
    assert subtle != blatant
    assert "EXACTEMENT 1 défaut" in subtle
    assert "EXACTEMENT 3 défaut" in blatant
