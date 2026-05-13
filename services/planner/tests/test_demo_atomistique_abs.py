"""Validate ABS capsule for demo-atomistique fixture."""

from pathlib import Path
import json

REPO_ROOT = Path(__file__).resolve().parents[3]
CAPSULE_DIR = REPO_ROOT / "fixtures/m6/demo-atomistique/abs-capsule"


def test_task_card_exists_and_valid() -> None:
    card_path = CAPSULE_DIR / "task_card.json"
    assert card_path.is_file()
    data = json.loads(card_path.read_text())
    assert data["task_id"] == "task-atom-001"
    assert data["title"]
    assert "assets" in data


def test_periodic_table_asset_present() -> None:
    asset_path = CAPSULE_DIR / "assets/task-atom-001/periodic-table.svg"
    assert asset_path.is_file()
    content = asset_path.read_text()
    assert "<svg" in content
    assert "</svg>" in content
    # Sanity: minimum element labels visible
    for symbol in ["H", "He", "C", "N", "O", "Na"]:
        assert f">{symbol}<" in content or f"\"{symbol}\"" in content
