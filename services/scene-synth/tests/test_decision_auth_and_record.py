"""A decision on a learner item is an authenticated, recorded teacher act (audit D6).

Reproduced defect: a learner could approve their own contribution by calling
``POST /learner-items/<id>/decide`` from the learner app's origin, without any credential,
naming any reviewer. These tests pin the fix:

- the route needs ``STUDIUM_REVIEW_TOKEN`` (>= 32 characters) as a bearer token; unset or
  too short, every decision is refused (503); missing or wrong, 401; from a browser origin,
  403 and no CORS grant. Nothing is written on any refusal;
- approve emits ``community-<id>.zip`` holding ``approval.json`` (``studium-approval/1``)
  bound to the sha256 of the exact ``lesson.json`` member, and ``drafted_by: learner``;
- the reviewer is a declared name: empty, longer than 200 characters, the author's own
  handle or pseudonym is refused;
- the decision log records who, when, what, the item and the published hash, never the token;
  the token appears in no response, no log record and no written file.

LLM-free, deterministic: TestClient on tmp roots, tokens generated per test.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import scene_synth_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from learner_items_store import LearnerItemsStore  # noqa: E402
from learner_review import decide_item, decision_log_path  # noqa: E402

_TEACHER = "Mme Synthetic-Audit Teacher"
_TS = "2026-11-10T09:00:00Z"
_LEARNER_HANDLE = "synthetic-audit-author"
_LEARNER_ORIGIN = "http://localhost:3000"
_DASHBOARD_ORIGIN = "http://localhost:3001"


def _quiz_scene() -> dict:
    return {
        "id": "s-la-001",
        "type": "quiz",
        "title": "Nœuds radiaux de la 3s",
        "objective_refs": [],
        "concept_refs": ["c-orbitales-formes"],
        "estimated_seconds": 60,
        "adaptation_hooks": [],
        "question": "Combien de nœuds radiaux possède l'orbitale 3s ?",
        "choices": [
            {"id": "a", "text": "0", "correct": False},
            {"id": "b", "text": "2", "correct": True},
        ],
        "feedback_correct": "Oui : n−ℓ−1 = 2.",
        "feedback_incorrect": "Rappel : n−ℓ−1.",
        "hints": [],
    }


@pytest.fixture
def env(tmp_path: Path, monkeypatch):
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    monkeypatch.setattr(scene_synth_app, "_learner_store", store, raising=False)
    monkeypatch.delenv("BUNDLES_ROOT", raising=False)
    monkeypatch.setenv("COMMUNITY_BUNDLES_ROOT", str(tmp_path / "bundles"))
    monkeypatch.setenv("LEARNER_PSEUDONYM_SECRET", "test-secret")
    monkeypatch.delenv("STUDIUM_REVIEW_TOKEN", raising=False)
    return {"store": store, "root": tmp_path, "client": TestClient(scene_synth_app.app)}


def _configure_token(monkeypatch) -> str:
    token = secrets.token_urlsafe(32)
    monkeypatch.setenv("STUDIUM_REVIEW_TOKEN", token)
    return token


def _submit(client: TestClient) -> str:
    r = client.post(
        "/learner-items",
        json={
            "course_id": "atomistique-l1",
            "target_bundle_ref": "atomistique-l1/lesson.json",
            "scene": _quiz_scene(),
            "author_handle": _LEARNER_HANDLE,
            "created_at": "2026-11-10T08:00:00Z",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["item_id"]


def _decide(client: TestClient, item_id: str, *, headers=None, decision="approve", reviewer=_TEACHER):
    return client.post(
        f"/learner-items/{item_id}/decide",
        json={"decision": decision, "reviewer": reviewer, "reviewed_at": _TS},
        headers=headers or {},
    )


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _nothing_written(env, item_id: str) -> None:
    assert env["store"].get_item(item_id).review_state == "submitted"
    bundles = env["root"] / "bundles"
    assert not bundles.exists() or not any(bundles.rglob("*.zip"))
    assert not decision_log_path(env["store"]).exists()


def _zip_path(response) -> Path:
    return Path(url2pathname(urlparse(response.json()["published_bundle_ref"]).path))


# --------------------------------------------------------------------------- #
# Authentication, fail closed.
# --------------------------------------------------------------------------- #


def test_no_token_configured_refuses_every_decision(env):
    item_id = _submit(env["client"])
    for decision in ("approve", "reject", "request_revision"):
        r = _decide(env["client"], item_id, decision=decision, headers=_bearer("x" * 40))
        assert r.status_code == 503, r.text
        assert "STUDIUM_REVIEW_TOKEN" in r.json()["detail"]
        assert "\n" not in r.json()["detail"]
    _nothing_written(env, item_id)


def test_a_token_shorter_than_32_characters_counts_as_not_configured(env, monkeypatch):
    short = "s" * 31
    monkeypatch.setenv("STUDIUM_REVIEW_TOKEN", short)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers=_bearer(short))
    assert r.status_code == 503
    _nothing_written(env, item_id)


@pytest.mark.parametrize("decision", ["approve", "reject", "request_revision"])
def test_missing_token_is_401_and_writes_nothing(env, monkeypatch, decision):
    _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, decision=decision)
    assert r.status_code == 401
    _nothing_written(env, item_id)


@pytest.mark.parametrize("header", [
    "Bearer wrong-token-of-sufficient-length-0123456789",
    "Bearer ",
    "Basic Zm9vOmJhcg==",
])
def test_wrong_token_is_401_and_writes_nothing(env, monkeypatch, header):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers={"Authorization": header})
    assert r.status_code == 401
    # the right token under another scheme is still refused
    r = _decide(env["client"], item_id, headers={"Authorization": f"Token {token}"})
    assert r.status_code == 401
    _nothing_written(env, item_id)


def test_unknown_item_is_not_probed_without_the_token(env, monkeypatch):
    _configure_token(monkeypatch)
    assert _decide(env["client"], "no-such-item").status_code == 401


# --------------------------------------------------------------------------- #
# No browser origin, no CORS grant on the decision route.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("origin", [_LEARNER_ORIGIN, _DASHBOARD_ORIGIN])
def test_preflight_to_the_decision_route_grants_no_origin(env, monkeypatch, origin):
    _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = env["client"].options(
        f"/learner-items/{item_id}/decide",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert "access-control-allow-origin" not in r.headers
    assert r.status_code >= 400


def test_the_audit_reproduction_is_refused(env, monkeypatch):
    """Learner origin, no token, the learner's own handle as reviewer: refused, no CORS grant."""
    _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers={"Origin": _LEARNER_ORIGIN}, reviewer=_LEARNER_HANDLE)
    assert r.status_code in (401, 403)
    assert "access-control-allow-origin" not in r.headers
    _nothing_written(env, item_id)


