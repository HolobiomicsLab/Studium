"""Perspicacité MCP client: Protocol + Mock + Live (.search over get_relevant_passages)."""
from __future__ import annotations
import json, os
from typing import Any, Protocol

from .session import _MCPSession
from . import cache as _cache


class PerspicaciteClient(Protocol):
    def search(self, *, query: str, mode: str, max_results: int,
               kb_names: list[str] | None = None) -> dict: ...
    def ensure_course_kb(self, *, course_id: str, corpus_refs: list[dict],
                         keywords: str | None) -> dict: ...


def _unwrap(payload: dict | None) -> dict | None:
    """Unwrap MCP tools/call envelope (result.content[0].text = inner JSON)."""
    if not isinstance(payload, dict):
        return None
    try:
        text = payload["result"]["content"][0]["text"]
    except (KeyError, IndexError, TypeError):
        return payload  # already inner shape (test mock)
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def _normalize(inner: dict | None) -> dict:
    """Perspicacité {success, results|passages:[{chunk_text, score, source}]} → {status, docs}.

    `docs` carry the keys extract_refs requires: id, title, authors, relevance_score
    (+ doi, year, excerpt). Defaults are defensive so extract_refs never KeyErrors.
    """
    if not isinstance(inner, dict) or not inner.get("success"):
        return {"status": "offline", "docs": []}
    hits = inner.get("results") or inner.get("passages") or []
    docs: list[dict] = []
    for h in hits:
        src = h.get("source") or {}
        excerpt = str(h.get("chunk_text") or "")
        if len(excerpt) > 500:
            excerpt = excerpt[:500]
        doi = src.get("doi")
        doc_id = src.get("bibkey") or h.get("chunk_id") or doi or src.get("title") or "unknown"
        docs.append({
            "id": str(doc_id),
            "doi": doi,
            "title": src.get("title") or "(untitled)",
            "authors": src.get("authors") or [],
            "year": src.get("year"),
            "excerpt": excerpt,
            "relevance_score": float(h.get("score") or 0.0),
        })
    return {"status": "ok", "docs": docs}


class LivePerspicaciteClient:
    """Wraps a streamable-HTTP MCP session; .search → get_relevant_passages → {status, docs}."""

    def __init__(self, *, session: Any, default_kb: str) -> None:
        self._session = session
        self._default_kb = default_kb

    def _inner(self, tool_name: str, arguments: dict) -> dict | None:
        return _unwrap(self._session.call_tool(tool_name=tool_name, arguments=arguments))

    def search(self, *, query: str, mode: str, max_results: int,
               kb_names: list[str] | None = None) -> dict:
        kbs = kb_names or ([self._default_kb] if self._default_kb else [])
        cached = _cache.get(kbs, query, max_results)
        if cached is not None:
            return cached
        # M1 evidence: passage-level retrieval (skill: prefer get_relevant_passages over
        # generate_report). `mode` is accepted for interface compat / future M2 grounding.
        payload = self._session.call_tool(
            tool_name="get_relevant_passages",
            arguments={"query": query, "kb_names": kbs, "k": max_results, "adaptive": True},
        )
        out = _normalize(_unwrap(payload))
        if out.get("status") == "ok":          # only cache successful retrievals
            _cache.put(kbs, query, max_results, out)
        return out

    def ensure_course_kb(self, *, course_id: str, corpus_refs: list[dict],
                         keywords: str | None) -> dict:
        kb_name = f"studium-course-{course_id}"
        try:
            listing = self._inner("list_knowledge_bases", {}) or {}
            existing = {kb.get("name") for kb in (listing.get("knowledge_bases") or [])}
            if kb_name in existing:
                return {"kb_name": kb_name, "status": "ready", "added": -1}  # -1 = pre-existing
            if not (self._inner("create_knowledge_base", {"name": kb_name}) or {}).get("success"):
                return {"kb_name": kb_name, "status": "degraded", "added": 0}
            dois = [r["doi"] for r in corpus_refs if r.get("ref_type") == "doi" and r.get("doi")]
            paths = [r["ref_id"] for r in corpus_refs if r.get("ref_type") == "local_file" and r.get("ref_id")]
            added = 0
            if dois:
                added += int((self._inner("add_dois_to_kb", {"kb_name": kb_name, "dois": dois}) or {}).get("added") or 0)
            if paths:
                added += int((self._inner("add_local_papers_to_kb", {"kb_name": kb_name, "paths": paths}) or {}).get("added") or 0)
            if added == 0 and keywords:
                added += int((self._inner("build_kb_from_search", {"kb_name": kb_name, "query": keywords}) or {}).get("added") or 0)
            return {"kb_name": kb_name, "status": "ready" if added >= 1 else "degraded", "added": added}
        except Exception:
            return {"kb_name": kb_name, "status": "degraded", "added": 0}


class MockPerspicaciteClient:
    """Deterministic offline client for tests / disabled mode."""

    def search(self, *, query: str, mode: str, max_results: int,
               kb_names: list[str] | None = None) -> dict:
        return {"status": "ok", "docs": [{
            "id": "mock-doc-1", "doi": "10.1073/pnas.1319030111",
            "title": "Untargeted metabolomics reveals a link between gut microbiota and host energy metabolism",
            "authors": ["Wikoff WR", "Anfora AT"], "year": 2014,
            "excerpt": f"[mock excerpt for: {query[:60]}]", "relevance_score": 0.8,
        }]}

    def ensure_course_kb(self, *, course_id: str, corpus_refs: list[dict],
                         keywords: str | None) -> dict:
        return {"kb_name": f"studium-course-{course_id}", "status": "ready", "added": len(corpus_refs)}


def make_perspicacite_client() -> PerspicaciteClient | None:
    """Factory from env. Returns None when disabled (planner then skips enrichment)."""
    if os.getenv("STUDIUM_PERSPICACITE_ENABLED") != "on":
        return None
    mcp_url = os.getenv("PERSPICACITE_MCP_URL", "http://localhost:8000/mcp")
    default_kb = os.getenv("PERSPICACITE_DOMAIN_KB", "")
    if os.getenv("STUDIUM_PERSPICACITE_MODE") == "mock":
        return MockPerspicaciteClient()
    return LivePerspicaciteClient(session=_MCPSession(mcp_url), default_kb=default_kb)
