"""KB-less live grounding client: maps Perspicacité `search_literature` -> the
`{status, docs}` shape ground_bundle consumes. Step B (real citations, no KB —
the no-KGmemory constraint). Reuses the prototype MCP session + envelope unwrap."""
from __future__ import annotations

from typing import Any, Optional

_DATABASES = ["semantic_scholar", "openalex", "arxiv"]


class LiteratureSearchClient:
    """`.search()` over the live `search_literature` MCP tool (no knowledge base)."""

    def __init__(self, *, session: Any, databases: Optional[list[str]] = None) -> None:
        self._session = session
        self._databases = databases or _DATABASES

    def search(self, *, query: str, mode: str, max_results: int,
               kb_names: list[str] | None = None) -> dict:
        # mode / kb_names are ignored: this is KB-less literature search.
        from perspicacite_mcp.client import _unwrap
        try:
            inner = _unwrap(self._session.call_tool(
                tool_name="search_literature",
                arguments={"query": query, "databases": self._databases, "max_results": max_results},
            ))
        except Exception:
            return {"status": "offline", "docs": []}
        if not isinstance(inner, dict) or not inner.get("success"):
            return {"status": "offline", "docs": []}
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
        return {"status": "ok" if docs else "offline", "docs": docs}

    def ensure_course_kb(self, **kw) -> dict:  # Protocol compat; unused (no KB built)
        return {"kb_name": "", "status": "skipped", "added": 0}
