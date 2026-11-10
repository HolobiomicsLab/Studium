"""P2 — FastAPI endpoint tests for the learner-as-author surface.

LLM-free, deterministic (TestClient, no LLM, no network). Covers:
- POST /learner-items/validate — validate-only, no write.
- POST /learner-items — stages review_state='submitted' + computes an HMAC
  author_pseudonym (which NEVER appears in the response).
- GET /learner-items?course=&state= — list latest snapshots.
- POST /learner-items/{id}/decide — approve (publish + bundle), reject, and the
  guard paths (empty reviewer / timestamp → 4xx).
- CORS preflight for author-web:3000.
"""
from __future__ import annotations

import os
import secrets
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import scene_synth_app  # noqa: E402
from scene_synth_app import app  # noqa: E402
from learner_items_store import LearnerItemsStore  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402


_TEACHER = "https://uca.fr/teacher/42"
_TS = "2026-06-26T11:00:00Z"
_CREATED = "2026-06-26T10:00:00Z"


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point the app at a tmp ledger, read the canonical course from the default
    # BUNDLES_ROOT (the repo fixtures) but emit under tmp, and fix the HMAC secret
    # so pseudonyms are deterministic across the test.
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    monkeypatch.setattr(scene_synth_app, "_learner_store", store, raising=False)
    monkeypatch.delenv("BUNDLES_ROOT", raising=False)
    monkeypatch.setenv("COMMUNITY_BUNDLES_ROOT", str(tmp_path / "bundles"))
    monkeypatch.setenv("LEARNER_PSEUDONYM_SECRET", "test-secret")
    # Decisions need the teacher review token (generated per test, never a fixed value).
    token = secrets.token_urlsafe(32)
    monkeypatch.setenv("STUDIUM_REVIEW_TOKEN", token)
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


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
            {"id": "b", "text": "1", "correct": False},
            {"id": "c", "text": "2", "correct": True},
            {"id": "d", "text": "3", "correct": False},
        ],
        "feedback_correct": "Oui : n−ℓ−1 = 3−0−1 = 2.",
        "feedback_incorrect": "Rappel : nœuds radiaux = n−ℓ−1.",
        "hints": ["n−ℓ−1"],
    }


def _bad_quiz_scene() -> dict:
    """Two correct choices — passes Pydantic, fails the custom quiz check."""
    s = _quiz_scene()
    s["choices"][0]["correct"] = True  # now 2 correct.
    return s


def _submit_payload(scene: dict, author_handle: str = "alice") -> dict:
    return {
        "course_id": "atomistique-l1",
        "target_bundle_ref": "atomistique-l1.json",
        "scene": scene,
        "author_handle": author_handle,
        "created_at": _CREATED,
    }


# --------------------------------------------------------------------------- #
# /learner-items/validate — validate only, no write.
# --------------------------------------------------------------------------- #


def test_validate_ok(client):
    r = client.post(
        "/learner-items/validate",
        json={"scene": _quiz_scene(), "course_id": "atomistique-l1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["errors"] == []
    assert body["validator_version"]


def test_validate_rejects_two_correct(client):
    r = client.post(
        "/learner-items/validate",
        json={"scene": _bad_quiz_scene(), "course_id": "atomistique-l1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert any("correct" in e.lower() for e in body["errors"])


def test_validate_does_not_write(client, tmp_path):
    client.post(
        "/learner-items/validate",
        json={"scene": _quiz_scene(), "course_id": "atomistique-l1"},
    )
    listed = client.get("/learner-items", params={"course": "atomistique-l1"}).json()
    assert listed["items"] == []


# --------------------------------------------------------------------------- #
# /learner-items — submit (stages 'submitted', HMAC pseudonym hidden).
# --------------------------------------------------------------------------- #


def test_submit_stages_submitted(client):
    r = client.post("/learner-items", json=_submit_payload(_quiz_scene()))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["review_state"] == "submitted"
    assert body["item_id"]
    assert body["validation"]["ok"] is True


def test_submit_never_returns_pseudonym(client):
    r = client.post("/learner-items", json=_submit_payload(_quiz_scene()))
    body = r.json()
    assert "author_pseudonym" not in body
    # nor the raw author handle.
    assert "author_handle" not in body
    assert "alice" not in r.text


def test_submit_rejects_invalid_scene(client):
    r = client.post("/learner-items", json=_submit_payload(_bad_quiz_scene()))
    assert r.status_code == 422
    # nothing was staged.
    listed = client.get("/learner-items", params={"course": "atomistique-l1"}).json()
    assert listed["items"] == []


def test_submit_then_list_and_filter(client):
    client.post("/learner-items", json=_submit_payload(_quiz_scene()))
    all_items = client.get("/learner-items", params={"course": "atomistique-l1"}).json()
    assert len(all_items["items"]) == 1
    submitted = client.get(
        "/learner-items", params={"course": "atomistique-l1", "state": "submitted"}
    ).json()
    assert len(submitted["items"]) == 1
    published = client.get(
        "/learner-items", params={"course": "atomistique-l1", "state": "published"}
    ).json()
    assert published["items"] == []


# --------------------------------------------------------------------------- #
# /learner-items/{id}/decide — happy + guard paths.
# --------------------------------------------------------------------------- #


def test_decide_approve_publishes(client):
    item_id = client.post(
        "/learner-items", json=_submit_payload(_quiz_scene())
    ).json()["item_id"]
    r = client.post(
        f"/learner-items/{item_id}/decide",
        json={"decision": "approve", "reviewer": _TEACHER, "reviewed_at": _TS},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["review_state"] == "published"
    assert body["reviewed_by"] == _TEACHER
    assert body["published_bundle_ref"]
    assert "author_pseudonym" not in body


def test_decide_reject(client):
    item_id = client.post(
        "/learner-items", json=_submit_payload(_quiz_scene())
    ).json()["item_id"]
    r = client.post(
        f"/learner-items/{item_id}/decide",
        json={
            "decision": "reject",
            "reviewer": _TEACHER,
            "reviewed_at": _TS,
            "note_code": "factual_error",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["review_state"] == "rejected"
    assert r.json()["published_bundle_ref"] is None


def test_decide_approve_empty_reviewer_is_4xx(client):
    item_id = client.post(
        "/learner-items", json=_submit_payload(_quiz_scene())
    ).json()["item_id"]
    r = client.post(
        f"/learner-items/{item_id}/decide",
        json={"decision": "approve", "reviewer": "", "reviewed_at": _TS},
    )
    assert r.status_code == 400
    # item untouched.
    listed = client.get(
        "/learner-items", params={"course": "atomistique-l1", "state": "submitted"}
    ).json()
    assert len(listed["items"]) == 1


def test_decide_unknown_item_is_404(client):
    r = client.post(
        "/learner-items/nope/decide",
        json={"decision": "approve", "reviewer": _TEACHER, "reviewed_at": _TS},
    )
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# CORS for author-web:3000.
# --------------------------------------------------------------------------- #


def test_cors_preflight_allows_author_web(client):
    r = client.options(
        "/learner-items",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
