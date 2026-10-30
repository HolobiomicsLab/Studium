"""Tests for provider-neutral media requests and checked local attachment."""

from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from experience_templates import prepare_activity
from media_workflow import MediaWorkflowError, attach_media, prepare_request


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "media"


def write_json(path: Path, value: object) -> Path:
    """Write JSON and return its path."""
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def prepared_activity(tmp_path: Path) -> Path:
    """Create a real public activity directory."""
    context = write_json(tmp_path / "context.json", {
        "schema": "studium/operator-context/v1", "session_id": "public-session",
        "scene": {"id": "scene-media", "title": "Compare evidence", "objective_refs": ["evidence"]},
        "run_manifest": None,
    })
    output = tmp_path / "activity"
    prepare_activity("evidence-claim", context, output)
    return output


def brief(tmp_path: Path, **updates: object) -> Path:
    """Copy the example request brief with selected updates."""
    value = json.loads((EXAMPLES / "teacher-brief.json").read_text(encoding="utf-8"))
    value.update(updates)
    return write_json(tmp_path / "brief.json", value)


def source_metadata(tmp_path: Path, **updates: object) -> Path:
    """Copy the example origin/rights claim with selected updates."""
    value = json.loads((EXAMPLES / "source-metadata.json").read_text(encoding="utf-8"))
    value.update(updates)
    return write_json(tmp_path / "source.json", value)


def tree_hashes(directory: Path) -> dict[str, str]:
    """Hash every regular file below a directory."""
    return {
        str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.rglob("*")) if path.is_file()
    }


