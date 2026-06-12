"""Integration test for the env-gated grounding wiring in author_bundle (#7).

Proves Task 3: when STUDIUM_PERSPICACITE_ENABLED=on + STUDIUM_PERSPICACITE_MODE=mock,
author_bundle runs ground_bundle so the EMITTED lesson.json carries evidence on
intro/concept scenes and on >=1 LWG edge (ungrounded flag dropped), and the
provenance gains a non-None `grounding` summary. With the env unset, grounding is
skipped and provenance["grounding"] is None (the unchanged 0.30 key-free path).

This test builds a synthetic CorpusMaterial backed by a tmp_path body file so it
runs WITHOUT the gitignored eval/corpus (unlike test_author.py, which is corpus-gated).
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(EVAL_DIR))

from harness.author import author_bundle  # noqa: E402
from harness.corpus import CorpusMaterial  # noqa: E402
from harness.paths import ensure_scene_synth_importable  # noqa: E402

# A self-contained markdown body: three substantive sections, each with a first
# paragraph > 60 chars so parse_sections keeps them -> >=2 concepts -> >=1 LWG edge.
_BODY = """# Cellular Respiration Primer

## Glycolysis

Glycolysis is the metabolic pathway that converts glucose into pyruvate, releasing
a small amount of usable energy in the cytosol of the cell before mitochondrial steps.

## The Citric Acid Cycle

The citric acid cycle oxidises acetyl-CoA derived from carbohydrates, fats, and
proteins, capturing high-energy electrons that drive downstream ATP synthesis.

## Oxidative Phosphorylation

Oxidative phosphorylation uses the electron transport chain and chemiosmosis to
generate the bulk of the cell's ATP from the electrons harvested in earlier stages.
"""


def _synthetic_material(tmp_path: Path) -> CorpusMaterial:
    tmp_path.mkdir(parents=True, exist_ok=True)
    body_path = tmp_path / "respiration.md"
    body_path.write_text(_BODY, encoding="utf-8")
    return CorpusMaterial(
        id="grounding-it",
        title="Cellular Respiration Primer",
        discipline="biology",
        branch="sciences",
        level="L1",
        local_path=body_path,
        word_count=len(_BODY.split()),
        summary="A short primer on the stages of cellular respiration.",
        license="CC-BY",
        source_url="https://example.org/respiration",
    )


def _lesson_json(bundle_path: Path) -> dict:
    with zipfile.ZipFile(bundle_path) as zf:
        return json.loads(zf.read("lesson.json"))


def test_author_bundle_grounds_emitted_bundle_when_mock_enabled(tmp_path, monkeypatch):
    ensure_scene_synth_importable()
    from scene_synth_schemas import Evidence, LessonBundle

    monkeypatch.setenv("STUDIUM_PERSPICACITE_ENABLED", "on")
    monkeypatch.setenv("STUDIUM_PERSPICACITE_MODE", "mock")

    m = _synthetic_material(tmp_path / "corpus")
    out = tmp_path / "out"

    res = author_bundle(m, out, mode="deterministic")

    # provenance carries the grounding summary (non-None when the client is configured)
    g = res.provenance["grounding"]
    assert g is not None, "grounding summary must be populated when mock client is enabled"
    assert g["edges_grounded"] >= 1, f"expected >=1 grounded edge, got {g}"
    assert g["scenes_enriched"] >= 1, f"expected >=1 enriched scene, got {g}"

    # the EMITTED lesson.json (not just the in-memory scenes) carries the evidence
    bundle = _lesson_json(res.bundle_path)
    LessonBundle.model_validate(bundle)  # evidence-carrying bundle still schema-valid

    intro_concept = [s for s in bundle["scenes"] if s["type"] in ("intro", "concept")]
    assert intro_concept, "expected intro/concept scenes"
    for s in intro_concept:
        assert s.get("evidence"), f"scene {s['id']} must carry populated evidence after grounding"
        Evidence.model_validate(s["evidence"])
        assert s["evidence"]["bibliographic_refs"], f"scene {s['id']} evidence has no refs"

    edges = bundle["learning_workflow_graph"]["edges"]
    grounded = [e for e in edges if e.get("evidence")]
    assert grounded, "expected >=1 LWG edge with evidence after grounding"
    for e in grounded:
        assert "ungrounded" not in (e.get("quality_flags") or []), (
            f"edge {e['id']} keeps the ungrounded flag despite carrying evidence"
        )


def test_author_bundle_grounding_disabled_by_default(tmp_path, monkeypatch):
    """Key-free default: with the env unset, grounding is skipped (provenance None,
    edges stay ungrounded, scenes carry no evidence) — the unchanged 0.30 path."""
    monkeypatch.delenv("STUDIUM_PERSPICACITE_ENABLED", raising=False)
    monkeypatch.delenv("STUDIUM_PERSPICACITE_MODE", raising=False)

    m = _synthetic_material(tmp_path / "corpus")
    out = tmp_path / "out"

    res = author_bundle(m, out, mode="deterministic")

    assert res.provenance["grounding"] is None, "grounding must be None when disabled"
    bundle = _lesson_json(res.bundle_path)
    # the scene schema carries an optional `evidence` field that defaults to None; the
    # honest contract is that NO scene gets a populated evidence block when disabled.
    for s in bundle["scenes"]:
        assert not s.get("evidence"), f"scene {s['id']} must NOT carry evidence when disabled"
    for e in bundle["learning_workflow_graph"]["edges"]:
        assert not e.get("evidence"), f"edge {e['id']} must NOT carry evidence when disabled"
        assert "ungrounded" in (e.get("quality_flags") or []), "edges stay honestly ungrounded"
