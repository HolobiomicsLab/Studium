"""Backend grounding step for the eval harness (REVIEW-FINDINGS #7 / ADR 014).

Attaches citable evidence so audit.py:_score_grounding rises off the 0.30 floor:
grounds LWG edges (adds `evidence`, drops the `ungrounded` flag) and attaches an
`Evidence` block to intro/concept scenes. Reuses the prototype's real
PerspicaciteClient (mock = deterministic/offline; live = :8002 KB-less search).

Honesty contract: an edge/scene is grounded ONLY when retrieval returns docs; a
degraded retrieval leaves the edge `ungrounded` and the scene un-evidenced, so the
auditor keeps reporting the real gap rather than a fake lift.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

_GROUNDING_SCENE_TYPES = ("intro", "concept")


def _to_ref(doc: dict) -> dict:
    """Map a Perspicacité docs[] entry -> a scene_synth_schemas.BibliographicRef dict."""
    excerpt = str(doc.get("excerpt") or "")[:500] or "(no excerpt)"
    return {
        "perspicacite_doc_id": str(doc.get("id") or "unknown"),
        "doi": doc.get("doi"),
        "title": str(doc.get("title") or "(untitled)"),
        "authors": list(doc.get("authors") or []),
        "year": doc.get("year"),
        "excerpt": excerpt,
        "relevance_score": max(0.0, min(1.0, float(doc.get("relevance_score") or 0.0))),
        "prov_derived_from": "eval-harness-grounding:passages",
    }


def _docs(client: Any, query: str, kb_names: list[str], k: int) -> list[dict]:
    try:
        resp = client.search(query=query, mode="passages", max_results=k, kb_names=kb_names)
    except Exception:
        return []
    return (resp.get("docs") or []) if resp.get("status") == "ok" else []


def ground_bundle(scenes: list[dict], lwg: Optional[dict], client: Any,
                  kb_names: Optional[list[str]] = None) -> dict:
    """Mutate `scenes` + `lwg` in place, attaching evidence where retrieval succeeds.

    Returns {edges_total, edges_grounded, scenes_total, scenes_enriched}.
    """
    kbs = kb_names or []
    now = datetime.now(timezone.utc).isoformat()

    edges = (lwg or {}).get("edges") or []
    edges_grounded = 0
    for edge in edges:
        anchor = edge.get("source") or edge.get("id") or ""
        docs = _docs(client, f"evidence for prerequisite relation {anchor}", kbs, 3)
        if not docs:
            continue
        d = docs[0]
        # LWG is dict[str, Any] (loose) -> ad-hoc evidence shape is fine here;
        # scene evidence below is strict (scene_synth_schemas.Evidence).
        edge["evidence"] = [{
            "doi": d.get("doi"),
            "quote": str(d.get("excerpt") or "")[:240],
            "confidence": float(d.get("relevance_score") or 0.0),
        }]
        edge["quality_flags"] = [f for f in (edge.get("quality_flags") or []) if f != "ungrounded"]
        edges_grounded += 1

    targets = [s for s in scenes if s.get("type") in _GROUNDING_SCENE_TYPES]
    scenes_enriched = 0
    for scene in targets:
        docs = _docs(client, scene.get("title") or "", kbs, 5)
        if not docs:
            continue
        scene["evidence"] = {
            "bibliographic_refs": [_to_ref(d) for d in docs],
            "enrichment_metadata": {
                "enricher_version": "eval-harness-1.0",
                "perspicacite_mode_used": "passages",
                "timestamp": now,
                "degraded": False,
            },
        }
        scenes_enriched += 1

    return {
        "edges_total": len(edges),
        "edges_grounded": edges_grounded,
        "scenes_total": len(targets),
        "scenes_enriched": scenes_enriched,
    }


def make_client_from_env() -> Optional[Any]:
    """Build a grounding client from env (None when STUDIUM_PERSPICACITE_ENABLED != 'on').

    Step A (mock):       STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=mock
    Step B (literature): STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=literature
                         PERSPICACITE_MCP_URL=http://localhost:8002/mcp   (KB-less, real citations)
    Default live:        STUDIUM_PERSPICACITE_ENABLED=on  (get_relevant_passages; needs a KB)
    """
    import os
    from harness.paths import ensure_perspicacite_importable
    ensure_perspicacite_importable()
    if os.getenv("STUDIUM_PERSPICACITE_ENABLED") != "on":
        return None
    if os.getenv("STUDIUM_PERSPICACITE_MODE") == "literature":
        from perspicacite_mcp.session import _MCPSession
        from harness.literature_client import LiteratureSearchClient
        mcp_url = os.getenv("PERSPICACITE_MCP_URL", "http://localhost:8002/mcp")
        # search_literature is slow (live multi-DB + LLM query-rewrite + rerank,
        # ~24s measured); the _MCPSession default 10s timeout always times out.
        timeout = float(os.getenv("STUDIUM_PERSPICACITE_TIMEOUT", "120"))
        return LiteratureSearchClient(session=_MCPSession(mcp_url, timeout=timeout))
    from perspicacite_mcp.client import make_perspicacite_client
    return make_perspicacite_client()
