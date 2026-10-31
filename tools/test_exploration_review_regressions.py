"""Adversarial review cases for local snapshot boundaries."""
import json

import pytest

import experience_exploration as exploration
from test_experience_exploration import workspace, seal


@pytest.mark.parametrize("extra", [
    {"credentials": {"token": "PRIVATE-CANARY"}},
    {"scene": {"id": "scene-1", "answer_key": "PRIVATE-CANARY"}},
    {"scene_assets": [{"kind": "code", "meta": {"answer_key": "PRIVATE-CANARY"}}]},
    {"response": {"kind": "quiz_choice", "example": {"correct": "PRIVATE-CANARY"}}},
    {"run_manifest": {"cmd": ["python"], "env": {"token": "PRIVATE-CANARY"}}},
])
def test_private_context_fields_are_rejected_before_copy(workspace, tmp_path, extra):
    context = json.loads((workspace / "context.json").read_text())
    context.update(extra)
    source = tmp_path / "private.json"
    source.write_text(json.dumps(context))
    output = tmp_path / "prepared"
    with pytest.raises(ValueError):
        exploration.prepare_exploration(source, output)
    assert not output.exists()


def test_capture_stops_reading_at_total_budget(workspace, monkeypatch):
    original = exploration._read_material
    observed = []
    def read(root, relative):
        observed.append(relative)
        return original(root, relative)
    monkeypatch.setattr(exploration, "MAX_TOTAL_BYTES", 1)
    monkeypatch.setattr(exploration, "_read_material", read)
    with pytest.raises(ValueError):
        seal(workspace)
    assert "run.py" not in observed


@pytest.mark.parametrize("name", ["context.json", "experiment.json"])
def test_document_byte_changes_are_detected(workspace, name):
    receipt = seal(workspace)
    with (receipt / name).open("a") as handle:
        handle.write("  ")
    with pytest.raises(ValueError):
        exploration.verify_exploration(receipt)


@pytest.mark.parametrize("name", ["extra.txt", "files/extra.txt"])
def test_unlisted_files_are_rejected(workspace, name):
    receipt = seal(workspace)
    (receipt / name).write_text("not captured")
    with pytest.raises(ValueError):
        exploration.verify_exploration(receipt)


def test_control_document_symlink_is_rejected(workspace):
    original = workspace / "context.json"
    target = workspace.parent / "outside.json"
    original.rename(target)
    original.symlink_to(target)
    with pytest.raises(ValueError):
        seal(workspace)


def test_duplicate_json_keys_are_rejected(workspace):
    original = workspace / "context.json"
    original.write_text(original.read_text().replace('"session_id": "session-1"',
                                                    '"session_id": "session-1", "session_id": "session-1"'))
    with pytest.raises(ValueError):
        seal(workspace)
