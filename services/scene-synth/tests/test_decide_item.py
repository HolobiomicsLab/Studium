"""P2 — tests for ``decide_item()``, the SOLE rule-003 publish chokepoint.

LLM-free, deterministic. Mirrors the INVARIANTS of ``approve_course`` (no .lwg
coupling here): approve needs a non-empty reviewer AND a passed-in
``reviewed_at`` — both raised as ``ValueError`` BEFORE any mutation, so a missing
identity/timestamp can never produce a published item. Re-approve/publish is a
no-op. ``prior_author`` is preserved (the learner pseudonym survives only in the
ledger). reject / request_revision leave NO bundle.

PRIVACY: on approve, the emitted community bundle must contain the
``author_pseudonym`` in NEITHER ``lesson.json`` NOR ``prov.json``.
"""
from __future__ import annotations

import os
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from learner_items_store import (  # noqa: E402
    LAItemEnvelope,
    LearnerItemsStore,
)
from learner_review import decide_item  # noqa: E402


_PSEUDONYM = "hmac-deadbeefcafe"
_TEACHER = "https://uca.fr/teacher/42"
_TS = "2026-06-26T11:00:00Z"

# A single course concept the synthesized plan references.
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
        "feedback_correct": "Oui : n−ℓ−1 = 3−0−1 = 2.",
        "feedback_incorrect": "Rappel : nœuds radiaux = n−ℓ−1.",
        "hints": ["n−ℓ−1"],
    }


def _envelope(scene: dict, item_id: str = "item-1", state: str = "submitted") -> dict:
    return {
        "item_id": item_id,
        "course_id": "atomistique-l1",
        "target_bundle_ref": "atomistique-l1.json",
        "schema_version": "1.4",
        "scene": scene,
        "author_pseudonym": _PSEUDONYM,
        "created_at": "2026-06-26T10:00:00Z",
        "review_state": state,
        "validation": {
            "ok": True,
            "validator_version": "validate_scene/1.0",
            "errors": [],
        },
    }


def _seeded_store(tmp_path: Path, **env_kw) -> LearnerItemsStore:
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(LAItemEnvelope.model_validate(_envelope(_quiz_scene(), **env_kw)))
    return store


def _path_from_uri(uri: str) -> Path:
    return Path(url2pathname(urlparse(uri).path))


# --------------------------------------------------------------------------- #
# Approve guards — ValueError BEFORE any mutation.
# --------------------------------------------------------------------------- #


