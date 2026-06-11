"""Unit tests for Stage 1 (author) — schema validity + runtime-contract invariants.

Run:  /Users/holobiomicslab/git/prototype-build/.venv/bin/python -m pytest eval/tests -q
(rule 004: run separately from services/planner & services/scene-synth pytest.)
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest

# make the harness importable
EVAL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL_DIR))

from harness.author import author_bundle, parse_sections  # noqa: E402
from harness.corpus import CorpusMaterial, load_manifest  # noqa: E402
from harness.paths import ensure_scene_synth_importable  # noqa: E402

# Skip the whole module if the corpus isn't present locally (it's gitignored).
_HAS_CORPUS = (EVAL_DIR / "corpus" / "manifest.json").exists()
pytestmark = pytest.mark.skipif(not _HAS_CORPUS, reason="eval/corpus is gitignored; populate it to run")


def _first_material() -> CorpusMaterial:
    # prefer the short Big-O material if present, else the first one
    mats = load_manifest()
    for m in mats:
        if m.id == "04":
            return m
    return mats[0]


def test_parse_sections_splits_on_headings():
    body = "# Title\n\nintro paragraph that is reasonably long so it survives the filter threshold.\n\n## Section A\n\nthis is section A body content that is also long enough to pass the minimum length filter.\n\n## Section B\n\nsection B body which similarly needs to be long enough to count as a real section here."
    secs = parse_sections(body)
    titles = [s.title for s in secs]
    assert "Section A" in titles and "Section B" in titles


def test_author_deterministic_is_schema_valid(tmp_path):
    ensure_scene_synth_importable()
    from scene_synth_schemas import LessonBundle

    m = _first_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    # the emitted lesson.json validates against the Pydantic mirror
    LessonBundle.model_validate(res.bundle_dict)
    assert res.provenance["author_mode"] == "deterministic"
    assert res.provenance["synthetic_assessment"] is True


def test_author_emits_lwg_and_universes_with_aligned_concept_ids(tmp_path):
    m = _first_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    b = res.bundle_dict

    lwg = b["learning_workflow_graph"]
    assert lwg is not None and lwg["nodes"], "LWG must be present + non-empty (#2/#6)"
    assert lwg["edges"], "LWG must carry a prerequisite_for edge so gating can fire (#6)"
    assert any(e["relation"] == "prerequisite_for" for e in lwg["edges"])

    universes = b["universes"]
    assert universes and {v["id"] for v in universes["variants"]} >= {"baseline", "remedial"}

    # concept-id alignment: every scene concept_ref maps to an LWG concept node
    scene_refs = {cr for s in b["scenes"] for cr in s.get("concept_refs", [])}
    lwg_concepts = {n["id"].removeprefix("concept:") for n in lwg["nodes"] if n["node_kind"] == "concept"}
    assert scene_refs <= lwg_concepts, f"unaligned concept refs: {scene_refs - lwg_concepts}"


def test_author_quiz_has_exactly_one_correct_choice(tmp_path):
    m = _first_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    quizzes = [s for s in res.bundle_dict["scenes"] if s["type"] == "quiz"]
    assert quizzes, "expected at least one quiz scene"
    for q in quizzes:
        n_correct = sum(1 for c in q["choices"] if c["correct"])
        assert n_correct == 1, f"quiz {q['id']} has {n_correct} correct choices"
        assert 2 <= len(q["choices"]) <= 6


def test_author_validated_at_is_zod_strict_datetime(tmp_path):
    """The TS loader (Zod z.string().datetime()) rejects numeric offsets; the
    harness normalises validated_at to a Z suffix and flags the bundler defect."""
    m = _first_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    ts = res.bundle_dict["validated_at"]
    assert ts.endswith("Z"), f"validated_at must be Z-suffixed for the TS loader, got {ts!r}"
    assert res.provenance["bundler_validated_at_offset_defect"] is True


def test_author_refuses_unknown_mode(tmp_path):
    m = _first_material()
    with pytest.raises(ValueError):
        author_bundle(m, tmp_path, mode="metabolomics-mock")


def test_bundle_zip_contains_lesson_and_prov(tmp_path):
    m = _first_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    with zipfile.ZipFile(res.bundle_path) as zf:
        names = set(zf.namelist())
    assert "lesson.json" in names and "prov.json" in names
