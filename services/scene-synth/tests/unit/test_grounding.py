import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from agents.ai_critique_agent import AICritiqueAgent
from agents.concept_agent import ConceptAgent
from agents.reproduction_agent import ReproductionAgent

_VALID_CONCEPT = '{"id": "s_concept_1", "type": "concept", "title": "T", "markdown": "Déf [1]."}'

_VALID_REPRODUCTION = (
    '{"id": "s_repro_1", "type": "reproduction", "title": "Mesure pH", '
    '"task_card_id": "tc1", '
    '"steps": [{"step_id": "1", "instruction": "Calibrer le pH-mètre [1].", '
    '"expected_input_schema": {"type": "number"}, "expected_output": "7.0"}]}'
)

_VALID_AI_CRITIQUE = (
    '{"id": "s_aicrit_1", "type": "ai_critique", "title": "Critique biais [1]", '
    '"claims": ['
    '{"id": "c1", "text": "Le résultat est généralisable [1].", "flaws_expected": ["overgeneralization"]},'
    '{"id": "c2", "text": "L\'auteur omet les contrôles.", "flaws_expected": ["bias_omission_methodology"]}'
    '], '
    '"rubric": {"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2}}'
)

EV = {"bibliographic_refs": [
        {"perspicacite_doc_id": "x", "title": "Paper X", "excerpt": "n=3 small sample", "relevance_score": 0.9}],
      "enrichment_metadata": {"perspicacite_mode_used": "passages", "degraded": False}}

def _agent(ret=_VALID_CONCEPT):
    llm = MagicMock(); llm.complete.return_value = ret
    critic = MagicMock(); critic.review.return_value.passed = True
    return ConceptAgent(llm_client=llm, critic=critic), llm

def test_concept_prompt_includes_grounding_when_evidence_present():
    agent, llm = _agent()
    agent.synthesize({"concept_id": "c", "def_short": "d", "examples": [], "evidence": EV}, context={})
    prompt = llm.complete.call_args[0][0]
    assert "Sources disponibles" in prompt and "n=3 small sample" in prompt
    assert "ne fabrique pas" in prompt.lower() or "cite" in prompt.lower()

def test_concept_prompt_omits_grounding_when_no_evidence():
    agent, llm = _agent()
    agent.synthesize({"concept_id": "c", "def_short": "d", "examples": []}, context={})
    prompt = llm.complete.call_args[0][0]
    assert "Sources disponibles" not in prompt   # graceful fallback


def test_reproduction_prompt_grounds_in_evidence():
    llm = MagicMock()
    llm.complete.return_value = _VALID_REPRODUCTION
    critic = MagicMock()
    critic.review.return_value.passed = True
    capsule_root = Path(tempfile.mkdtemp())
    ReproductionAgent(llm_client=llm, critic=critic, abs_capsule_root=capsule_root).synthesize(
        {"task_card_id": "tc1", "abs_task_card_id": "tc1", "steps": [], "evidence": EV,
         "objective_text": "Mesurer le pH"},
        context={},
    )
    assert "Sources disponibles" in llm.complete.call_args[0][0]


def test_ai_critique_prompt_grounds_in_evidence():
    llm = MagicMock()
    llm.complete.return_value = _VALID_AI_CRITIQUE
    critic = MagicMock()
    critic.review.return_value.passed = True
    AICritiqueAgent(llm_client=llm, critic=critic).synthesize(
        {"claims": [], "evidence": EV, "objective_text": "Esprit critique", "concept_id": "c1"},
        context={},
    )
    assert "Sources disponibles" in llm.complete.call_args[0][0]