def test_a_browser_origin_is_refused_even_with_the_right_token(env, monkeypatch):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers={**_bearer(token), "Origin": _LEARNER_ORIGIN})
    assert r.status_code == 403
    assert "access-control-allow-origin" not in r.headers
    _nothing_written(env, item_id)


def test_the_learner_ui_keeps_its_cors_grant_on_learner_routes(env):
    r = env["client"].options(
        "/learner-items",
        headers={"Origin": _LEARNER_ORIGIN, "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") == _LEARNER_ORIGIN


# --------------------------------------------------------------------------- #
# The record: approval.json bound to the lesson.json member, drafted_by learner.
# --------------------------------------------------------------------------- #


def test_right_token_publishes_with_an_approval_record_bound_to_lesson_json(env, monkeypatch):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers=_bearer(token))
    assert r.status_code == 200, r.text
    assert r.json()["review_state"] == "published"
    assert r.json()["reviewed_by"] == _TEACHER

    path = _zip_path(r)
    assert path.name == f"community-{item_id}.zip"
    with zipfile.ZipFile(path) as zf:
        assert {"lesson.json", "prov.json", "approval.json"} <= set(zf.namelist())
        lesson_bytes = zf.read("lesson.json")
        approval = json.loads(zf.read("approval.json"))
    assert approval == {
        "schema": "studium-approval/1",
        "bundle_sha256": hashlib.sha256(lesson_bytes).hexdigest(),
        "reviewer": _TEACHER,
        "reviewed_at": _TS,
        "tool": approval["tool"],
        "decision_route": "learner-contribution",
    }
    assert isinstance(approval["tool"], str) and approval["tool"]

    lesson = json.loads(lesson_bytes)
    assert lesson["metadata"]["authoring"]["drafted_by"] == "learner"
    assert lesson["metadata"]["authoring"]["author_is_learner"] is True
    assert lesson["validated_by"] == _TEACHER


def test_reject_and_request_revision_with_the_token_record_the_decision(env, monkeypatch):
    token = _configure_token(monkeypatch)
    first, second = _submit(env["client"]), _submit(env["client"])
    assert _decide(env["client"], first, decision="reject", headers=_bearer(token)).json()["review_state"] == "rejected"
    assert _decide(env["client"], second, decision="request_revision",
                   headers=_bearer(token)).json()["review_state"] == "revision_requested"
    lines = [json.loads(line) for line in decision_log_path(env["store"]).read_text().splitlines()]
    assert [(line["item_id"], line["decision"], line["reviewer"]) for line in lines] == [
        (first, "reject", _TEACHER), (second, "request_revision", _TEACHER),
    ]
    assert all("lesson_sha256" not in line for line in lines)


