"""Validate fixture demo-atomistique bundle schema 1.4."""

from pathlib import Path
import json

from scene_synth_schemas import LessonBundle

REPO_ROOT = Path(__file__).resolve().parents[3]
BUNDLE_PATH = REPO_ROOT / "fixtures/m6/demo-atomistique/lesson.json"


def test_bundle_schema_version() -> None:
    raw = json.loads(BUNDLE_PATH.read_text())
    assert raw["schema_version"] == "1.4"


def test_bundle_parses_pydantic() -> None:
    raw = json.loads(BUNDLE_PATH.read_text())
    bundle = LessonBundle.model_validate(raw)
    assert bundle.bundle_id == "demo-atomistique-001"
    assert bundle.metadata.discipline == "chimie atomistique"


def test_bundle_has_two_lessons_via_scenes() -> None:
    raw = json.loads(BUNDLE_PATH.read_text())
    bundle = LessonBundle.model_validate(raw)
    # 6 scenes leçon 1 + 4 scenes leçon 2 = 10 scenes
    assert len(bundle.scenes) == 10


def test_bundle_has_evidence_on_intro_concept() -> None:
    raw = json.loads(BUNDLE_PATH.read_text())
    bundle = LessonBundle.model_validate(raw)
    intro_scenes = [s for s in bundle.scenes if s.type == "intro"]
    concept_scenes = [s for s in bundle.scenes if s.type == "concept"]
    assert any(s.evidence is not None for s in intro_scenes), "intro should have evidence"
    assert any(s.evidence is not None for s in concept_scenes), "concept should have evidence"


def test_bundle_has_reproduction_with_abs_asset() -> None:
    raw = json.loads(BUNDLE_PATH.read_text())
    bundle = LessonBundle.model_validate(raw)
    repro_scenes = [s for s in bundle.scenes if s.type == "reproduction"]
    assert len(repro_scenes) >= 1
    repro_with_evidence = [s for s in repro_scenes if s.evidence is not None]
    assert len(repro_with_evidence) >= 1
    abs_asset = repro_with_evidence[0].evidence.abs_asset
    assert abs_asset is not None
    assert "periodic-table" in abs_asset.payload_path
    assert abs_asset.asset_type == "spectrum_viewer_svg"
