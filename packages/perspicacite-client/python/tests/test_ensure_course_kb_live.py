"""Gated live integration test for ensure_course_kb.

Requires:
  - PERSPICACITE_MCP_URL set in environment
  - A running Perspicacité MCP server at that URL

Skip silently if not set (default CI / offline mode).
"""
import os
import pytest

from perspicacite_mcp.session import _MCPSession
from perspicacite_mcp.client import LivePerspicaciteClient


@pytest.mark.skipif(
    not os.getenv("PERSPICACITE_MCP_URL"),
    reason="needs PERSPICACITE_MCP_URL",
)
def test_ensure_course_kb_with_one_oa_doi():
    """Smoke-test: build a per-course KB with one open-access DOI.

    OA DOIs (e.g. PLoS ONE) should be addable; paywalled → degraded is also acceptable.
    Either way, the call must return a valid status envelope.
    """
    c = LivePerspicaciteClient(
        session=_MCPSession(os.environ["PERSPICACITE_MCP_URL"]),
        default_kb="",
    )
    res = c.ensure_course_kb(
        course_id="livetest",
        corpus_refs=[{"ref_type": "doi", "doi": "10.1371/journal.pone.0000308"}],
        keywords=None,
    )
    assert res.get("kb_name") == "studium-course-livetest"
    assert res.get("status") in ("ready", "degraded"), (
        f"unexpected status: {res.get('status')}"
    )
