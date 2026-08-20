"""astra_render (MySTRA) — renders a real planner-emitted directory, no LLM.

Run:  .venv/bin/python -m pytest tools/test_astra_render.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))
sys.path.insert(0, str(REPO_ROOT / "services" / "planner"))

from astra_render import render  # noqa: E402


def _emit_course(tmp_path: Path) -> Path:
    from provenance.astra_emit import (
        baseline_universe, emit_astra, nest_universe, write_astra_yaml, write_universe_yaml,
    )
    from provenance.exploration_trace import build_exploration_tree, write_exploration_trace
    from provenance.universes import pedagogical_decisions

    doc = emit_astra(analysis_id="sp-101-analysis", name="Signal Processing",
                     decisions=pedagogical_decisions(), prior_insights=[],
                     findings=[{"id": "link:wf:c1", "claim": "capsule grounds c1"}],
                     outputs=[{"id": "lwg", "type": "data"}])
    write_astra_yaml(doc, str(tmp_path))
    slug = next(iter(doc["analyses"]))
    write_universe_yaml(nest_universe(baseline_universe(pedagogical_decisions()), slug), str(tmp_path))
    write_exploration_trace(build_exploration_tree(doc), str(tmp_path))
    return tmp_path


def test_renders_all_sections_from_real_artifacts(tmp_path):
    page = render(_emit_course(tmp_path))
    assert "## Decisions" in page and "Prerequisite gating strictness" in page
    assert "## Universes" in page and "baseline" in page
    assert "## Exploration trace" in page and "```{mermaid}" in page and "N01" in page
    assert "## Findings" in page and "link:wf:c1" in page
    assert "do not edit by hand" in page


def test_alternatives_and_exclusions_are_visible(tmp_path):
    page = render(_emit_course(tmp_path))
    assert "alternative: Lower threshold, earlier unlock" in page


def test_review_section_appears_when_review_exists(tmp_path):
    course = _emit_course(tmp_path)
    sys.path.insert(0, str(REPO_ROOT / "eval"))
    from harness.scene_judge import judge_bundle, write_review
    # Load the scene-judge test module by path: importing it as `tests.test_scene_judge`
    # collides with services/planner/tests when the suites run together.
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "scene_judge_fixtures", REPO_ROOT / "eval" / "tests" / "test_scene_judge.py")
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    write_review(judge_bundle(fixtures.BUNDLE, fixtures.FakeLLM()), course)
    page = render(course)
    assert "## Scene review" in page and "not passing" in page


def test_missing_astra_yaml_raises(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError):
        render(tmp_path)
