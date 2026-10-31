"""A3 — emit/discover PATH reconciliation.

Wave-1-B left a path mismatch: ``decide_item`` writes a flat
``community-<item>.zip`` into the ``bundles_root`` it is handed, while the TS
``discoverCommunityBundles(courseRoot)`` only scans ``<courseRoot>/community``.
A3 picks ONE convention: ``decide_item`` is handed the COURSE root's
``community/`` subdir (``community_emit_dir(courseRoot)``), so an emitted bundle
lands exactly where discovery looks — WITHOUT mutating the canonical course.

These tests pin the convention on the Python side:

  - ``COMMUNITY_DIR == "community"`` (mirrors the TS ``COMMUNITY_DIR`` constant);
  - ``community_emit_dir(courseRoot)`` == ``<courseRoot>/community``;
  - an approved bundle emitted into ``community_emit_dir(courseRoot)`` is a sibling
    of (never inside / never overwriting) the canonical ``lesson.json``;
  - the scene_synth_app emit dir of a course IS
    ``<BUNDLES_ROOT>/<course_id>/community``, or
    ``<COMMUNITY_BUNDLES_ROOT>/<course_id>/community`` when that is set, so the live
    HTTP path and TS discovery rooted at ``<root>/<course_id>`` agree. Since V15
    (2026-10-30) ``COMMUNITY_BUNDLES_ROOT`` names the root of ALL courses' bundles,
    not the root of one course.
"""
from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from learner_items_store import LAItemEnvelope, LearnerItemsStore  # noqa: E402
from learner_review import (  # noqa: E402
    COMMUNITY_DIR,
    community_emit_dir,
    decide_item,
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
        "feedback_correct": "Oui.",
        "feedback_incorrect": "Rappel.",
        "hints": ["n−ℓ−1"],
    }


def _seeded_store(tmp_path: Path) -> LearnerItemsStore:
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(
        LAItemEnvelope.model_validate(
            {
                "item_id": "item-1",
                "course_id": "atomistique-l1",
                "target_bundle_ref": "atomistique-l1/lesson.json",
                "schema_version": "1.4",
                "scene": _quiz_scene(),
                "author_pseudonym": _PSEUDONYM,
                "created_at": "2026-06-26T10:00:00Z",
                "review_state": "submitted",
                "validation": {
                    "ok": True,
                    "validator_version": "validate_scene/1.0",
                    "errors": [],
                },
            }
        )
    )
    return store


def _path_from_uri(uri: str) -> Path:
    return Path(url2pathname(urlparse(uri).path))


def test_community_dir_constant_matches_ts_convention():
    # The TS side (community-bundles.ts) exports COMMUNITY_DIR = "community"; the
    # Python emit side must agree on the literal so both ends scan/write the same dir.
    assert COMMUNITY_DIR == "community"


def test_community_emit_dir_is_course_root_subdir(tmp_path):
    course_root = tmp_path / "atomistique-l1"
    course_root.mkdir()
    emit = community_emit_dir(course_root)
    assert emit == course_root / COMMUNITY_DIR
    # str input is accepted too (the app may pass an env string).
    assert community_emit_dir(str(course_root)) == course_root / COMMUNITY_DIR


def test_emitted_bundle_lands_where_ts_discovery_scans(tmp_path):
    """The bundle decide_item emits into community_emit_dir(courseRoot) is the file
    discoverCommunityBundles(courseRoot) returns: <courseRoot>/community/community-<id>.zip."""
    course_root = tmp_path / "atomistique-l1"
    course_root.mkdir()
    # Canonical course lives at the course root and stays IMMUTABLE.
    canonical = course_root / "lesson.json"
    canonical.write_text(json.dumps({"i am": "canonical"}), encoding="utf-8")
    canonical_bytes = canonical.read_bytes()

    store = _seeded_store(tmp_path)
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=community_emit_dir(course_root),
        course_concepts=_COURSE_CONCEPTS,
    )
    assert env.review_state == "published"
    emitted = _path_from_uri(env.published_bundle_ref)
    # The emitted bundle is the exact path the TS discovery contract returns.
    expected = course_root / COMMUNITY_DIR / "community-item-1.zip"
    assert emitted == expected
    assert emitted.exists()
    # Canonical course is a SIBLING, never touched, never overwritten.
    assert canonical.read_bytes() == canonical_bytes
    # The community subdir is a child of the course root (additive), not the root itself.
    assert emitted.parent == course_root / COMMUNITY_DIR
    assert emitted.parent.parent == course_root


def test_temp_and_dotfile_guard_survives_in_community_subdir(tmp_path):
    """The hidden-temp emit + scrub guard still applies when emitting into the
    community/ subdir: a clean approve leaves the final .zip and NO leftover temp."""
    course_root = tmp_path / "atomistique-l1"
    course_root.mkdir()
    store = _seeded_store(tmp_path)
    env = decide_item(
        store,
        "item-1",
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_TS,
        bundles_root=community_emit_dir(course_root),
        course_concepts=_COURSE_CONCEPTS,
    )
    comm = course_root / COMMUNITY_DIR
    assert (comm / "community-item-1.zip").exists()
    # no hidden temp left behind
    assert not (comm / ".community-item-1.tmp.zip").exists()
    # pseudonym is scrubbed from the emitted bundle (privacy guard preserved).
    with zipfile.ZipFile(comm / "community-item-1.zip") as zf:
        body = zf.read("lesson.json").decode("utf-8") + zf.read("prov.json").decode("utf-8")
    assert _PSEUDONYM not in body


def test_app_emit_dir_is_the_course_community_subdir_of_bundles_root(tmp_path, monkeypatch):
    """The live HTTP path (scene_synth_app) emits a course's approved bundles into
    <BUNDLES_ROOT>/<course_id>/community, exactly where a SessionHost rooted at
    <BUNDLES_ROOT>/<course_id> discovers them."""
    import scene_synth_app

    monkeypatch.setenv("BUNDLES_ROOT", str(tmp_path / "bundles"))
    monkeypatch.delenv("COMMUNITY_BUNDLES_ROOT", raising=False)
    assert scene_synth_app._course_emit_dir("atomistique-l1") == (
        tmp_path / "bundles" / "atomistique-l1" / COMMUNITY_DIR
    )


def test_community_bundles_root_is_the_root_of_all_courses(tmp_path, monkeypatch):
    """V15: COMMUNITY_BUNDLES_ROOT replaces BUNDLES_ROOT for emission only, with the
    same <course_id>/community join; it no longer names one course's root."""
    import scene_synth_app

    monkeypatch.setenv("BUNDLES_ROOT", str(tmp_path / "bundles"))
    monkeypatch.setenv("COMMUNITY_BUNDLES_ROOT", str(tmp_path / "courses"))
    assert scene_synth_app._course_emit_dir("atomistique-l1") == (
        tmp_path / "courses" / "atomistique-l1" / COMMUNITY_DIR
    )
