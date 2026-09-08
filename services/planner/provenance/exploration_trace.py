"""ARA exploration-trace emission (trace/exploration_tree.yaml).

Records the journey of an author-time course build — what was asked and what was
decided, alternatives included — in the exploration-trace shape the ASB ecosystem
uses, so Studium course builds are readable by the same ARA tooling.

VENDORED CONTRACT (copy verbatim; keep in lock-step):
  AgenticScienceBuilder src/agentic_science_builder/trace_extract/model.py
    @ branch feat/exploration-trace-spec (P0.1) — TRACE_SCHEMA_VERSION,
    NODE_TYPES, SUPPORT_LEVELS, NODE_ID_PATTERN, REQUIRED_FIELDS_BY_TYPE.
  Spec: AgenticScienceBuilder docs/superpowers/specs/2026-08-16-exploration-trace-design.md
  (ARA: arXiv 2604.24658 — dead ends and alternatives are first-class.)

The tree is built FROM the emitted ASTRA document, never from raw decision lists,
so every source_ref points at an id astra.yaml actually carries."""
from __future__ import annotations
import os
import re
from typing import Any

from provenance.astra_emit import analysis_body

TRACE_SCHEMA_VERSION = "0.1.0"

NODE_TYPES = frozenset({"question", "experiment", "decision", "dead_end", "pivot"})
SUPPORT_LEVELS = frozenset({"explicit", "inferred"})

# N-prefixed, zero-padded ids. \Z not $ (a trailing newline would pass $);
# re.ASCII keeps \d from accepting non-ASCII digits.
NODE_ID_PATTERN = re.compile(r"^N\d{2,}\Z", re.ASCII)

REQUIRED_FIELDS_BY_TYPE: dict[str, tuple[str, ...]] = {
    "question": (),
    "experiment": ("result", "evidence"),
    "decision": ("choice", "alternatives"),
    "dead_end": ("hypothesis", "failure_mode", "lesson"),
    "pivot": ("from_", "to", "trigger"),
}


def _node_id(n: int) -> str:
    """Sequential node id in the contract's N-prefixed zero-padded form."""
    return f"N{n:02d}"


def _decision_node(node_id: str, slug: str, dslug: str, body: dict[str, Any]) -> dict[str, Any]:
    """One ARA decision node mirroring an emitted ASTRA decision: the default
    option is the choice taken, every other option is a live alternative."""
    options = body.get("options") or {}
    default = body.get("default")
    chosen = options.get(default) or {}
    return {
        "id": node_id,
        "type": "decision",
        "title": body.get("label") or dslug,
        "support_level": "explicit",
        "source_refs": [f"astra.yaml#analyses/{slug}/decisions/{dslug}"],
        "choice": chosen.get("label") or str(default),
        "alternatives": [o.get("label") or oid for oid, o in options.items() if oid != default],
    }


def build_exploration_tree(doc: dict[str, Any]) -> dict[str, Any]:
    """Exploration tree for one emitted ASTRA document: a question root (why does
    this course exist) whose children are the build's decision points. Input: the
    emit_astra document. Output: the tree dict ready for write_exploration_trace."""
    slug, analysis = analysis_body(doc)
    counter = 1
    root = {
        "id": _node_id(counter),
        "type": "question",
        "title": f"How should «{doc.get('name', slug)}» be organised for teaching?",
        "support_level": "explicit",
        "source_refs": [f"astra.yaml#analyses/{slug}"],
        "children": [],
    }
    for dslug, body in (analysis.get("decisions") or {}).items():
        counter += 1
        root["children"].append(_decision_node(_node_id(counter), slug, dslug, body))
    return {"schema_version": TRACE_SCHEMA_VERSION, "nodes": [root]}


def write_exploration_trace(tree: dict[str, Any], out_dir: str) -> None:
    """Write the tree as <out_dir>/trace/exploration_tree.yaml (the ARA layout)."""
    import yaml
    tdir = os.path.join(out_dir, "trace")
    os.makedirs(tdir, exist_ok=True)
    with open(os.path.join(tdir, "exploration_tree.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(tree, f, sort_keys=False, allow_unicode=True)
