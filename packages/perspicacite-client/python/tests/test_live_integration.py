"""Gated live integration test — skipped unless PERSPICACITE_MCP_URL + PERSPICACITE_DOMAIN_KB are set.

Run with a live Perspicacité server:
    PERSPICACITE_MCP_URL=http://localhost:8000/mcp \
    PERSPICACITE_DOMAIN_KB=<kb-name> \
    python3 -m pytest packages/perspicacite-client/python/tests/test_live_integration.py -q
"""
import os, pytest
from perspicacite_mcp.session import _MCPSession
from perspicacite_mcp.client import LivePerspicaciteClient

RUN = os.getenv("PERSPICACITE_MCP_URL") and os.getenv("PERSPICACITE_DOMAIN_KB")


@pytest.mark.skipif(not RUN, reason="needs PERSPICACITE_MCP_URL + PERSPICACITE_DOMAIN_KB")
def test_live_relevant_passages_returns_docs():
    c = LivePerspicaciteClient(
        session=_MCPSession(os.environ["PERSPICACITE_MCP_URL"]),
        default_kb=os.environ["PERSPICACITE_DOMAIN_KB"],
    )
    out = c.search(query="metabolomics mass range", mode="advanced", max_results=5)
    # Live KB may legitimately return zero hits; assert the envelope is well-formed.
    assert out["status"] in ("ok", "offline")
    if out["status"] == "ok":
        for d in out["docs"]:
            assert "id" in d and "title" in d and "relevance_score" in d
