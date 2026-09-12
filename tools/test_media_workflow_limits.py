"""Regress the real request handoff and cumulative attachment boundaries."""
import base64
import json

import pytest

import media_workflow as workflow
from test_media_workflow import EXAMPLES, brief, prepared_activity, source_metadata


def test_prepare_writes_readable_prompt_and_refuses_existing_prompt(tmp_path):
    activity = prepared_activity(tmp_path)
    request = workflow.prepare_request(activity, brief(tmp_path), activity / "request.json")
    prompt = activity / request["meta"]["generation"]["download_filename"]
    assert prompt.read_text() == request["payload"]
    with pytest.raises(FileExistsError):
        workflow.prepare_request(activity, brief(tmp_path), activity / "second-request.json")
    assert not (activity / "second-request.json").exists()


def test_attach_exposes_request_and_enforces_combined_image_budget(tmp_path, monkeypatch):
    activity = prepared_activity(tmp_path)
    request_path = activity / "request.json"
    request = workflow.prepare_request(activity, brief(tmp_path), request_path)
    image = tmp_path / "image.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text()))
    source = source_metadata(tmp_path)
    first = workflow.attach_media(request_path, image, source, tmp_path / "first")
    assets = json.loads((first / "presentation.json").read_text())["render_assets"]
    assert request in assets
    assert sum(a["kind"] == "image" for a in assets) == 1
    monkeypatch.setattr(workflow, "MAX_TOTAL_IMAGE_BYTES", image.stat().st_size)
    with pytest.raises(workflow.MediaWorkflowError, match="aggregate image"):
        workflow.attach_media(first / "media-request.json", image, source, tmp_path / "over-budget")
    assert not (tmp_path / "over-budget").exists()


def test_combined_asset_limit_applies_to_existing_parent(tmp_path, monkeypatch):
    activity = prepared_activity(tmp_path)
    request_path = activity / "request.json"
    workflow.prepare_request(activity, brief(tmp_path), request_path)
    image = tmp_path / "image.png"
    image.write_bytes(base64.b64decode((EXAMPLES / "tiny-image.png.base64").read_text()))
    source = source_metadata(tmp_path)
    first = workflow.attach_media(request_path, image, source, tmp_path / "first")
    monkeypatch.setattr(workflow, "MAX_ASSETS", 2)
    with pytest.raises(workflow.MediaWorkflowError, match="asset count"):
        workflow.attach_media(first / "media-request.json", image, source, tmp_path / "too-many")
    assert not (tmp_path / "too-many").exists()
