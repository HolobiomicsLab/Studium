"""_synth.py — build synthetic lesson bundles matching the real evidence shape.

Verified against a mock-mode grounded bundle (corpus 01):
- scene = {"id", "type", "title", "markdown", "evidence"} with type in
  {"intro", "concept", "quiz", ...}.
- evidence = {"bibliographic_refs": [{"title","doi","authors","year",
  "excerpt","relevance_score", ...}], "enrichment_metadata": {...}}.

These helpers keep tests honest: they synthesize ONLY the fields the relevance
tool reads, so a test failure points at logic, not fixture drift.
"""

from __future__ import annotations

from typing import List, Optional


def make_ref(title: str, excerpt: str = "", doi: str = "10.0/x",
             relevance_score: float = 0.8) -> dict:
    return {
        "title": title,
        "doi": doi,
        "authors": ["Doe, J."],
        "year": 2024,
        "excerpt": excerpt,
        "relevance_score": relevance_score,
    }


def make_scene(scene_id: str, scene_type: str, title: str, markdown: str = "",
               refs: Optional[List[dict]] = None) -> dict:
    scene = {
        "id": scene_id,
        "type": scene_type,
        "title": title,
        "markdown": markdown,
    }
    if refs is not None:
        scene["evidence"] = {
            "bibliographic_refs": list(refs),
            "enrichment_metadata": {"perspicacite_mode_used": "mock", "degraded": False},
        }
    return scene


def make_bundle(scenes: List[dict], bundle_id: str = "test-bundle") -> dict:
    return {
        "schema_version": "1.0",
        "bundle_id": bundle_id,
        "scenes": list(scenes),
        "learning_workflow_graph": {"nodes": [], "edges": []},
    }
