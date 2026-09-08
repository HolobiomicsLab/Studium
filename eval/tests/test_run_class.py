"""Tests for eval/run_class.py — the live exercise that walks a CLASS through a bundle.

INT-STUDIUM-030. This exercise is where the k floor is meant to be *observed* rather than
merely implemented, and until now it could not be:

  * it ran exactly five personas against a floor of five, so every run landed on the boundary.
    Suppression (four) and a comfortable aggregate (twenty-four) had never been produced by the
    thing an operator actually runs — only by unit tests over synthetic telemetry;
  * its docstring says it "then runs tools/class_report.py over the run dir", and it did not.
    It printed the run directory and stopped. The floor cannot be observed by an exercise that
    never asks for the report.

So the two boundary cases are pinned here against the exercise itself. `run_session` is
monkeypatched: the scripted harness has its own tests, and what is under test is the cohort the
exercise builds and the report it asks for.

Run: .venv/bin/python -m pytest eval/tests/test_run_class.py -q
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import run_class  # noqa: E402
from class_report import MIN_LEARNERS_DEFAULT  # noqa: E402


@pytest.fixture
def fake_run(monkeypatch):
    """Replace the scripted harness with a telemetry writer, and record who was asked to run."""
    calls: list[tuple[str, str]] = []

    def _run_session(bundle, persona, out, *, live, max_turns, learner_id, **kw):
        calls.append((persona, learner_id))
        out.mkdir(parents=True, exist_ok=True)
        events = [
            {"type": "lesson_started", "learner_pseudonym": learner_id},
            {"type": "quiz_answered", "scene_id": "q-1", "correct": True,
             "confidence": 0.5, "response_time_ms": 4000, "learner_pseudonym": learner_id},
            {"type": "lesson_completed", "autonomy_ratio": 0.8, "learner_pseudonym": learner_id},
        ]
        (out / "telemetry.jsonl").write_text(
            "\n".join(json.dumps(e) for e in events), encoding="utf-8")
        return {"completed": True, "summary": {"scenesCompleted": 1, "autonomyRatio": 0.8}}

    monkeypatch.setattr(run_class, "run_session", _run_session)
    return calls


def _bundle(tmp_path: Path) -> Path:
    """A minimal bundle zip: class_report reads `lesson.json` for scene → concept."""
    import zipfile

    src = tmp_path / "src.zip"
    with zipfile.ZipFile(src, "w") as z:
        z.writestr("lesson.json", json.dumps({"scenes": [{"id": "q-1", "concept_refs": ["c-1"]}]}))
    return src


def _report(run_dir: Path) -> dict:
    return json.loads((run_dir / "class_report.json").read_text(encoding="utf-8"))


def test_the_default_cohort_is_unchanged(tmp_path, fake_run):
    """The existing exercise keeps running the five authored personas, once each."""
    run_class.main([str(_bundle(tmp_path)), str(tmp_path / "run")])

    assert [p for p, _ in fake_run] == run_class.PERSONAS
    assert len({lid for _, lid in fake_run}) == len(run_class.PERSONAS)


def test_a_cohort_below_the_floor_makes_the_report_suppress(tmp_path, fake_run):
    """Four learners against a floor of five: the exercise must end in a suppressed report,
    which is the state a teacher of a small class actually meets and nothing had produced."""
    run_dir = tmp_path / "run"
    run_class.main([str(_bundle(tmp_path)), str(run_dir), "--learners", "4"])

    assert len(fake_run) == 4
    rep = _report(run_dir)
    assert rep["status"] == "suppressed"
    assert rep["has_data"] is True
    assert "n_learners" not in rep


def test_a_cohort_well_above_the_floor_reports_an_aggregate(tmp_path, fake_run):
    """Twenty-four learners: distinct people beyond the five authored personas, and a report
    that computes rather than withholds. Personas cycle; learner ids must not."""
    run_dir = tmp_path / "run"
    run_class.main([str(_bundle(tmp_path)), str(run_dir), "--learners", "24"])

    assert len(fake_run) == 24
    assert len({lid for _, lid in fake_run}) == 24, "two learners shared an id"
    assert set(p for p, _ in fake_run) == set(run_class.PERSONAS), "cohort stopped cycling personas"

    rep = _report(run_dir)
    assert rep["status"] == "ok"
    assert rep["n_learners"] == 24
    assert rep["concepts"], "an aggregate over 24 learners produced no concept row"


def test_the_exercise_writes_the_report_its_docstring_promises(tmp_path, fake_run):
    """The exercise's stated output is the teacher view, not a directory of telemetry."""
    run_dir = tmp_path / "run"
    run_class.main([str(_bundle(tmp_path)), str(run_dir), "--learners",
                    str(MIN_LEARNERS_DEFAULT)])

    assert (run_dir / "class_report.json").exists()
    assert (run_dir / "class_report.md").exists()
