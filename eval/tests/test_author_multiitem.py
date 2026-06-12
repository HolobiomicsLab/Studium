"""Test: the deterministic author emits >=3 genuinely-different quiz items per
concept (#1).

The runtime remediates a 2nd consecutive error on a concept by presenting an
UNSEEN alternate quiz item (kind `remediate_alt` in @studium/lesson-session),
falling back to `replay` only if no fresh item remains. The struggling eval
persona fails twice; the first error advances and marks one item seen, so the
2nd-error remediation needs a THIRD, still-unseen item. Hence >=3 distinct quiz
scenes per concept (same `concept_refs`, distinct ids `s-quiz-{cid}-{idx}`).

Mirrors test_author_grounding.py's synthetic-material setup so it runs WITHOUT
the gitignored eval/corpus.
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

# Self-contained markdown body: three substantive sections, each with a first
# paragraph > 60 chars so parse_sections keeps them -> >=2 concepts.
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
        id="multiitem-it",
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


def _author_deterministic_bundle(tmp_path: Path) -> dict:
    m = _synthetic_material(tmp_path / "corpus")
    out = tmp_path / "out"
    res = author_bundle(m, out, mode="deterministic")
    return _lesson_json(res.bundle_path)


def test_each_concept_has_three_distinct_quiz_scenes(tmp_path):
    bundle = _author_deterministic_bundle(tmp_path)
    by_concept: dict[str, list[dict]] = {}
    for s in bundle["scenes"]:
        if s["type"] == "quiz":
            by_concept.setdefault(s["concept_refs"][0], []).append(s)
    assert by_concept
    for cid, quizzes in by_concept.items():
        assert len(quizzes) >= 3, f"{cid} has <3 quiz items"
        assert len({q["id"] for q in quizzes}) == len(quizzes), "ids distinct"
        assert len({q["question"] for q in quizzes}) == len(quizzes), "questions genuinely different"
