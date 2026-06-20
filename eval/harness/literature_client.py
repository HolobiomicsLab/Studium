"""KB-less live grounding client: maps Perspicacité `search_literature` -> the
`{status, docs}` shape ground_bundle consumes. Step B (real citations, no KB —
the no-KGmemory constraint). Reuses the prototype MCP session + envelope unwrap."""
from __future__ import annotations

from typing import Any, Optional

# None = let Perspicacité fan out to ALL its domain-appropriate providers (pubmed, europepmc,
# core, google_scholar, scilex, ...). Restricting to a fixed 3 routed everything to a SciLEx-only
# path that found papers but returned 0; unrestricted, the aggregator returns relevant hits.
_DATABASES: Optional[list[str]] = None


class LiteratureSearchClient:
    """`.search()` over the live `search_literature` MCP tool (no knowledge base)."""

    def __init__(self, *, session: Any, databases: Optional[list[str]] = None,
                 min_relevance: float = 0.3) -> None:
        self._session = session
        self._databases = databases or _DATABASES
        self._min_relevance = min_relevance

    def search(self, *, query: str, mode: str, max_results: int,
               kb_names: list[str] | None = None) -> dict:
        # mode / kb_names are ignored: this is KB-less literature search.
        from perspicacite_mcp.client import _unwrap
        try:
            inner = _unwrap(self._session.call_tool(
                tool_name="search_literature",
                arguments={"query": query, "databases": self._databases,
                           "max_results": max_results,
                           "min_relevance": self._min_relevance,
                           "relevance_method": "rerank"},
            ))
        except Exception:
            return {"status": "offline", "docs": []}  # the MCP call itself failed (unreachable)
        if not isinstance(inner, dict) or not inner.get("success"):
            return {"status": "error", "docs": []}    # tool ran but reported failure
        docs = []
        for p in inner.get("papers") or []:
            docs.append({
                "id": str(p.get("doi") or p.get("id") or p.get("title") or "unknown"),
                "doi": p.get("doi"),
                "title": str(p.get("title") or "(untitled)"),
                "authors": list(p.get("authors") or []),
                "year": p.get("year"),
                "excerpt": str(p.get("abstract") or "")[:500],
                "relevance_score": float(p.get("relevance_score") or 0.5),
            })
        # success but 0 papers is NOT "offline" — the search ran and the DBs returned nothing
        # (e.g. Semantic Scholar 429 + the reranker/min_relevance dropping the rest). Label it
        # "empty" so diagnostics don't mistake a degraded retrieval for an unreachable backend.
        return {"status": "ok" if docs else "empty", "docs": docs}

    def ensure_course_kb(self, **kw) -> dict:  # Protocol compat; unused (no KB built)
        return {"kb_name": "", "status": "skipped", "added": 0}
