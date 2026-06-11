import json
from agents.graph_agent import GraphAgent

CONCEPTS = [
    {"id": "concept:obj-fourier", "bloom_level": "understand", "title": "Fourier transform"},
    {"id": "concept:obj-fft", "bloom_level": "apply", "title": "FFT"},
]


def test_prompt_lists_concepts_and_asks_for_json(monkeypatch):
    agent = GraphAgent()
    captured = {}
    monkeypatch.setattr(agent, "_call_llm", lambda msg: captured.setdefault("msg", msg) or '{"edges": []}')
    agent.propose_prerequisites(CONCEPTS)
    assert "concept:obj-fft" in captured["msg"] and "FFT" in captured["msg"]
    assert "edges" in captured["msg"] and "source" in captured["msg"]


def test_parses_edges_from_llm_json(monkeypatch):
    agent = GraphAgent()
    monkeypatch.setattr(agent, "_call_llm",
        lambda msg: json.dumps({"edges": [{"source": "concept:obj-fft", "target": "concept:obj-fourier", "rationale": "needs FT first"}]}))
    edges = agent.propose_prerequisites(CONCEPTS)
    assert edges == [{"source": "concept:obj-fft", "target": "concept:obj-fourier", "rationale": "needs FT first"}]


def test_mock_response_is_valid_empty_json():
    agent = GraphAgent()
    parsed = json.loads(agent._mock_response())
    assert parsed == {"edges": []}


def test_malformed_llm_output_yields_no_edges(monkeypatch):
    agent = GraphAgent()
    monkeypatch.setattr(agent, "_call_llm", lambda msg: "not json")
    assert agent.propose_prerequisites(CONCEPTS) == []
