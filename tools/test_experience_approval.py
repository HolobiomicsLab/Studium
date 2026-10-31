"""Reviewed LessonPlan approval and synthesis continuity contracts."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from experience_approval import (
    ApprovalError,
    approve_plan,
    attach_exploration,
    import_checked_review,
    synthesize_approved_plan,
    verify_approval,
)
from experience_packet import check_response, prepare_packet
from experience_exploration import prepare_exploration, seal_exploration


ROOT = Path(__file__).resolve().parents[1]
SCENE_SYNTH = ROOT / "services" / "scene-synth"
EXAMPLE = ROOT / "examples" / "literature-experience"


class RecordingOrchestrator:
    """Deterministic substitute for the existing orchestrator boundary."""

    def __init__(self, artifact: Path, *, failure: Exception | None = None):
        self.artifact = artifact
        self.failure = failure
        self.calls: list[tuple[dict, dict]] = []

    def synthesize_lesson(self, lesson_plan: dict, options: dict) -> dict:
        self.calls.append((lesson_plan, options))
        if self.failure:
            raise self.failure
        self.artifact.write_bytes(b"deterministic lesson bundle")
        return {
            "bundle_uri": self.artifact.as_uri(),
            "scenes_generated": 2,
            "prov_graph_nodes": 4,
            "warnings": [],
        }


@pytest.fixture
def checked_review(tmp_path: Path) -> Path:
    """Create a real checked source-backed draft using the existing checker."""
    packet = tmp_path / "packet"
    prepare_packet(
        passages_path=EXAMPLE / "passages.json",
        output_dir=packet,
        title="Spectral evidence",
        target=None,
    )
    checked = tmp_path / "checked"
    check_response(
        packet_dir=packet,
        response_path=EXAMPLE / "author-response.json",
        output_dir=checked,
    )
    return checked


def _workspace(checked_review: Path, tmp_path: Path) -> Path:
    return import_checked_review(checked_review, tmp_path / "teacher-workspace")


def _exploration_receipt(tmp_path: Path, scene_id: str = "inspect-matching") -> Path:
    context = tmp_path / f"{scene_id}-context.json"
    context.write_text(json.dumps({
        "schema": "studium/operator-context/v1",
        "session_id": "PRIVATE-SESSION",
        "scene": {"id": scene_id},
    }))
    exploration = tmp_path / f"{scene_id}-exploration"
    prepare_exploration(context, exploration)
    (exploration / "source.txt").write_text("Scientific source snapshot")
    (exploration / "run.py").write_text("print(4)\n")
    (exploration / "result.txt").write_text("4\n")
    (exploration / "environment.txt").write_text("deterministic fixture")
    record = json.loads((exploration / "experiment.json").read_text())
    record.update({
        "question": "PRIVATE-QUESTION",
        "hypothesis": "PRIVATE-HYPOTHESIS",
        "sources": [{
            "id": "paper-source", "kind": "paper", "locator": "doi:10.example/test",
            "title": "Synthetic test source", "retrieved_at": "2026-09-11T10:00:00Z",
            "snapshot": "source.txt", "selection_reason": "Defines the calculation",
        }],
        "files": [
            {"path": "source.txt", "role": "source"},
            {"path": "run.py", "role": "code"},
            {"path": "result.txt", "role": "output"},
            {"path": "environment.txt", "role": "environment"},
        ],
        "actions": [{
            "status": "completed", "command": ["python", "run.py"],
            "source_ids": ["paper-source"], "evidence": ["result.txt"],
            "environment": "environment.txt",
            "checks": [{"name": "numeric oracle", "passed": True}],
        }],
        "learner_observation": {
            "author": "learner", "text": "PRIVATE-OBSERVATION", "confidence": 2,
        },
    })
    (exploration / "experiment.json").write_text(json.dumps(record))
    receipt = tmp_path / f"{scene_id}-receipt"
    seal_exploration(exploration, receipt)
    return receipt


def test_edited_draft_survives_approval_and_synthesis_without_replan(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    plan_path = workspace / "plan.json"
    plan = json.loads(plan_path.read_text())
    plan["title"] = "Teacher-reviewed spectral evidence"
    plan["scene_outlines"][0]["notes"] = "Use the exact captured passage."
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")

    receipt = approve_plan(
        workspace,
        teacher_identity="teacher-local:lfx",
        approved_at="2026-09-11T10:00:00Z",
    )
    reloaded = verify_approval(workspace)
    assert reloaded.receipt_hash == receipt.receipt_hash

    orchestrator = RecordingOrchestrator(tmp_path / "lesson.zip")
    synthesis = synthesize_approved_plan(
        workspace, orchestrator, options={"include_critique": False}
    )

    assert orchestrator.calls == [(plan, {"include_critique": False})]
    assert synthesis.input_receipt_hash == receipt.receipt_hash
    assert synthesis.reviewed_plan_hash == receipt.plan_hash
    assert synthesis.artifact_sha256
    assert synthesis.generated_content_approved is False
    assert synthesis.student_release_approved is False
    page = (workspace / "course_provenance.myst.md").read_text()
    assert "teacher-local:lfx" in page
    assert "precursor mass" in page
    assert synthesis.artifact_sha256 in page
    assert "operator-declared" in page
    assert "student release remains unapproved" in page


@pytest.mark.parametrize(
    "failure_mode", ["missing", "plan", "evidence", "source_links", "viewers", "receipt"]
)
def test_missing_stale_or_tampered_approval_stops_before_generator_call(
    checked_review: Path, tmp_path: Path, failure_mode: str
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    if failure_mode != "missing":
        approve_plan(workspace, teacher_identity="teacher-local:lfx")

    if failure_mode == "plan":
        value = json.loads((workspace / "plan.json").read_text())
        value["title"] = "Changed after review"
        (workspace / "plan.json").write_text(json.dumps(value))
    elif failure_mode == "evidence":
        value = json.loads((workspace / "evidence.json").read_text())
        value["title"] = "Changed supporting input"
        (workspace / "evidence.json").write_text(json.dumps(value))
    elif failure_mode == "source_links":
        value = json.loads((workspace / "source_links.json").read_text())
        value["source_links"][0]["quote"] += " tampered"
        (workspace / "source_links.json").write_text(json.dumps(value))
    elif failure_mode == "viewers":
        value = json.loads((workspace / "viewers.json").read_text())
        value[0]["goal"] += " tampered"
        (workspace / "viewers.json").write_text(json.dumps(value))
    elif failure_mode == "receipt":
        value = json.loads((workspace / "plan-approval.json").read_text())
        value["approved_by"] = "invented-teacher"
        (workspace / "plan-approval.json").write_text(json.dumps(value))

    orchestrator = RecordingOrchestrator(tmp_path / "must-not-exist.zip")
    with pytest.raises(ApprovalError):
        synthesize_approved_plan(workspace, orchestrator)
    assert orchestrator.calls == []


def test_failed_synthesis_preserves_approval_and_can_be_retried(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    receipt = approve_plan(workspace, teacher_identity="teacher-local:lfx")

    failing = RecordingOrchestrator(
        tmp_path / "failed.zip", failure=RuntimeError("generator unavailable")
    )
    with pytest.raises(ApprovalError, match="generator unavailable"):
        synthesize_approved_plan(workspace, failing)

    assert verify_approval(workspace).receipt_hash == receipt.receipt_hash
    assert not (workspace / "synthesis.json").exists()
    attempt = json.loads((workspace / "synthesis-attempts.jsonl").read_text().splitlines()[-1])
    assert attempt["status"] == "failed"
    assert attempt["student_release_approved"] is False

    working = RecordingOrchestrator(tmp_path / "retry.zip")
    result = synthesize_approved_plan(workspace, working)
    assert result.status == "succeeded"
    assert verify_approval(workspace).receipt_hash == receipt.receipt_hash


def test_concurrent_edit_keeps_generated_artifact_unverified(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    approve_plan(workspace, teacher_identity="teacher-local:lfx")

    class EditingOrchestrator(RecordingOrchestrator):
        def synthesize_lesson(self, lesson_plan: dict, options: dict) -> dict:
            result = super().synthesize_lesson(lesson_plan, options)
            stored = json.loads((workspace / "plan.json").read_text())
            stored["title"] = "Concurrent unreviewed edit"
            (workspace / "plan.json").write_text(json.dumps(stored))
            return result

    orchestrator = EditingOrchestrator(tmp_path / "concurrent.zip")
    with pytest.raises(ApprovalError, match="may be retried"):
        synthesize_approved_plan(workspace, orchestrator)

    assert not (workspace / "synthesis.json").exists()
    attempt = json.loads((workspace / "synthesis-attempts.jsonl").read_text().splitlines()[-1])
    assert attempt["artifact_status"] == "unverified"
    assert attempt["unverified_artifact_sha256"]


def test_orchestrator_cannot_mutate_reviewed_plan_and_still_bind_artifact(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    approve_plan(workspace, teacher_identity="teacher-local:lfx")

    class MutatingOrchestrator(RecordingOrchestrator):
        def synthesize_lesson(self, lesson_plan: dict, options: dict) -> dict:
            result = super().synthesize_lesson(lesson_plan, options)
            lesson_plan["title"] = "Mutated by generator"
            return result

    with pytest.raises(ApprovalError, match="mutated the reviewed plan"):
        synthesize_approved_plan(
            workspace, MutatingOrchestrator(tmp_path / "mutated.zip")
        )
    assert not (workspace / "synthesis.json").exists()


def test_interrupted_synthesis_is_recorded_and_retryable(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    receipt = approve_plan(workspace, teacher_identity="teacher-local:lfx")
    interrupted = RecordingOrchestrator(
        tmp_path / "interrupted.zip", failure=InterruptedError("connection interrupted")
    )

    with pytest.raises(ApprovalError, match="connection interrupted"):
        synthesize_approved_plan(workspace, interrupted)

    assert verify_approval(workspace).receipt_hash == receipt.receipt_hash
    assert not (workspace / "synthesis.json").exists()
    attempt = json.loads((workspace / "synthesis-attempts.jsonl").read_text().splitlines()[-1])
    assert attempt["error_type"] == "InterruptedError"
    working = RecordingOrchestrator(tmp_path / "after-interrupt.zip")
    assert synthesize_approved_plan(workspace, working).status == "succeeded"


def test_workflow_calls_the_real_orchestrator_seam_with_deterministic_agents(
    checked_review: Path, tmp_path: Path
) -> None:
    """Exercise SceneSynthOrchestrator.synthesize_lesson without a model call."""
    if str(SCENE_SYNTH) not in sys.path:
        sys.path.insert(0, str(SCENE_SYNTH))
    from orchestrator import SceneSynthOrchestrator

    class LLM:
        def complete(self, prompt: str) -> str:
            return json.dumps({
                "id": "read-source", "type": "concept", "title": "Scientific concept",
                "markdown": "A deterministic, schema-validated concept scene.",
            })

    class Critic:
        def review(self, scene, outline):
            return SimpleNamespace(passed=True)

    workspace = _workspace(checked_review, tmp_path)
    plan = json.loads((workspace / "plan.json").read_text())
    plan["concepts"][0]["id"] = "o-matching"
    plan["rules"] = []
    (workspace / "plan.json").write_text(json.dumps(plan))
    approve_plan(workspace, teacher_identity="teacher-local:lfx")
    orchestrator = SceneSynthOrchestrator(
        llm_client=None,
        critic=None,
        abs_capsule_root=tmp_path,
        output_dir=tmp_path / "bundles",
    )

    orchestrator.agents["concept"].llm = LLM()
    orchestrator.agents["concept"].critic = Critic()
    result = synthesize_approved_plan(
        workspace, orchestrator, options={"include_critique": False}
    )

    assert result.status == "succeeded"
    assert Path(result.artifact_uri.removeprefix("file://")).is_file()


def test_json_formatting_does_not_stale_a_canonical_approval(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    receipt = approve_plan(workspace, teacher_identity="teacher-local:lfx")
    plan = json.loads((workspace / "plan.json").read_text())
    (workspace / "plan.json").write_text(json.dumps(plan, separators=(",", ":")))

    assert verify_approval(workspace).receipt_hash == receipt.receipt_hash


def test_attach_exploration_exposes_only_verified_technical_summary(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    receipt = _exploration_receipt(tmp_path)

    summary = attach_exploration(workspace, receipt)

    assert summary["scene_id"] == "inspect-matching"
    assert summary["structured_learner_fields_excluded"] is True
    index_text = (workspace / "exploration-summaries.json").read_text()
    page = (workspace / "course_provenance.myst.md").read_text()
    for private_value in (
        "PRIVATE-SESSION", "PRIVATE-QUESTION", "PRIVATE-HYPOTHESIS", "PRIVATE-OBSERVATION"
    ):
        assert private_value not in index_text
        assert private_value not in page
    assert "numeric oracle=pass" in page
    assert "paper-source (doi:10.example/test)" in page
    assert "result.txt [output" in page
    assert not (workspace / "exploration-receipts").exists()


def test_attach_exploration_rejects_wrong_scene_and_tampered_receipt(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    wrong_scene = _exploration_receipt(tmp_path, scene_id="absent-scene")
    with pytest.raises(ApprovalError, match="scene is absent"):
        attach_exploration(workspace, wrong_scene)

    receipt = _exploration_receipt(tmp_path, scene_id="inspect-matching")
    (receipt / "experiment.json").write_text("{}")
    with pytest.raises(ApprovalError, match="invalid exploration receipt"):
        attach_exploration(workspace, receipt)
    assert not (workspace / "exploration-summaries.json").exists()


def test_reapproval_archives_previous_synthesis_binding(
    checked_review: Path, tmp_path: Path
) -> None:
    workspace = _workspace(checked_review, tmp_path)
    approve_plan(
        workspace, teacher_identity="teacher-local:lfx",
        approved_at="2026-09-11T10:00:00Z",
    )
    first = synthesize_approved_plan(
        workspace, RecordingOrchestrator(tmp_path / "first.zip")
    )
    plan = json.loads((workspace / "plan.json").read_text())
    plan["title"] = "New reviewed revision"
    (workspace / "plan.json").write_text(json.dumps(plan))

    second_receipt = approve_plan(
        workspace, teacher_identity="teacher-local:lfx",
        approved_at="2026-09-11T11:00:00Z",
    )

    assert not (workspace / "synthesis.json").exists()
    archived = list((workspace / "synthesis-history").glob("synthesis-*.json"))
    assert len(archived) == 1
    assert json.loads(archived[0].read_text())["artifact_sha256"] == first.artifact_sha256
    assert verify_approval(workspace).receipt_hash == second_receipt.receipt_hash
    page = (workspace / "course_provenance.myst.md").read_text()
    assert first.artifact_sha256 not in page
