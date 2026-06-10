from unittest.mock import MagicMock
from agents.concept_agent import ConceptAgent

_VALID_CONCEPT = '{"id": "s_concept_1", "type": "concept", "title": "T", "markdown": "Déf [1]."}'
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
