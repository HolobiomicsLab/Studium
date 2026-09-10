"""Completeness contracts for the MySTRA renderer.

Run:  /Users/nothiasl/git/prototype-build/.venv/bin/python -m pytest \
      tools/test_astra_render_complete.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))
sys.path.insert(0, str(REPO_ROOT / "services" / "planner"))

from astra_render import render  # noqa: E402


def _write_yaml(path: Path, document: dict) -> None:
    """Write one synthetic ASTRA document under its requested course path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")


def _analysis(name: str, marker: str, *, quote: object) -> dict:
    """Build one analysis whose every visible field has a unique marker."""
    return {
        "id": marker,
        "name": name,
        "inputs": [{"id": f"{marker}_input", "type": "data",
                    "description": f"{marker} input context"}],
        "outputs": [{"id": f"{marker}_output", "type": "data", "format": "json",
                     "description": f"{marker} output context"}],
        "decisions": {
            f"{marker}_decision": {
                "label": f"{marker} decision label",
                "default": "chosen",
                "rationale": f"{marker} rationale",
                "options": {"chosen": {"label": f"{marker} chosen"}},
            }
        },
        "findings": {
            f"{marker}_finding": {
                "claim": f"{marker} finding claim",
                "evidence": [{"id": f"{marker}_evidence", "artifact": f"{marker}_output",
                              "quote": quote}],
            }
        },
    }


def _course_document() -> dict:
    """Build a two-analysis course with root and analysis I/O context."""
    return {
        "version": "0.0.14",
        "name": 'Course "quoted": complete',
        "inputs": [{"id": "root_input", "type": "data",
                    "description": "root input context"}],
        "outputs": [{"id": "root_output", "from": "analysis_one.one_output"}],
        "analyses": {
            "analysis_one": _analysis("Analysis one", "one", quote={"exact": "nested exact quote"}),
            "analysis_two": _analysis("Analysis two", "two", quote="legacy string quote"),
        },
    }


def test_renders_every_analysis_context_finding_and_evidence(tmp_path: Path) -> None:
    """No nested analysis, I/O declaration, finding, or evidence quote is selected away."""
    _write_yaml(tmp_path / "astra.yaml", _course_document())

    page = render(tmp_path)

    frontmatter = yaml.safe_load(page.split("---", 2)[1])
    assert frontmatter["title"] == 'Course "quoted": complete — course provenance'
    for expected in (
        "root_input", "root input context", "root_output",
        "analysis_one", "one_input", "one output context", "one decision label",
        "one finding claim", "one_evidence", "nested exact quote",
        "analysis_two", "two_input", "two output context", "two decision label",
        "two finding claim", "two_evidence", "legacy string quote",
    ):
        assert expected in page


def test_renders_every_bundle_and_legacy_review_with_all_analyses(tmp_path: Path) -> None:
    """Review rendering keeps its bundle/path identity and every nested analysis."""
    _write_yaml(tmp_path / "astra.yaml", _course_document())
    _write_yaml(tmp_path / "review" / "astra.yaml", {
        "version": "0.0.14",
        "id": "legacy-review",
        "name": "Legacy review",
        "analyses": {
            "legacy_first": _analysis("Legacy first", "legacy_first", quote={"exact": "legacy A"}),
            "legacy_second": _analysis("Legacy second", "legacy_second", quote={"exact": "legacy B"}),
        },
    })
    for bundle_id in ("bundle-a", "bundle-b"):
        _write_yaml(tmp_path / "review" / bundle_id / "astra.yaml", {
            "version": "0.0.14",
            "name": f"Review {bundle_id}",
            "analyses": {
                f"{bundle_id}_first": _analysis(
                    f"{bundle_id} first", f"{bundle_id}_first", quote={"exact": f"{bundle_id} A"}),
                f"{bundle_id}_second": _analysis(
                    f"{bundle_id} second", f"{bundle_id}_second", quote={"exact": f"{bundle_id} B"}),
            },
        })
        verdict_path = tmp_path / "review" / bundle_id / "verdicts.json"
        verdict_path.write_text(json.dumps({"bundle_id": bundle_id}), encoding="utf-8")

    page = render(tmp_path)

    assert "legacy course review" in page
    assert "review/astra.yaml" in page
    for bundle_id in ("bundle-a", "bundle-b"):
        assert f"bundle `{bundle_id}`" in page
        assert f"review/{bundle_id}/astra.yaml" in page
    for analysis_id in (
        "legacy_first", "legacy_second", "bundle-a_first", "bundle-a_second",
        "bundle-b_first", "bundle-b_second",
    ):
        assert analysis_id in page
        assert f"{analysis_id} decision label" in page


def test_incomplete_review_is_named_and_never_reported_as_all_pass(tmp_path: Path) -> None:
    """A verdict file without its ASTRA half remains visibly incomplete."""
    _write_yaml(tmp_path / "astra.yaml", _course_document())
    review_dir = tmp_path / "review" / "bundle-incomplete"
    review_dir.mkdir(parents=True)
    (review_dir / "verdicts.json").write_text(
        json.dumps({"bundle_id": "bundle-incomplete", "worst_case": {}}), encoding="utf-8")

    page = render(tmp_path)

    assert "bundle `bundle-incomplete`" in page
    assert "review/bundle-incomplete/astra.yaml" in page
    assert "missing" in page
    assert "All judged dimensions pass." not in page


def test_flat_legacy_analysis_keeps_context_and_legacy_exact_quote(tmp_path: Path) -> None:
    """A pre-nesting course remains one complete analysis with legacy evidence fields."""
    flat = _analysis("Flat course", "flat", quote=None)
    flat.update({"version": "0.0.13", "name": "Flat course"})
    flat["findings"]["flat_finding"]["evidence"][0].pop("quote")
    flat["findings"]["flat_finding"]["evidence"][0]["quote_exact"] = "legacy exact quote"
    _write_yaml(tmp_path / "astra.yaml", flat)

    page = render(tmp_path)

    for expected in ("flat_input", "flat_output", "flat decision label",
                     "flat finding claim", "legacy exact quote"):
        assert expected in page


def test_evidence_retains_reproducible_source_and_quote_selectors(tmp_path: Path) -> None:
    """ASTRA source versions and selectors remain inspectable in the exported report."""
    doc = _course_document()
    evidence = doc["analyses"]["analysis_one"]["findings"]["one_finding"]["evidence"][0]
    evidence.pop("artifact")
    evidence.update({"doi": "10.1234/synthetic", "version": 3,
                     "snapshot": "snapshots/source-v3.pdf", "source_commit": "abc123def",
                     "quote": {"exact": "anchored words", "prefix": "before anchor", "suffix": "after anchor"},
                     "location": {"value": "page=7", "page": 7}})
    _write_yaml(tmp_path / "astra.yaml", doc)
    page = render(tmp_path)
    for expected in ("10.1234/synthetic", "Version: 3", "snapshots/source-v3.pdf", "abc123def",
                     "anchored words", "before anchor", "after anchor", "page=7", "Page: 7"):
        assert expected in page


def test_wrong_shaped_selector_keeps_valid_legacy_quote() -> None:
    """An unusable nested selector cannot erase a valid older quote representation."""
    from provenance.astra_read import evidence_view
    view = evidence_view({"id": "evidence", "quote": {"exact": 7},
                          "quote_exact": "legacy survives", "version": True,
                          "location": {"page": float("nan")}})
    assert view["quote_exact"] == "legacy survives"
    assert view["version"] is None
    assert view["location_page"] is None
