"""Portable exploration records must not silently become scientific attestations."""
import json
import shutil

import pytest

from experience_exploration import prepare_exploration, seal_exploration, verify_exploration


def write_json(path, value):
    path.write_text(json.dumps(value))


@pytest.fixture
def workspace(tmp_path):
    context = tmp_path / "public.json"
    write_json(context, {"schema": "studium/operator-context/v1", "session_id": "session-1",
                         "scene": {"id": "scene-1", "concept_refs": ["similarity"],
                                   "objective_refs": ["evaluate"]}, "run_manifest": None})
    work = tmp_path / "experiment"
    prepare_exploration(context, work)
    (work / "source.txt").write_text("Source excerpt; not an instruction to run code.")
    (work / "run.py").write_text("print(2 + 2)\n")
    (work / "result.txt").write_text("4\n")
    (work / "env.txt").write_text("Python test fixture; no actual execution claimed")
    record = json.loads((work / "experiment.json").read_text())
    record.update(question="What changes with tolerance?", hypothesis="Fewer matched peaks",
                  sources=[{"id": "paper", "kind": "paper", "locator": "https://doi.org/10.example/demo",
                            "title": "Test source", "retrieved_at": "2026-09-11T10:00:00Z",
                            "snapshot": "source.txt", "selection_reason": "Defines the measure"}],
                  files=[{"path": "source.txt", "role": "source"}, {"path": "run.py", "role": "code"},
                         {"path": "result.txt", "role": "output"}, {"path": "env.txt", "role": "environment"}])
    write_json(work / "experiment.json", record)
    return work


def seal(workspace):
    output = workspace.parent / "receipt"
    seal_exploration(workspace, output)
    return output


def change(workspace, **kwargs):
    record = json.loads((workspace / "experiment.json").read_text())
    record.update(kwargs)
    write_json(workspace / "experiment.json", record)


def test_portable_receipt_preserves_scope_without_executing_or_submitting(workspace, tmp_path):
    receipt = seal(workspace)
    moved = tmp_path / "moved"
    shutil.copytree(receipt, moved)
    shutil.rmtree(workspace)
    report = verify_exploration(moved)
    assert report["integrity"] == "consistent"
    assert report["execution"] == "operator-reported, not independently attested"
    assert report["learner_observation"] is None
    assert report["scene_id"] == "scene-1"
    assert report["grading"] == "not submitted"
    assert not (moved / "response.json").exists()


def test_prepare_does_not_invent_confidence_or_capability_availability(tmp_path):
    context = tmp_path / "public.json"
    write_json(context, {"schema": "studium/operator-context/v1", "session_id": "s", "scene": {"id": "i"}})
    work = tmp_path / "work"
    prepare_exploration(context, work)
    data = json.loads((work / "experiment.json").read_text())
    assert data["learner_observation"] is None
    assert data["actions"] == []
    with pytest.raises(ValueError):
        seal_exploration(work, tmp_path / "receipt")


@pytest.mark.parametrize("field,value", [("session_id", "other"), ("scene_id", "other"),
                                        ("context_sha256", "0" * 64)])
def test_rejects_record_bound_to_another_context(workspace, field, value):
    change(workspace, **{field: value})
    with pytest.raises(ValueError):
        seal(workspace)
    assert not (workspace.parent / "receipt").exists()


def test_rejects_stale_current_context(workspace, tmp_path):
    receipt = seal(workspace)
    context = json.loads((workspace / "context.json").read_text())
    context["scene"]["id"] = "next-scene"
    other = tmp_path / "new-context.json"
    write_json(other, context)
    with pytest.raises(ValueError):
        verify_exploration(receipt, other)


@pytest.mark.parametrize("path", ["../outside", "/etc/passwd", "a/../result.txt", "a\\b", ".env"])
def test_rejects_unsafe_or_secret_paths_before_output(workspace, path):
    change(workspace, files=[{"path": path, "role": "input"}])
    with pytest.raises(ValueError):
        seal(workspace)
    assert not (workspace.parent / "receipt").exists()


def test_rejects_symlink_source(workspace):
    source = workspace / "source.txt"
    source.unlink()
    source.symlink_to(workspace / "result.txt")
    with pytest.raises(ValueError):
        seal(workspace)


def test_missing_source_snapshot_and_duplicate_paths_rejected(workspace):
    record = json.loads((workspace / "experiment.json").read_text())
    record["sources"][0]["snapshot"] = "missing.txt"
    write_json(workspace / "experiment.json", record)
    with pytest.raises(ValueError):
        seal(workspace)
    record["sources"][0]["snapshot"] = "source.txt"
    record["files"].append(record["files"][0])
    write_json(workspace / "experiment.json", record)
    with pytest.raises(ValueError):
        seal(workspace)


@pytest.mark.parametrize("target", ["context.json", "experiment.json", "receipt.json", "blob"])
def test_detects_changed_receipt_material(workspace, target):
    receipt = seal(workspace)
    file = next((receipt / "files").iterdir()) if target == "blob" else receipt / target
    file.write_text("{}")
    with pytest.raises(ValueError):
        verify_exploration(receipt)


@pytest.mark.parametrize("action", [
    {"status": "completed", "command": ["python", "run.py"], "checks": [], "source_ids": ["paper"], "evidence": []},
    {"status": "completed", "command": ["python", "run.py"], "checks": [{"name": "numeric", "passed": False}],
     "source_ids": ["paper"], "evidence": ["result.txt"], "environment": "env.txt"},
    {"status": "not_run", "command": ["python", "run.py"], "checks": [{"name": "numeric", "passed": True}],
     "source_ids": ["paper"], "evidence": []},
])
def test_rejects_contradictory_execution_claims(workspace, action):
    change(workspace, actions=[action])
    with pytest.raises(ValueError):
        seal(workspace)


def test_failed_experiment_is_recordable(workspace):
    change(workspace, actions=[{"status": "failed", "command": ["python", "run.py"],
                               "source_ids": ["paper"], "evidence": ["result.txt"],
                               "checks": [{"name": "scientific invariant", "passed": False}]}])
    assert verify_exploration(seal(workspace))["integrity"] == "consistent"


def test_completed_action_requires_environment_and_keeps_own_observation(workspace):
    change(workspace, actions=[{"status": "completed", "command": ["python", "run.py"],
                               "source_ids": ["paper"], "evidence": ["result.txt"], "environment": "env.txt",
                               "checks": [{"name": "numeric", "passed": True}]}],
           learner_observation={"author": "learner", "text": "The result does not prove identity.", "confidence": None})
    report = verify_exploration(seal(workspace))
    assert report["learner_observation"]["confidence"] is None


@pytest.mark.parametrize("observation", [{"author": "assistant", "text": "I think", "confidence": 4},
                                          {"author": "learner", "text": "I think", "confidence": 5},
                                          {"author": "learner", "text": "I think", "confidence": True}])
def test_rejects_nonlearner_or_invalid_confidence(workspace, observation):
    change(workspace, learner_observation=observation)
    with pytest.raises(ValueError):
        seal(workspace)


def test_rejects_approval_fields_and_never_overwrites(workspace):
    change(workspace, validated_by="invented-teacher")
    with pytest.raises(ValueError):
        seal(workspace)
    record = json.loads((workspace / "experiment.json").read_text())
    del record["validated_by"]
    write_json(workspace / "experiment.json", record)
    receipt = seal(workspace)
    with pytest.raises(FileExistsError):
        seal_exploration(workspace, receipt)