def test_prepare_emits_bound_render_asset_without_private_history(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    (activity / "LEARNER_ACTIONS.json").write_text("PRIVATE-STUDENT-ANSWER", encoding="utf-8")
    request_path = activity / "media-request.json"

    request = prepare_request(activity, brief(tmp_path), request_path)

    assert request["kind"] == "protocol_md"
    assert request["format"] == "studium-media-prompt"
    generation = request["meta"]["generation"]
    activity_document = json.loads((activity / "activity.json").read_text(encoding="utf-8"))
    assert generation["activity_id"] == activity_document["activity_id"]
    assert generation["activity_sha256"] == hashlib.sha256(
        json.dumps(activity_document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    assert generation["expected_output"] == "image"
    assert generation["placement"] == "after_prediction"
    assert request["meta"]["placement"] == "after_prediction"
    assert "Target language: en" in request["payload"]
    assert "Output: image/png as evidence-reconstruction.png" in request["payload"]
    assert "transcript_required=false" in request["payload"]
    assert "captions_required=false" in request["payload"]
    assert "Label any generated reconstruction as a reconstruction" in request["payload"]
    assert "Studium has not selected or called a provider" in request["payload"]
    assert "media_workflow.py attach" in request["payload"]
    assert "PRIVATE-STUDENT-ANSWER" not in json.dumps(request)
    assert set(request) == {"kind", "title", "payload", "language", "format", "provenance", "meta"}


def test_prompt_stays_after_prediction_when_output_is_requested_before_prediction(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)

    request = prepare_request(
        activity, brief(tmp_path, placement="before_prediction"), activity / "media-request.json",
    )

    assert request["meta"]["placement"] == "after_prediction"
    assert request["meta"]["generation"]["placement"] == "before_prediction"


def test_attach_checks_real_image_and_preserves_source_tree_and_activity_identity(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    request = prepare_request(activity, brief(tmp_path), request_path)
    private = activity / "LEARNER_ACTIONS.json"
    private.write_text('{"answer":"PRIVATE"}', encoding="utf-8")
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))
    before = tree_hashes(activity)
    output = tmp_path / "enriched"

    result = attach_media(request_path, image, source_metadata(tmp_path), output)

    assert result == output.resolve()
    assert tree_hashes(activity) == before
    assert (output / "activity.json").read_bytes() == (activity / "activity.json").read_bytes()
    assert not (output / private.name).exists()
    presentation = json.loads((output / "presentation.json").read_text(encoding="utf-8"))
    attached = presentation["render_assets"][-1]
    assert attached["kind"] == "image" and attached["path"].startswith("data:image/png;base64,")
    assert attached["meta"]["origin"] == "generated"
    assert attached["meta"]["placement"] == "after_prediction"
    assert attached["meta"]["rights"]["scope"] == "private"
    assert "<img" in (output / "index.html").read_text(encoding="utf-8")
    provenance = json.loads((output / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["parent_activity_sha256"] == generation_hash(request)
    assert provenance["media_request_sha256"] == hashlib.sha256(request_path.read_bytes()).hexdigest()
    assert provenance["media_output_sha256"] == hashlib.sha256(image.read_bytes()).hexdigest()
    assert provenance["rights_status"] == "authored claim; not automatically certified"
    assert (output / "media" / "evidence-reconstruction.png").read_bytes() == image.read_bytes()


def test_attach_accepts_five_mib_parent_image_and_preserves_both_assets(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    prepare_request(activity, brief(tmp_path), request_path)
    large_image = b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024 - 8)
    parent_asset = {
        "kind": "image",
        "title": "Existing rich support",
        "path": "data:image/png;base64," + base64.b64encode(large_image).decode("ascii"),
        "provenance": "Previously prepared local support.",
        "meta": {"alt": "Existing rich support image.", "origin": "source"},
    }
    write_json(activity / "presentation.json", {
        "language": "en", "translations": {}, "render_assets": [parent_asset],
    })
    assert (activity / "presentation.json").stat().st_size > 1_000_000
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))

    attach_media(request_path, image, source_metadata(tmp_path), tmp_path / "enriched")

    presentation = json.loads((tmp_path / "enriched" / "presentation.json").read_text(encoding="utf-8"))
    assert presentation["render_assets"][0] == parent_asset
    assert [asset["kind"] for asset in presentation["render_assets"]] == ["image", "protocol_md", "image"]
    assert presentation["render_assets"][-1]["path"].startswith("data:image/png;base64,")


def test_repeated_attachment_appends_linear_provenance_and_keeps_prior_media(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    first_request_path = activity / "media-request.json"
    first_request = prepare_request(activity, brief(tmp_path), first_request_path)
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))
    first_source = source_metadata(tmp_path)
    first_output = tmp_path / "enriched-1"
    attach_media(first_request_path, image, first_source, first_output)
    first_presentation = json.loads((first_output / "presentation.json").read_text(encoding="utf-8"))

    second_request_path = first_output / "media-request-2.json"
    second_request = prepare_request(
        first_output,
        brief(tmp_path, output_filename="second-reconstruction.png"),
        second_request_path,
    )
    second_source = source_metadata(tmp_path, title="Second teacher-reviewed reconstruction")
    second_output = tmp_path / "enriched-2"
    attach_media(second_request_path, image, second_source, second_output)

    presentation = json.loads((second_output / "presentation.json").read_text(encoding="utf-8"))
    assert presentation["render_assets"][0] == first_presentation["render_assets"][0]
    assert [asset["kind"] for asset in presentation["render_assets"]] == ["protocol_md", "image", "protocol_md", "image"]
    provenance = json.loads((second_output / "provenance.json").read_text(encoding="utf-8"))
    history = provenance["media_attachment_history"]
    assert [entry["request"]["meta"]["generation"]["output_filename"] for entry in history] == [
        first_request["meta"]["generation"]["output_filename"],
        second_request["meta"]["generation"]["output_filename"],
    ]
    assert history[0]["source_metadata"]["title"] == "Explanatory support · awaiting teacher review"
    assert history[1]["source_metadata"]["title"] == "Second teacher-reviewed reconstruction"
    assert all("media_request_sha256" in entry and "media_output_sha256" in entry for entry in history)
    assert "media_attachment_history" not in json.dumps(history)


def test_attachment_history_has_a_bounded_asset_count(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    prepare_request(activity, brief(tmp_path), request_path)
    provenance_path = activity / "provenance.json"
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    provenance["media_attachment_history"] = [{} for _ in range(64)]
    write_json(provenance_path, provenance)
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))

    with pytest.raises(MediaWorkflowError, match="history limit"):
        attach_media(request_path, image, source_metadata(tmp_path), tmp_path / "enriched")

    assert not (tmp_path / "enriched").exists()


def generation_hash(request: dict) -> str:
    """Return the activity digest bound by a generation request."""
    return request["meta"]["generation"]["activity_sha256"]


