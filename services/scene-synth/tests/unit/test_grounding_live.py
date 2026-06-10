# services/scene-synth/tests/unit/test_grounding_live.py
"""Gated live grounding smoke — only runs when STUDIUM_LIVE_LLM is set.

Intent: call ConceptAgent with a real LLM client and assert the produced
markdown references [1] (i.e. the grounding instruction was followed).

Wire a real LLM client here per the project's llm-client conventions.
This smoke only runs when STUDIUM_LIVE_LLM=1.
"""

import os

import pytest

EV = {
    "bibliographic_refs": [
        {
            "perspicacite_doc_id": "x",
            "title": "Untargeted metabolomics",
            "doi": "10.1073/pnas.1319030111",
            "excerpt": "metabolites are small molecules typically below 1500 Da",
            "relevance_score": 0.9,
        }
    ],
    "enrichment_metadata": {"perspicacite_mode_used": "passages", "degraded": False},
}


@pytest.mark.skipif(
    not os.getenv("STUDIUM_LIVE_LLM"),
    reason="needs a live LLM (STUDIUM_LIVE_LLM=1)",
)
def test_concept_grounded_markdown_cites_a_source():
    # Wire a real LLM client here per the project's llm-client conventions.
    # The smoke asserts the produced markdown references [1].
    pytest.skip("live LLM client not yet wired — set STUDIUM_LIVE_LLM=1 and wire the client")
