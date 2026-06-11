"""DAG guard for prerequisite_for edges. An edge source->target means
'source requires target'. Adding it forms a cycle iff target already
(transitively) requires source. Only prerequisite_for edges are considered."""
from __future__ import annotations
from typing import Any


def would_create_cycle(edges: list[dict[str, Any]], source: str, target: str) -> bool:
    if source == target:
        return True
    adj: dict[str, list[str]] = {}
    for e in edges:
        if e.get("relation") != "prerequisite_for":
            continue
        adj.setdefault(e["source"], []).append(e["target"])
    seen: set[str] = set()
    stack = [target]
    while stack:
        node = stack.pop()
        if node == source:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(adj.get(node, []))
    return False