def test_attach_rejects_stale_activity_and_does_not_create_output(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    prepare_request(activity, brief(tmp_path), request_path)
    activity_document = json.loads((activity / "activity.json").read_text(encoding="utf-8"))
    activity_document["scope"] = "changed after request"
    write_json(activity / "activity.json", activity_document)
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))
    output = tmp_path / "enriched"

    with pytest.raises(MediaWorkflowError, match="stale"):
        attach_media(request_path, image, source_metadata(tmp_path), output)
    assert not output.exists()


@pytest.mark.parametrize(
    ("kind", "fmt", "filename", "transcript", "captions", "match"),
    [
        ("audio", "mp3", "explanation.mp3", None, None, "transcript"),
        ("video", "mp4", "demonstration.mp4", "transcript.txt", None, "captions"),
    ],
)
def test_attach_requires_accessibility_files_before_media_validation(
    tmp_path: Path, kind: str, fmt: str, filename: str,
    transcript: str | None, captions: str | None, match: str,
) -> None:
    activity = prepared_activity(tmp_path)
    accessibility = {"alt": "Accessible explanation", "transcript_required": True, "captions_required": kind == "video"}
    request_path = activity / "media-request.json"
    prepare_request(activity, brief(tmp_path, expected_output=kind, expected_format=fmt,
                                    output_filename=filename, accessibility=accessibility), request_path)
    media = tmp_path / filename
    media.write_bytes(b"not inspected before accessibility validation")
    transcript_path = (tmp_path / transcript) if transcript else None
    if transcript_path: transcript_path.write_text("Transcript", encoding="utf-8")

    with pytest.raises(MediaWorkflowError, match=match):
        attach_media(request_path, media, source_metadata(tmp_path), tmp_path / "out",
                     transcript_path=transcript_path,
                     captions_path=(tmp_path / captions) if captions else None)


def test_rejects_symlink_media_and_unknown_rights_outside_private_scope(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    prepare_request(activity, brief(tmp_path), request_path)
    real = tmp_path / "real.png"
    real.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))
    linked = tmp_path / "linked.png"
    linked.symlink_to(real)
    with pytest.raises(MediaWorkflowError, match="missing"):
        attach_media(request_path, tmp_path / "missing.png", source_metadata(tmp_path), tmp_path / "missing-out")
    with pytest.raises(MediaWorkflowError, match="symlink"):
        attach_media(request_path, linked, source_metadata(tmp_path), tmp_path / "linked-out")
    public_unknown = source_metadata(tmp_path, rights={
        "creator": "unknown", "license": "unknown", "evidence_url": "unknown", "scope": "public",
    })
    with pytest.raises(MediaWorkflowError, match="private"):
        attach_media(request_path, real, public_unknown, tmp_path / "rights-out")
    local_evidence = source_metadata(tmp_path, rights={
        "creator": "Museum", "license": "course permission",
        "evidence_url": "file:///private/source.txt", "scope": "course",
    })
    with pytest.raises(MediaWorkflowError, match=r"HTTP\(S\) or URN"):
        attach_media(request_path, real, local_evidence, tmp_path / "local-evidence-out")


def test_prepare_rejects_traversal_filename_and_request_outside_activity(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    with pytest.raises(MediaWorkflowError, match="inside"):
        prepare_request(activity, brief(tmp_path), tmp_path / "outside-request.json")
    with pytest.raises(MediaWorkflowError, match="basename"):
        prepare_request(activity, brief(tmp_path, output_filename="../escape.png"), activity / "media-request.json")


def test_cli_prepares_without_provider_and_attaches_local_output(tmp_path: Path) -> None:
    activity = prepared_activity(tmp_path)
    request_path = activity / "media-request.json"
    prepared = subprocess.run([
        sys.executable, str(ROOT / "tools" / "media_workflow.py"), "prepare",
        "--activity", str(activity), "--brief", str(brief(tmp_path)), "--out", str(request_path),
    ], text=True, capture_output=True)
    assert prepared.returncode == 0, prepared.stderr
    assert json.loads(prepared.stdout)["request"] == str(request_path.resolve())
    image = tmp_path / "generated.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text().strip()))
    output = tmp_path / "enriched"
    attached = subprocess.run([
        sys.executable, str(ROOT / "tools" / "media_workflow.py"), "attach",
        "--request", str(request_path), "--media", str(image),
        "--source-metadata", str(source_metadata(tmp_path)), "--out", str(output),
    ], text=True, capture_output=True)
    assert attached.returncode == 0, attached.stderr
    assert json.loads(attached.stdout)["output"] == str(output.resolve())
