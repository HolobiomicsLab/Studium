from perspicacite_mcp.client import LivePerspicaciteClient, MockPerspicaciteClient

class _FakeSession:
    def __init__(self, payload): self._payload = payload
    def call_tool(self, *, tool_name, arguments):
        # mimic MCP envelope: result.content[0].text = inner JSON string
        import json
        return {"result": {"content": [{"text": json.dumps(self._payload)}]}}

def _passages_payload():
    return {"success": True, "results": [
        {"chunk_text": "small sample of n=3", "score": 0.91,
         "source": {"doi": "10.1/x", "title": "Paper X", "authors": ["A B"], "year": 2024, "bibkey": "x2024"}},
    ]}

def test_live_search_normalizes_to_status_docs():
    c = LivePerspicaciteClient(session=_FakeSession(_passages_payload()), default_kb="domain-kb")
    out = c.search(query="metabolites size", mode="advanced", max_results=5)
    assert out["status"] == "ok"
    d = out["docs"][0]
    assert d["title"] == "Paper X" and d["doi"] == "10.1/x"
    assert d["excerpt"] == "small sample of n=3" and d["relevance_score"] == 0.91
    assert d["authors"] == ["A B"] and d["id"]  # id always present

def test_live_search_degrades_on_failure():
    class _Dead:
        def call_tool(self, *, tool_name, arguments): return None
    c = LivePerspicaciteClient(session=_Dead(), default_kb="domain-kb")
    assert c.search(query="q", mode="advanced", max_results=5)["status"] != "ok"

def test_mock_client_returns_fixture_docs():
    c = MockPerspicaciteClient()
    out = c.search(query="q", mode="advanced", max_results=5)
    assert out["status"] == "ok" and len(out["docs"]) >= 1
