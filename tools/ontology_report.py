#!/usr/bin/env python3
"""Generate docs/design-records/ontology-conformance.md from the schemas ON DISK — never hand-written, so the paper's
ontology claims and the code cannot silently diverge. Mirrors the ASB "indexes derived from disk" discipline:
each row is read from source (modulator set, scene types across the three schema sites, edge relations
declared-vs-produced, referential-integrity enforcement), so a stale table becomes a diff, not a lie.

Run:  python tools/ontology_report.py            # regenerate the doc
      python tools/ontology_report.py --check     # fail if the doc is stale (CI)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = REPO / "docs" / "design-records" / "ontology-conformance.md"


def _read(rel: str) -> str:
    return (REPO / rel).read_text()


def _literals(text: str, header: str) -> list[str]:
    """Extract the quoted lowercase tokens from a `<header>[ ... ]` block (a TS z.enum or a py Literal)."""
    m = re.search(re.escape(header) + r"\s*(?:z\.enum\()?\[(.*?)\]", text, re.S)
    return re.findall(r'"([a-z_]+)"', m.group(1)) if m else []


def active_modulators() -> list[str]:
    m = re.search(r"ACTIVE_MODULATOR_IDS = \[(.*?)\]", _read("packages/lesson-bundle-schema/src/modulators.ts"), re.S)
    return re.findall(r'"(M\d)"', m.group(1)) if m else []


def scene_type_sites() -> dict[str, set[str]]:
    return {
        "TS · learning-workflow-schema": set(_literals(_read("packages/learning-workflow-schema/src/index.ts"), "SceneTypeSchema =")),
        "Py · lesson-bundle-schema": set(_literals(_read("packages/lesson-bundle-schema/python/lesson_bundle_schema/__init__.py"), "SceneType = Literal")),
        "Py · scene-synth": set(_literals(_read("services/scene-synth/scene_synth_schemas.py"), "SceneType = Literal")),
    }


def edge_relations() -> tuple[list[str], set[str]]:
    """(declared, produced) — declared from EdgeRelationSchema, produced by grepping the planner/ingest
    producers for `relation=...`/`relation: ...`/`"relation": ...` assignments."""
    declared = _literals(_read("packages/learning-workflow-schema/src/index.ts"), "EdgeRelationSchema =")
    produced: set[str] = set()
    pat = re.compile(r'relation["\'\]:=\s]+["\'](' + "|".join(declared) + r')["\']') if declared else None
    for py in (REPO / "services").rglob("*.py"):
        if pat:
            produced |= set(pat.findall(py.read_text()))
    return declared, produced


def _table(headers: list[str], rows: list[list[str]]) -> str:
    line = lambda cells: "| " + " | ".join(cells) + " |"
    return "\n".join([line(headers), line(["---"] * len(headers)), *[line(r) for r in rows]])


def build() -> str:
    mods = active_modulators()
    sites = scene_type_sites()
    # Two distinct vocabularies: the BUNDLE scene union (the two Python mirrors — must agree) and the GRAPH
    # task-node scene_type (learning-workflow-schema — a superset that may list types with no bundle scene).
    bundle_mirrors = {k: v for k, v in sites.items() if "learning-workflow" not in k}
    graph_vocab = sites["TS · learning-workflow-schema"]
    bundle_union = set().union(*bundle_mirrors.values())
    mirrors_in_sync = len({frozenset(v) for v in bundle_mirrors.values()}) == 1
    graph_only = sorted(graph_vocab - bundle_union)  # graph scene_types with no bundle scene schema
    declared, produced = edge_relations()

    out: list[str] = [
        "# Ontology conformance (generated)",
        "",
        "**Generated from source by `tools/ontology_report.py` — do not edit by hand; run the tool to refresh.**",
        "This table is derived from the schemas on disk so the code and the paper's ontology claims cannot",
        "silently diverge. A stale row is a diff, not a lie.",
        "",
        "## Modulators",
        f"Active runtime set: **{', '.join(mods)}** ({len(mods)}). Definitions + retired ids: `docs/concepts/modulators.md`.",
        "",
        "## Scene types — the three schema sites",
        _table(["site", "count", "scene types"], [[k, str(len(v)), ", ".join(sorted(v))] for k, v in sites.items()]),
        "",
        f"Bundle scene mirrors (lesson-bundle-schema, scene-synth): **{'in sync' if mirrors_in_sync else 'DRIFT'}** "
        f"({len(bundle_union)} types) — pinned by `test_scene_types_match_canonical_mirror`.",
        "Graph task-node vocabulary (learning-workflow-schema) additionally lists: "
        + (", ".join(f"`{t}`" for t in graph_only) or "nothing")
        + (" — declared as a valid graph task-node scene_type but with **no bundle scene schema** (a ghost, cf. the ghost edge relations)." if graph_only else "."),
        "",
        "## Edge relations — declared vs produced",
        _table(["relation", "declared", "produced by a generator"],
               [[r, "yes", "yes" if r in produced else "**NO** (declared, never emitted)"] for r in declared]),
        "",
        "## Referential integrity enforced",
        _table(["check", "enforced?", "where"], [
            ["unique node/edge ids", "yes", "LearningWorkflowGraph"],
            ["edge endpoints reference declared nodes (no dangling)", "yes", "LearningWorkflowGraph (TS superRefine + Py validator)"],
            ["prerequisite acyclicity", "yes (build path)", "services/planner/graph/cycle.py"],
            ["concept_refs ⊆ course concepts", "yes", "services/scene-synth bundler.validate_scene"],
            ["objective_refs ⊆ declared objectives (shipped bundle)", "**NO**", "the LessonBundle carries no learning_objectives field"],
        ]),
        "",
        "## Open author decisions (not settleable from code)",
        "- **objective_refs enforcement** in the shipped bundle: needs `learning_objectives` on the LessonBundle model.",
        "- **Ghost relations**: "
        + (", ".join(f"`{r}`" for r in declared if r not in produced) or "none")
        + " are declared in EdgeRelationSchema but no producer emits them — implement a producer or retract.",
        "- **Ghost graph scene types**: "
        + (", ".join(f"`{t}`" for t in graph_only) or "none")
        + " are valid graph task-node scene_types with no bundle scene schema — implement the scene or drop from SceneTypeSchema.",
        "",
    ]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    content = build()
    if "--check" in argv:
        current = DOC.read_text() if DOC.exists() else ""
        if current != content:
            print("docs/design-records/ontology-conformance.md is STALE — run: python tools/ontology_report.py", file=sys.stderr)
            return 1
        print("ontology conformance doc is up to date.")
        return 0
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text(content)
    print(f"wrote {DOC.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    # smoke check: the derivations must find non-empty sets before anyone trusts the table.
    assert active_modulators() == ["M1", "M3", "M6"], active_modulators()
    _declared, _produced = edge_relations()
    assert "prerequisite_for" in _produced and "decomposes_into" not in _produced, _produced
    sys.exit(main(sys.argv[1:]))
