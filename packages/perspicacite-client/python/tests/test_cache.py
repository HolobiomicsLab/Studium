import os, tempfile
from perspicacite_mcp.client import LivePerspicaciteClient

class _CountingSession:
    def __init__(self): self.n = 0
    def call_tool(self, *, tool_name, arguments):
        import json
        self.n += 1
        inner = {"success": True, "results": [{"chunk_text": "x", "score": 0.5,
                  "source": {"doi": "10.1/x", "title": "X", "authors": []}}]}
        return {"result": {"content": [{"text": json.dumps(inner)}]}}

def test_search_caches_identical_queries(monkeypatch):
    d = tempfile.mkdtemp()
    monkeypatch.setenv("STUDIUM_PERSPICACITE_CACHE_DIR", d)
    monkeypatch.delenv("STUDIUM_PERSPICACITE_CACHE", raising=False)  # on by default
    s = _CountingSession()
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    a = c.search(query="q", mode="advanced", max_results=5)
    b = c.search(query="q", mode="advanced", max_results=5)  # identical → cache hit
    assert a == b and s.n == 1  # only ONE MCP call

def test_cache_off_calls_every_time(monkeypatch):
    monkeypatch.setenv("STUDIUM_PERSPICACITE_CACHE", "off")
    s = _CountingSession()
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    c.search(query="q", mode="advanced", max_results=5)
    c.search(query="q", mode="advanced", max_results=5)
    assert s.n == 2
