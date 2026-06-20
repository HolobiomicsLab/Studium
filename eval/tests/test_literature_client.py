from __future__ import annotations
import json, sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(EVAL_DIR))
sys.path.insert(0, str(REPO_ROOT / "packages" / "perspicacite-client" / "python"))

from harness.literature_client import LiteratureSearchClient  # noqa: E402


class _FakeSession:
    def __init__(self, inner: dict):
        # wrap inner JSON in the MCP tools/call envelope that _unwrap expects
        self._payload = {"result": {"content": [{"text": json.dumps(inner)}]}}
        self.calls = []

    def call_tool(self, *, tool_name: str, arguments: dict):
        self.calls.append((tool_name, arguments))
        return self._payload


def test_maps_search_literature_papers_to_docs():
    inner = {"success": True, "papers": [
        {"title": "Cell theory", "year": 2020, "doi": "10.1/x",
         "authors": ["Doe J", "Roe K"], "abstract": "Cells are units of life.", "relevance_score": 0.9},
        {"title": "No DOI paper", "year": 2019, "authors": [], "abstract": "x" * 800},
    ]}
    sess = _FakeSession(inner)
    client = LiteratureSearchClient(session=sess)
    out = client.search(query="Eukaryotic Cells", mode="passages", max_results=5, kb_names=[])
    assert out["status"] == "ok" and len(out["docs"]) == 2
    assert sess.calls[0][0] == "search_literature"
    assert sess.calls[0][1]["query"] == "Eukaryotic Cells"
    assert sess.calls[0][1]["min_relevance"] == 0.3
    assert sess.calls[0][1]["relevance_method"] == "rerank"
    d0 = out["docs"][0]
    assert d0["doi"] == "10.1/x" and d0["title"] == "Cell theory" and d0["authors"] == ["Doe J", "Roe K"]
    assert out["docs"][1]["excerpt"] == "x" * 500  # abstract truncated to 500
    assert out["docs"][1]["id"] == "No DOI paper"  # falls back to title when no doi/id


def test_min_relevance_is_configurable():
    sess = _FakeSession({"success": True, "papers": []})
    LiteratureSearchClient(session=sess, min_relevance=0.7).search(
        query="q", mode="passages", max_results=3, kb_names=[])
    assert sess.calls[0][1]["min_relevance"] == 0.7


def test_search_status_distinguishes_failure_modes():
    # tool RAN but reported failure -> "error" (not the same as unreachable)
    assert LiteratureSearchClient(session=_FakeSession({"success": False})).search(
        query="q", mode="passages", max_results=3, kb_names=[])["status"] == "error"
    # success but ZERO papers -> "empty": the search ran and the DBs returned nothing; this must
    # NOT be conflated with "offline" (an unreachable backend), or it misdirects diagnosis.
    assert LiteratureSearchClient(session=_FakeSession({"success": True, "papers": []})).search(
        query="q", mode="passages", max_results=3, kb_names=[])["status"] == "empty"
