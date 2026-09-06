"""INT-STUDIUM-020: a review is written per bundle, and `--out` is not guessed.

A course holds N bundles and a review is keyed by bundle — the emitted analysis id is
`f"{bundle_id}-scene-review"` — but the writer put every review at one course-level
`review/astra.yaml`. Judging a second bundle overwrote the first, and the course page
then showed one chapter's verdicts as the whole course's. These tests pin the layout
and the CLI contract; `test_provenance_astra_read_reviews.py` pins the reading half.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

EVAL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL_DIR))

from test_scene_judge import QUIZ, FakeLLM  # noqa: E402  (pytest prepends eval/tests)
from harness import scene_judge  # noqa: E402
from harness.scene_judge import judge_bundle, write_review  # noqa: E402


def _review(bundle_id: str) -> dict:
    return judge_bundle({"bundle_id": bundle_id, "language": "fr", "scenes": [QUIZ]},
                        FakeLLM())


def test_a_second_bundle_does_not_overwrite_the_first(tmp_path):
    """Two bundles of one course keep two reviews, each under its own bundle id."""
    first = write_review(_review("chap-01"), tmp_path)
    second = write_review(_review("chap-02"), tmp_path)

    assert first == tmp_path / "review" / "chap-01"
    assert second == tmp_path / "review" / "chap-02"
    for rdir, bundle_id in ((first, "chap-01"), (second, "chap-02")):
        doc = yaml.safe_load((rdir / "astra.yaml").read_text(encoding="utf-8"))
        assert f"{bundle_id}-scene-review" in doc["analyses"]
        verdicts = json.loads((rdir / "verdicts.json").read_text(encoding="utf-8"))
        assert verdicts["bundle_id"] == bundle_id


def test_a_bundle_id_that_is_not_a_directory_name_is_slugified(tmp_path):
    """`judge_bundle` falls back to "?" for a bundle without an id; a path separator or a
    wildcard must not decide where the review lands."""
    written = write_review(_review("a/b?c"), tmp_path)

    assert written.parent == tmp_path / "review"
    assert written.name == "a-b-c"
    assert (written / "astra.yaml").is_file()


def test_out_is_required_rather_than_guessed(tmp_path, monkeypatch):
    """The old default wrote next to the bundle — a location no reader ever looked at,
    and undefined for an eval bundle whose lesson.json exists only inside a .zip."""
    bundle = tmp_path / "lesson.json"
    bundle.write_text(json.dumps({"bundle_id": "b1", "language": "fr", "scenes": [QUIZ]}),
                      encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["scene_judge.py", str(bundle)])

    with pytest.raises(SystemExit) as exc:
        scene_judge.main()

    assert exc.value.code == 2  # argparse: a required argument is missing