def test_the_decision_log_holds_who_when_what_and_the_published_hash(env, monkeypatch):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers=_bearer(token))
    with zipfile.ZipFile(_zip_path(r)) as zf:
        approval = json.loads(zf.read("approval.json"))
    [line] = [json.loads(x) for x in decision_log_path(env["store"]).read_text().splitlines()]
    assert line["item_id"] == item_id
    assert line["decision"] == "approve"
    assert line["review_state"] == "published"
    assert line["reviewer"] == _TEACHER
    assert line["reviewed_at"] == _TS
    assert line["recorded_at"].endswith("Z")
    assert line["lesson_sha256"] == approval["bundle_sha256"]
    assert line["bundle_zip_sha256"] == hashlib.sha256(_zip_path(r).read_bytes()).hexdigest()


# --------------------------------------------------------------------------- #
# The reviewer name.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("decision", ["approve", "reject", "request_revision"])
def test_the_learner_cannot_review_their_own_item(env, monkeypatch, decision):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    for reviewer in (_LEARNER_HANDLE, f"  {_LEARNER_HANDLE} "):
        r = _decide(env["client"], item_id, decision=decision, headers=_bearer(token), reviewer=reviewer)
        assert r.status_code == 400, r.text
        assert "author" in r.json()["detail"]
    pseudonym = env["store"].get_item(item_id).author_pseudonym
    r = _decide(env["client"], item_id, decision=decision, headers=_bearer(token), reviewer=pseudonym)
    assert r.status_code == 400
    _nothing_written(env, item_id)


@pytest.mark.parametrize("reviewer", ["", "   ", "x" * 201])
@pytest.mark.parametrize("decision", ["approve", "reject", "request_revision"])
def test_an_empty_or_overlong_reviewer_is_refused(env, monkeypatch, reviewer, decision):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, decision=decision, headers=_bearer(token), reviewer=reviewer)
    assert r.status_code == 400
    _nothing_written(env, item_id)


def test_a_200_character_reviewer_is_accepted(env, monkeypatch):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    assert _decide(env["client"], item_id, headers=_bearer(token), reviewer="r" * 200).status_code == 200


def test_decide_item_refuses_the_author_pseudonym_as_reviewer(env):
    item_id = _submit(env["client"])
    pseudonym = env["store"].get_item(item_id).author_pseudonym
    with pytest.raises(ValueError, match="author"):
        decide_item(env["store"], item_id, decision="approve", reviewer=pseudonym, reviewed_at=_TS,
                    bundles_root=env["root"] / "bundles", course_concepts=[{"id": "c-orbitales-formes"}])
    _nothing_written(env, item_id)


# --------------------------------------------------------------------------- #
# The token never leaks.
# --------------------------------------------------------------------------- #


def test_the_token_appears_in_no_response_log_or_written_file(env, monkeypatch, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    other = _submit(env["client"])
    responses = [
        _decide(env["client"], item_id, headers={"Authorization": f"Bearer {token}x"}),
        _decide(env["client"], item_id, headers={**_bearer(token), "Origin": _LEARNER_ORIGIN}),
        _decide(env["client"], item_id, headers=_bearer(token), reviewer=_LEARNER_HANDLE),
        _decide(env["client"], item_id, headers=_bearer(token)),
        _decide(env["client"], other, decision="reject", headers=_bearer(token)),
    ]
    for r in responses:
        assert token not in r.text
        assert all(token not in value for value in r.headers.values())
    captured = capsys.readouterr()
    assert token not in caplog.text
    assert token not in captured.out and token not in captured.err
    for path in env["root"].rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            assert token.encode() not in data, path
            if path.suffix == ".zip":
                with zipfile.ZipFile(path) as zf:
                    for name in zf.namelist():
                        assert token.encode() not in zf.read(name), (path, name)


@pytest.mark.parametrize("reviewer", ["urn:studium:teacher:atomistique-l1", "URN:x", "  urn:studium:teacher:x"])
def test_approve_refuses_an_identifier_as_reviewer(env, monkeypatch, reviewer):
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, headers=_bearer(token), reviewer=reviewer)
    assert r.status_code == 400
    assert "names a person" in r.json()["detail"]
    assert "\n" not in r.json()["detail"]
    _nothing_written(env, item_id)


@pytest.mark.parametrize("decision", ["reject", "request_revision"])
def test_reject_and_revision_still_accept_the_course_iri(env, monkeypatch, decision):
    """Those decisions publish nothing to learners, so the dashboard may record the course IRI."""
    token = _configure_token(monkeypatch)
    item_id = _submit(env["client"])
    r = _decide(env["client"], item_id, decision=decision, headers=_bearer(token),
                reviewer="urn:studium:teacher:atomistique-l1")
    assert r.status_code == 200, r.text
    [line] = [json.loads(x) for x in decision_log_path(env["store"]).read_text().splitlines()]
    assert line["reviewer"] == "urn:studium:teacher:atomistique-l1"
