"""DOI resolver — wraps Perspicacité MCP client or falls back to offline mode."""
from __future__ import annotations
from typing import Any, Literal

try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False


def resolve_doi(
    doi: str,
    *,
    mode: Literal["real", "offline"] = "offline",
    mcp_url: str = "http://localhost:8001",
    timeout: float = 10.0,
) -> dict[str, Any]:
    """Resolve a DOI via Perspicacité MCP or mark as offline.

    Returns a dict with keys: doi, status ("ok"|"offline"), title, authors, year, journal.
    """
    if mode == "offline" or not _HTTPX_AVAILABLE:
        return {"doi": doi, "status": "offline", "title": None, "authors": [], "year": None, "journal": None}

    try:
        resp = httpx.post(
            f"{mcp_url}/resolve",
            json={"doi": doi},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "doi": doi,
            "status": "ok",
            "title": data.get("title"),
            "authors": data.get("authors", []),
            "year": data.get("year"),
            "journal": data.get("journal"),
        }
    except Exception:
        return {"doi": doi, "status": "offline", "title": None, "authors": [], "year": None, "journal": None}
