"""Tests unitaires abs_asset_extractor."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock
from planner_schemas import SceneType
from evidence.abs_asset_extractor import extract_asset


def _make_capsule(asset_files: dict[str, str], task_id: str = "task-1"):
    capsule = MagicMock()
    capsule.task_cards = [MagicMock(task_id=task_id, title="Test Task")]
    capsule.rocrate_uri = "urn:abs:rocrate:test"
    capsule.assets_by_task = {task_id: asset_files}
    return capsule


def test_extract_asset_returns_none_when_no_task_card_id():
    asset = extract_asset(
        scene_type=SceneType.concept,
        abs_task_card_id=None,
        capsule=_make_capsule({"spectrum.svg": "<svg/>"}),
    )
    assert asset is None


def test_extract_asset_concept_intro_returns_none():
    asset = extract_asset(
        scene_type=SceneType.concept,
        abs_task_card_id="task-1",
        capsule=_make_capsule({"spectrum.svg": "<svg/>"}),
    )
    assert asset is None


def test_extract_asset_simulation_picks_spectrum_svg():
    asset = extract_asset(
        scene_type=SceneType.simulation,
        abs_task_card_id="task-1",
        capsule=_make_capsule({"spectrum.svg": "<svg/>"}),
    )
    assert asset is not None
    assert asset.asset_type == "spectrum_viewer_svg"
    assert asset.payload_inline == "<svg/>"
    assert asset.abs_task_card_id == "task-1"
    assert asset.prov_derived_from == "urn:abs:rocrate:test"


def test_extract_asset_simulation_fallback_code_snippet():
    asset = extract_asset(
        scene_type=SceneType.simulation,
        abs_task_card_id="task-1",
        capsule=_make_capsule({"script.py": "print('hi')"}),
    )
    assert asset is not None
    assert asset.asset_type == "code_snippet"
    assert asset.payload_inline == "print('hi')"


def test_extract_asset_reproduction_picks_protocol_md():
    asset = extract_asset(
        scene_type=SceneType.reproduction,
        abs_task_card_id="task-1",
        capsule=_make_capsule({"protocol.md": "# Protocol"}),
    )
    assert asset is not None
    assert asset.asset_type == "protocol_card_md"


def test_extract_asset_payload_path_when_too_large():
    big_payload = "x" * (100 * 1024 + 1)
    asset = extract_asset(
        scene_type=SceneType.simulation,
        abs_task_card_id="task-1",
        capsule=_make_capsule({"spectrum.svg": big_payload}),
    )
    assert asset is not None
    assert asset.payload_inline is None
    assert asset.payload_path is not None
    assert "spectrum.svg" in asset.payload_path
