"""P3 — peer-review loop tests (plan §"P3").

A peer (a DIFFERENT learner) tests a learner-authored item and rates it; ratings
aggregate into the ledger envelope's ``peer_signals`` (n_tests, n_ratings,
mean_rating, helpful_votes). The aggregate is a teacher-facing read that is
K-SUPPRESSED below a min-raters floor (default 3), mirroring tools/class_report.py.

PRIVACY (must hold + be tested):
- NO per-peer identity is ever persisted — only aggregate scalars on the envelope.
- NO free text in a peer review — passed/rating/helpful only.
- Peer ratings are ledger-only; they are NEVER routed to telemetry.

LLM-free, deterministic. ``record_peer_review`` updates the aggregate via an
append-only transition; an item may move ``submitted -> peer_review`` when peer
testing opens, and ``decide_item`` must still approve FROM ``peer_review``.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from learner_items_store import (  # noqa: E402
    LAItemEnvelope,
    LearnerItemsStore,
)
from learner_review import (  # noqa: E402
    decide_item,
    peer_signals_view,
    record_peer_review,
)


_PSEUDONYM = "hmac-deadbeefcafe"
_TEACHER = "https://uca.fr/teacher/42"
_TS = "2026-06-26T11:00:00Z"

_COURSE_CONCEPTS = [
    {
        "id": "c-orbitales-formes",
        "title": "Formes des orbitales",
        "description": "Nombre de nœuds radiaux.",
        "bloom_level_target": "understand",
    }
]


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
        "feedback_correct": "Oui : n−ℓ−1 = 2.",
        "feedback_incorrect": "Rappel : nœuds radiaux = n−ℓ−1.",
        "hints": ["n−ℓ−1"],
    }


def _envelope(item_id: str = "item-1", state: str = "submitted") -> dict:
    return {
        "item_id": item_id,
        "course_id": "atomistique-l1",
        "target_bundle_ref": "atomistique-l1.json",
        "schema_version": "1.4",
        "scene": _quiz_scene(),
        "author_pseudonym": _PSEUDONYM,
        "created_at": "2026-06-26T10:00:00Z",
        "review_state": state,
        "validation": {
            "ok": True,
            "validator_version": "validate_scene/1.0",
            "errors": [],
        },
    }


def _seeded_store(tmp_path: Path, state: str = "submitted") -> LearnerItemsStore:
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(LAItemEnvelope.model_validate(_envelope(state=state)))
    return store


def _path_from_uri(uri: str) -> Path:
    return Path(url2pathname(urlparse(uri).path))


# --------------------------------------------------------------------------- #
# record_peer_review updates the aggregate (append-only).
# --------------------------------------------------------------------------- #


def test_record_updates_aggregate(tmp_path):
    store = _seeded_store(tmp_path)
    env = record_peer_review(store, "item-1", passed=True, rating=4, helpful=True)
    assert env.peer_signals is not None
    assert env.peer_signals.n_tests == 1
    assert env.peer_signals.n_ratings == 1
    assert env.peer_signals.mean_rating == 4.0
    assert env.peer_signals.helpful_votes == 1

    env2 = record_peer_review(store, "item-1", passed=False, rating=2, helpful=False)
    assert env2.peer_signals.n_tests == 2
    assert env2.peer_signals.n_ratings == 2
    assert env2.peer_signals.mean_rating == 3.0  # (4 + 2) / 2
    assert env2.peer_signals.helpful_votes == 1


def test_record_rejects_out_of_range_rating(tmp_path):
    store = _seeded_store(tmp_path)
    with pytest.raises(ValueError):
        record_peer_review(store, "item-1", passed=True, rating=6, helpful=True)
    with pytest.raises(ValueError):
        record_peer_review(store, "item-1", passed=True, rating=0, helpful=True)
    # nothing recorded — still no peer_signals.
    assert store.get_item("item-1").peer_signals is None


# --------------------------------------------------------------------------- #
# submitted -> peer_review when peer testing opens.
# --------------------------------------------------------------------------- #


def test_first_peer_review_opens_peer_review_state(tmp_path):
    store = _seeded_store(tmp_path, state="submitted")
    assert store.get_item("item-1").review_state == "submitted"
    env = record_peer_review(store, "item-1", passed=True, rating=5, helpful=True)
    assert env.review_state == "peer_review"


def test_subsequent_peer_reviews_stay_in_peer_review(tmp_path):
    store = _seeded_store(tmp_path, state="submitted")
    record_peer_review(store, "item-1", passed=True, rating=5, helpful=True)
    env = record_peer_review(store, "item-1", passed=True, rating=3, helpful=False)
    assert env.review_state == "peer_review"
    assert env.peer_signals.n_ratings == 2


# --------------------------------------------------------------------------- #
# k-suppression below the min-raters floor (default 3).
# --------------------------------------------------------------------------- #


def test_peer_signals_view_suppressed_below_floor(tmp_path):
    store = _seeded_store(tmp_path)
    record_peer_review(store, "item-1", passed=True, rating=4, helpful=True)
    record_peer_review(store, "item-1", passed=True, rating=5, helpful=True)
    view = peer_signals_view(store, "item-1")  # default floor = 3
    assert view["status"] == "suppressed"
    assert view["min_raters"] == 3
    assert view["n_ratings"] == 2
    # no aggregate scalars leak in a suppressed view.
    assert "mean_rating" not in view


def test_peer_signals_view_ok_at_floor(tmp_path):
    store = _seeded_store(tmp_path)
    record_peer_review(store, "item-1", passed=True, rating=4, helpful=True)
    record_peer_review(store, "item-1", passed=False, rating=2, helpful=False)
    record_peer_review(store, "item-1", passed=True, rating=3, helpful=True)
    view = peer_signals_view(store, "item-1")
    assert view["status"] == "ok"
    assert view["n_tests"] == 3
    assert view["n_ratings"] == 3
    assert view["mean_rating"] == 3.0  # (4 + 2 + 3) / 3
    assert view["helpful_votes"] == 2


def test_peer_signals_view_none_when_no_reviews(tmp_path):
    store = _seeded_store(tmp_path)
    view = peer_signals_view(store, "item-1")
    assert view["status"] == "suppressed"
    assert view["n_ratings"] == 0


# --------------------------------------------------------------------------- #
# NO per-peer identity is persisted — only aggregate scalars.
# --------------------------------------------------------------------------- #


def test_no_per_peer_identity_persisted(tmp_path):
    store = _seeded_store(tmp_path)
    record_peer_review(
        store, "item-1", passed=True, rating=4, helpful=True, peer_pseudonym="hmac-peer-xyz"
    )
    record_peer_review(store, "item-1", passed=False, rating=2, helpful=False)
    # The aggregate envelope keeps only scalars — no per-peer record anywhere.
    env = store.get_item("item-1")
    dumped = env.model_dump()
    assert set(dumped["peer_signals"].keys()) == {
        "n_tests",
        "n_ratings",
        "mean_rating",
        "helpful_votes",
    }
    # the raw ledger file never contains any peer identity.
    raw = (tmp_path / "learner_items.jsonl").read_text(encoding="utf-8")
    assert "hmac-peer-xyz" not in raw
    # double-check no stray list of per-peer entries on the envelope.
    for line in raw.splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        ps = rec.get("peer_signals")
        if ps is not None:
            assert set(ps.keys()) == {"n_tests", "n_ratings", "mean_rating", "helpful_votes"}


# --------------------------------------------------------------------------- #
# decide_item still approves FROM peer_review.
# --------------------------------------------------------------------------- #


def test_decide_item_approves_from_peer_review(tmp_path):
    store = _seeded_store(tmp_path)
    record_peer_review(store, "item-1", passed=True, rating=5, helpful=True)
    assert store.get_item("item-1").review_state == "peer_review"
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=tmp_path / "bundles",
        course_concepts=_COURSE_CONCEPTS,
    )
    assert env.review_state == "published"
    assert env.published_bundle_ref is not None
    assert _path_from_uri(env.published_bundle_ref).exists()
    # prior_author preserved (mirrors approve from submitted).
    assert env.prior_author == _PSEUDONYM
    # peer_signals survive into the published snapshot (ledger-only).
    assert env.peer_signals is not None
    assert env.peer_signals.n_ratings == 1


def test_peer_review_unknown_item_raises(tmp_path):
    store = _seeded_store(tmp_path)
    with pytest.raises(ValueError):
        record_peer_review(store, "nope", passed=True, rating=4, helpful=True)


def test_peer_review_on_terminal_item_raises(tmp_path):
    """Once an item is rejected/published, it can no longer be peer-tested."""
    store = _seeded_store(tmp_path)
    decide_item(
        store,
        "item-1",
        decision="reject",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=tmp_path / "bundles",
        course_concepts=_COURSE_CONCEPTS,
    )
    assert store.get_item("item-1").review_state == "rejected"
    with pytest.raises(ValueError):
        record_peer_review(store, "item-1", passed=True, rating=4, helpful=True)


# --------------------------------------------------------------------------- #
# Endpoint wiring (FastAPI TestClient) — scalars-only body, k-suppressed read,
# and NO telemetry routing.
# --------------------------------------------------------------------------- #


@pytest.fixture
def client(tmp_path, monkeypatch):
    import scene_synth_app
    from fastapi.testclient import TestClient

    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(LAItemEnvelope.model_validate(_envelope()))
    monkeypatch.setattr(scene_synth_app, "_learner_store", store, raising=False)
    monkeypatch.setattr(
        scene_synth_app, "_learner_bundles_root", tmp_path / "bundles", raising=False
    )
    return TestClient(scene_synth_app.app)


def test_peer_review_endpoint_opens_peer_review(client):
    r = client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 4, "helpful": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["review_state"] == "peer_review"
    # the client-safe view never carries server-only governance/peer fields.
    assert "peer_signals" not in r.json()
    assert "prior_author" not in r.json()
    # author_pseudonym is never in a client view.
    assert "author_pseudonym" not in r.json()


def test_peer_review_endpoint_rejects_free_text(client):
    # extra='forbid' on the request body — no free text / peer identity allowed.
    r = client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 4, "helpful": True, "comment": "nice"},
    )
    assert r.status_code == 422


def test_peer_review_endpoint_rejects_bad_rating(client):
    r = client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 9, "helpful": True},
    )
    assert r.status_code == 422


def test_peer_signals_endpoint_suppressed_then_ok(client):
    # below floor -> suppressed.
    client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 4, "helpful": True},
    )
    client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 5, "helpful": False},
    )
    r = client.get("/learner-items/item-1/peer-signals")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "suppressed"
    assert body["mean_rating"] is None  # scalars withheld below floor.

    # third rating reaches the floor -> ok.
    client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": False, "rating": 3, "helpful": True},
    )
    r2 = client.get("/learner-items/item-1/peer-signals")
    body2 = r2.json()
    assert body2["status"] == "ok"
    assert body2["n_ratings"] == 3
    assert body2["mean_rating"] == 4.0  # (4 + 5 + 3) / 3


def test_peer_signals_endpoint_unknown_item_404(client):
    r = client.get("/learner-items/nope/peer-signals")
    assert r.status_code == 404


def test_peer_review_not_routed_to_telemetry(client, monkeypatch):
    """Peer ratings live in the ledger, never in telemetry. Assert the peer-review
    path touches NO telemetry sink (there is none in scene-synth; this guards
    against one being wired in by accident)."""
    import scene_synth_app

    # If any telemetry-emitting attribute exists, it must not be called.
    called = {"emit": 0}
    for name in dir(scene_synth_app):
        if "telemetry" in name.lower() or "emit_event" in name.lower():
            monkeypatch.setattr(
                scene_synth_app, name, lambda *a, **k: called.__setitem__("emit", called["emit"] + 1)
            )
    client.post(
        "/learner-items/item-1/peer-review",
        json={"passed": True, "rating": 4, "helpful": True},
    )
    assert called["emit"] == 0