def test_approve_empty_reviewer_raises_before_write(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    with pytest.raises(ValueError):
        decide_item(
            store,
            "item-1",
            decision="approve",
            reviewer="",
            reviewed_at=_TS,
            bundles_root=bundles_root,
            course_concepts=_COURSE_CONCEPTS,
        )
    # untouched: still submitted, no bundle dir created.
    assert store.get_item("item-1").review_state == "submitted"
    assert not bundles_root.exists()


def test_approve_missing_timestamp_raises_before_write(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    with pytest.raises(ValueError):
        decide_item(
            store,
            "item-1",
            decision="approve",
            reviewer=_TEACHER,
            reviewed_at="",
            bundles_root=bundles_root,
            course_concepts=_COURSE_CONCEPTS,
        )
    assert store.get_item("item-1").review_state == "submitted"
    assert not bundles_root.exists()


def test_unknown_decision_raises(tmp_path):
    store = _seeded_store(tmp_path)
    with pytest.raises(ValueError):
        decide_item(
            store,
            "item-1",
            decision="frobnicate",
            reviewer=_TEACHER,
            reviewed_at=_TS,
            bundles_root=tmp_path / "bundles",
            course_concepts=_COURSE_CONCEPTS,
        )


# --------------------------------------------------------------------------- #
# Reject / request_revision leave NO bundle.
# --------------------------------------------------------------------------- #


def test_reject_leaves_no_bundle(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    env = decide_item(
        store,
        "item-1",
        decision="reject",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
        note_code="factual_error",
    )
    assert env.review_state == "rejected"
    assert env.published_bundle_ref is None
    # no community bundle emitted.
    assert not bundles_root.exists() or not any(bundles_root.rglob("*.zip"))


def test_request_revision_leaves_no_bundle(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    env = decide_item(
        store,
        "item-1",
        decision="request_revision",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
        note_code="ambiguous_distractor",
    )
    assert env.review_state == "revision_requested"
    assert env.published_bundle_ref is None
    assert not bundles_root.exists() or not any(bundles_root.rglob("*.zip"))


# --------------------------------------------------------------------------- #
# Approve → published, prior_author preserved, bundle emitted.
# --------------------------------------------------------------------------- #


def test_approve_publishes_and_preserves_prior_author(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
    )
    assert env.review_state == "published"
    assert env.reviewed_by == _TEACHER
    assert env.reviewed_at == _TS
    # prior_author carries the learner pseudonym forward in the ledger ONLY.
    assert env.prior_author == _PSEUDONYM
    assert env.published_bundle_ref is not None
    bundle_path = _path_from_uri(env.published_bundle_ref)
    assert bundle_path.exists()
    assert bundle_path.suffix == ".zip"


def test_approve_scrubs_pseudonym_from_emitted_bundle(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
    )
    bundle_path = _path_from_uri(env.published_bundle_ref)
    with zipfile.ZipFile(bundle_path) as zf:
        lesson_json = zf.read("lesson.json").decode("utf-8")
        prov_json = zf.read("prov.json").decode("utf-8")
    assert _PSEUDONYM not in lesson_json
    assert _PSEUDONYM not in prov_json
    # validated_by must be the teacher IRI (rule-003 vouching), not the learner.
    assert _TEACHER in lesson_json


def test_approve_validated_by_is_teacher(tmp_path):
    store = _seeded_store(tmp_path)
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=tmp_path / "bundles",
        course_concepts=_COURSE_CONCEPTS,
    )
    import json

    bundle_path = _path_from_uri(env.published_bundle_ref)
    with zipfile.ZipFile(bundle_path) as zf:
        lesson = json.loads(zf.read("lesson.json"))
    assert lesson["validated_by"] == _TEACHER


def test_approve_marks_the_bundle_learner_authored_and_teacher_validated(tmp_path):
    """Every emitted community bundle says who wrote it, canonical metadata or not."""
    import json

    store = _seeded_store(tmp_path)
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=tmp_path / "bundles",
        course_concepts=_COURSE_CONCEPTS,
    )
    with zipfile.ZipFile(_path_from_uri(env.published_bundle_ref)) as zf:
        lesson = json.loads(zf.read("lesson.json"))
    assert lesson["metadata"]["authoring"] == {
        "mode": "teacher", "author_is_learner": True, "drafted_by": "learner",
    }


# --------------------------------------------------------------------------- #
# Idempotency — double-approve / publish is a no-op.
# --------------------------------------------------------------------------- #


def test_double_approve_is_noop(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    first = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
    )
    n_lines_after_first = len(
        [ln for ln in (tmp_path / "learner_items.jsonl").read_text().splitlines() if ln.strip()]
    )
    second = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at="2026-06-27T09:00:00Z",  # different ts — must NOT overwrite.
        bundles_root=bundles_root,
        course_concepts=_COURSE_CONCEPTS,
    )
    # already published → returned unchanged, no new ledger line written.
    assert second.review_state == "published"
    assert second.published_bundle_ref == first.published_bundle_ref
    assert second.reviewed_at == first.reviewed_at  # original timestamp preserved.
    n_lines_after_second = len(
        [ln for ln in (tmp_path / "learner_items.jsonl").read_text().splitlines() if ln.strip()]
    )
    assert n_lines_after_second == n_lines_after_first


def test_approve_resumes_from_stranded_approved(tmp_path):
    """If a prior approve stranded the item at 'approved' (the build/scrub failed
    after the transition, leaving a non-terminal state where approved->approved is
    illegal), a repeat approve RESUMES the emit instead of re-transitioning — the
    item is never permanently stuck."""
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    # Simulate the stranded state a crashed prior approve would leave behind.
    store.transition("item-1", "approved", reviewed_by=_TEACHER, reviewed_at=_TS,
                     prior_author=_PSEUDONYM)
    assert store.get_item("item-1").review_state == "approved"
    assert store.get_item("item-1").published_bundle_ref is None

    env = decide_item(
        store, "item-1", decision="approve", reviewer=_TEACHER,
        reviewed_at=_TS, bundles_root=bundles_root, course_concepts=_COURSE_CONCEPTS,
    )
    assert env.review_state == "published"
    assert env.published_bundle_ref is not None
    assert _path_from_uri(env.published_bundle_ref).exists()


def test_scrub_failure_leaves_no_artifact_in_discovery_root(tmp_path, monkeypatch):
    """A failed pseudonym scrub must leave NO bundle in the discovery root: the
    bundle is built in a hidden temp path and only moved in on a clean scrub."""
    import learner_review

    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"

    def _boom(*_a, **_k):
        raise AssertionError("simulated pseudonym leak")

    monkeypatch.setattr(learner_review, "_assert_pseudonym_scrubbed", _boom)
    with pytest.raises(AssertionError):
        decide_item(
            store, "item-1", decision="approve", reviewer=_TEACHER,
            reviewed_at=_TS, bundles_root=bundles_root, course_concepts=_COURSE_CONCEPTS,
        )
    # neither the final nor the temp bundle survives in the discovery root
    assert not (bundles_root / "community-item-1.zip").exists()
    assert not (bundles_root / ".community-item-1.tmp.zip").exists()
    # the item is resumably 'approved', not published
    assert store.get_item("item-1").review_state == "approved"


def test_reject_after_reject_is_noop(tmp_path):
    store = _seeded_store(tmp_path)
    bundles_root = tmp_path / "bundles"
    decide_item(
        store, "item-1", decision="reject", reviewer=_TEACHER,
        reviewed_at=_TS, bundles_root=bundles_root, course_concepts=_COURSE_CONCEPTS,
    )
    n1 = len([ln for ln in (tmp_path / "learner_items.jsonl").read_text().splitlines() if ln.strip()])
    again = decide_item(
        store, "item-1", decision="reject", reviewer=_TEACHER,
        reviewed_at=_TS, bundles_root=bundles_root, course_concepts=_COURSE_CONCEPTS,
    )
    n2 = len([ln for ln in (tmp_path / "learner_items.jsonl").read_text().splitlines() if ln.strip()])
    assert again.review_state == "rejected"
    assert n2 == n1  # terminal state → no-op.
