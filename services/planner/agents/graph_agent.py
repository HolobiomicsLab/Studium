"""GraphAgent: proposes prerequisite_for relations among concept nodes. Subclasses
BaseAgent (LLM + mock fallback). Returns raw {source, target, rationale} proposals;
the GraphBuilder validates, grounds, admits, and DAG-checks them — the agent only
proposes. Malformed output degrades to zero proposals (fail-soft, ASB discipline)."""
from __future__ import annotations
import json
from typing import Any

from agents.base import BaseAgent


class GraphAgent(BaseAgent):
    alias = "studium/graph-builder"
    system_prompt = (
        "You are a curriculum architect. Given learning concepts (id, Bloom level, title), "
        "identify which concepts are PREREQUISITES of others — knowledge a learner must master "
        "first. Only propose a prerequisite when it is genuinely necessary; do not invent edges."
    )
    max_retries = 1

    def propose_prerequisites(self, concepts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        raw = self._call_llm(self._build_prompt(concepts))
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return []
        edges = data.get("edges") if isinstance(data, dict) else None
        return edges if isinstance(edges, list) else []

    def _build_prompt(self, concepts: list[dict[str, Any]]) -> str:
        lines = ["Concepts (id | bloom | title):"]
        for c in concepts:
            lines.append(f"{c['id']} | {c.get('bloom_level', '')} | {c.get('title', '')}")
        lines.append(
            'Return ONLY JSON: {"edges":[{"source":"<concept id that REQUIRES the other>",'
            '"target":"<prerequisite concept id>","rationale":"<one sentence>"}]}. '
            "source and target must be ids from the list above. Omit any edge you are unsure of."
        )
        return "\n".join(lines)

    def _mock_response(self, reason: str = "") -> str:
        return json.dumps({"edges": []})
