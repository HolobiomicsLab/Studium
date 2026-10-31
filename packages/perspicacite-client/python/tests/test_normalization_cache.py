"""A cached response from the obsolete parser must not conceal live passages."""
import hashlib
import json

from perspicacite_mcp.client import LivePerspicaciteClient


def test_old_lossy_cache_is_not_reused(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIUM_PERSPICACITE_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("STUDIUM_PERSPICACITE_CACHE", "on")
    old_key = hashlib.sha256(json.dumps({"kb": ["paper"], "q": "precursor", "k": 1}, sort_keys=True).encode()).hexdigest()
    old_path = tmp_path / f"{old_key}.json"
    old_path.write_text(json.dumps({"status": "ok", "docs": [{"id": "old", "excerpt": "", "doi": None}]}))

    class Session:
        calls = 0

        def call_tool(self, **kwargs):
            self.calls += 1
            return {"success": True, "passages": [{"text": "The precursor mass is an input.", "source_doi": "10.1234/test", "score": 0.8}]}

    session = Session()
    client = LivePerspicaciteClient(session=session, default_kb="paper")
    result = client.search(query="precursor", mode="basic", max_results=1)
    assert result["docs"][0]["excerpt"] == "The precursor mass is an input."
    assert result["docs"][0]["doi"] == "10.1234/test"
    assert session.calls == 1
    assert client.search(query="precursor", mode="basic", max_results=1) == result
    assert session.calls == 1
    assert old_path.exists()
