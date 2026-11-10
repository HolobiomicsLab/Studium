"""S1 — the learner-as-author endpoints serve any course found under BUNDLES_ROOT.

Until 2026-10-30 these endpoints were locked to the demo course ``atomistique-l1``
(audit V4) and emitted under a root whose name, ``COMMUNITY_BUNDLES_ROOT``, did not say
what it held (V15). The contract pinned here comes from the spec « lot apprenant
autonome », section « Contrat commun »:

- ``course_id`` must match ``[a-z0-9][a-z0-9._-]{0,63}``, else 400 — which also closes
  path traversal;
- the canonical bundle ``<BUNDLES_ROOT>/<course_id>/lesson.json`` must exist and parse
  as a LessonBundle, else 404; its concepts gate validate, submit and decide;
- an approved item is emitted at
  ``<BUNDLES_ROOT>/<course_id>/community/community-<item_id>.zip``; when
  ``COMMUNITY_BUNDLES_ROOT`` is set it replaces ``BUNDLES_ROOT`` for emission only;
- the emitted bundle inherits the canonical language, target and discipline, and says
  who wrote it: ``authoring = {mode: teacher, author_is_learner: true, drafted_by: learner}``.

LLM-free and deterministic: TestClient, tmp roots, nothing written in the repository.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_REPO = Path(__file__).resolve().parents[3]
# The canonical Python mirror of the bundle schema is not an installed package.
sys.path.insert(0, str(_REPO / "packages" / "lesson-bundle-schema" / "python"))

import scene_synth_app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from learner_items_store import LearnerItemsStore  # noqa: E402
from lesson_bundle_schema import LessonBundle as CanonicalLessonBundle  # noqa: E402
from scene_synth_schemas import LessonBundle  # noqa: E402

_ATOMISTIQUE = "atomistique-l1"
_ATOMISTIQUE_CANONICAL = _REPO / "fixtures" / _ATOMISTIQUE / "lesson.json"
_ATOMISTIQUE_CONCEPT = "c-orbitales-formes"
_COURSE = "socio-l2"
_COURSE_CONCEPT = "c-anomie"
_TEACHER = "https://uca.fr/teacher/42"
_CREATED = "2026-10-30T10:00:00Z"
_REVIEWED = "2026-10-30T11:00:00Z"


def _canonical_bundle() -> dict:
    """A minimal canonical bundle for a second course, its metadata unlike the demo's."""
    return {
        "schema_version": "1.4",
        "bundle_id": f"bundle-{_COURSE}",
        "source_plan_id": f"plan-{_COURSE}",
        "metadata": {
            "title": "Durkheim, Suicide: anomie",
            "target": "M1",
            "duration_minutes": 45,
            "language": "en",
            "discipline": "sociology",
        },
        "concepts": [
            {
                "id": _COURSE_CONCEPT,
                "title": "Anomie",
                "description": "The breakdown of the norms that regulate desire.",
                "bloom_level_target": "understand",
            }
        ],
        "scenes": [
            {
                "id": "s-intro",
                "type": "intro",
                "title": "Durkheim",
                "concept_refs": [_COURSE_CONCEPT],
                "markdown": "Why do suicide rates differ between societies?",
            }
        ],
        "rules": [],
        "validated_by": "https://uca.fr/teacher/7",
        "validated_at": "2026-10-30T09:00:00Z",
    }


def _quiz(concept_id: str) -> dict:
    """A schema-pure quiz scene that cites ``concept_id``."""
    return {
        "id": "s-la-001",
        "type": "quiz",
        "title": "A learner's question",
        "concept_refs": [concept_id],
        "estimated_seconds": 60,
        "question": "Which answer is right?",
        "choices": [
            {"id": "a", "text": "This one", "correct": True},
            {"id": "b", "text": "Not this one", "correct": False},
        ],
        "feedback_correct": "Yes.",
        "feedback_incorrect": "No.",
    }


def _write_canonical(course_dir: Path, bundle: dict) -> None:
    course_dir.mkdir(parents=True)
    (course_dir / "lesson.json").write_text(json.dumps(bundle), encoding="utf-8")


@pytest.fixture
def bundles_root(tmp_path: Path, monkeypatch) -> Path:
    """BUNDLES_ROOT holding two courses: a copy of atomistique-l1 and a minimal second one."""
    root = tmp_path / "bundles"
    _write_canonical(root / _COURSE, _canonical_bundle())
    (root / _ATOMISTIQUE).mkdir()
    shutil.copyfile(_ATOMISTIQUE_CANONICAL, root / _ATOMISTIQUE / "lesson.json")
    monkeypatch.setenv("BUNDLES_ROOT", str(root))
    monkeypatch.delenv("COMMUNITY_BUNDLES_ROOT", raising=False)
    return root


@pytest.fixture
def store(tmp_path: Path, monkeypatch) -> LearnerItemsStore:
    ledger = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    monkeypatch.setattr(scene_synth_app, "_learner_store", ledger)
    return ledger


@pytest.fixture
def client(bundles_root: Path, store: LearnerItemsStore, monkeypatch) -> TestClient:
    monkeypatch.setenv("LEARNER_PSEUDONYM_SECRET", "test-secret")
    # Decisions need the teacher review token (generated per test, never a fixed value).
    token = secrets.token_urlsafe(32)
    monkeypatch.setenv("STUDIUM_REVIEW_TOKEN", token)
    return TestClient(scene_synth_app.app, headers={"Authorization": f"Bearer {token}"})


def _validate(client: TestClient, course_id: str, scene: dict):
    return client.post("/learner-items/validate", json={"scene": scene, "course_id": course_id})


def _submit(client: TestClient, course_id: str, scene: dict):
    return client.post(
        "/learner-items",
        json={
            "course_id": course_id,
            "target_bundle_ref": f"{course_id}/lesson.json",
            "scene": scene,
            "author_handle": "alice",
            "created_at": _CREATED,
        },
    )


def _approve(client: TestClient, item_id: str):
    return client.post(
        f"/learner-items/{item_id}/decide",
        json={"decision": "approve", "reviewer": _TEACHER, "reviewed_at": _REVIEWED},
    )


def _emitted_path(decided) -> Path:
    return Path(url2pathname(urlparse(decided.json()["published_bundle_ref"]).path))


def _listed_ids(client: TestClient, course_id: str) -> list[str]:
    items = client.get("/learner-items", params={"course": course_id}).json()["items"]
    return [item["item_id"] for item in items]


_ON_VALIDATE_AND_SUBMIT = pytest.mark.parametrize(
    "post", [_validate, _submit], ids=["validate", "submit"]
)


# --------------------------------------------------------------------------- #
# Course loading: id shape (400), canonical bundle (404), concepts.
# --------------------------------------------------------------------------- #


def test_validate_accepts_a_second_course(client):
    r = _validate(client, _COURSE, _quiz(_COURSE_CONCEPT))
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True, r.json()["errors"]


def test_submit_stages_an_item_of_a_second_course(client):
    r = _submit(client, _COURSE, _quiz(_COURSE_CONCEPT))
    assert r.status_code == 201, r.text
    assert r.json()["course_id"] == _COURSE
    assert r.json()["review_state"] == "submitted"


@pytest.mark.parametrize(
    "course_id, foreign_concept",
    [(_COURSE, _ATOMISTIQUE_CONCEPT), (_ATOMISTIQUE, _COURSE_CONCEPT)],
)
def test_a_concept_of_another_course_is_rejected(client, course_id, foreign_concept):
    validated = _validate(client, course_id, _quiz(foreign_concept))
    assert validated.status_code == 200
    assert validated.json()["ok"] is False
    assert any(foreign_concept in error for error in validated.json()["errors"])
    assert _submit(client, course_id, _quiz(foreign_concept)).status_code == 422


def test_every_concept_of_the_canonical_bundle_is_citable(client):
    """The concepts come from the canonical bundle, not from a hardcoded demo list."""
    canonical = json.loads(_ATOMISTIQUE_CANONICAL.read_text(encoding="utf-8"))
    for concept in canonical["concepts"]:
        r = _validate(client, _ATOMISTIQUE, _quiz(concept["id"]))
        assert r.json()["ok"] is True, (concept["id"], r.json()["errors"])


@_ON_VALIDATE_AND_SUBMIT
@pytest.mark.parametrize("course_id", ["chimie-orga-l3", "a" * 64])
def test_an_unknown_course_is_404(client, post, course_id):
    r = post(client, course_id, _quiz(_COURSE_CONCEPT))
    assert r.status_code == 404
    assert course_id in r.json()["detail"]


@_ON_VALIDATE_AND_SUBMIT
@pytest.mark.parametrize(
    "course_id", ["A B", "Socio-L2", "x/y", "-x", ".x", "a" * 65, f"{_COURSE}\n"]
)
def test_a_malformed_course_id_is_400(client, post, course_id):
    assert post(client, course_id, _quiz(_COURSE_CONCEPT)).status_code == 400


@_ON_VALIDATE_AND_SUBMIT
def test_traversal_cannot_reach_a_bundle_outside_the_root(client, post, bundles_root):
    _write_canonical(bundles_root.parent / "x", _canonical_bundle())
    assert post(client, "../x", _quiz(_COURSE_CONCEPT)).status_code == 400


@pytest.mark.parametrize(
    "content", ["not json", '{"schema_version": "1.4"}'], ids=["not-json", "not-a-bundle"]
)
def test_a_canonical_bundle_that_does_not_parse_is_404(client, bundles_root, content):
    (bundles_root / "broken").mkdir()
    (bundles_root / "broken" / "lesson.json").write_text(content, encoding="utf-8")
    r = _validate(client, "broken", _quiz(_COURSE_CONCEPT))
    assert r.status_code == 404
    assert "LessonBundle" in r.json()["detail"]


def test_the_default_bundles_root_is_the_repo_fixtures_whatever_the_cwd(tmp_path, monkeypatch):
    monkeypatch.delenv("BUNDLES_ROOT", raising=False)
    monkeypatch.chdir(tmp_path)
    r = _validate(TestClient(scene_synth_app.app), _ATOMISTIQUE, _quiz(_ATOMISTIQUE_CONCEPT))
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_listing_still_filters_by_course(client):
    course_item = _submit(client, _COURSE, _quiz(_COURSE_CONCEPT)).json()["item_id"]
    demo_item = _submit(client, _ATOMISTIQUE, _quiz(_ATOMISTIQUE_CONCEPT)).json()["item_id"]
    assert _listed_ids(client, _COURSE) == [course_item]
    assert _listed_ids(client, _ATOMISTIQUE) == [demo_item]


# --------------------------------------------------------------------------- #
# Emission: <root>/<course_id>/community, COMMUNITY_BUNDLES_ROOT, metadata.
# --------------------------------------------------------------------------- #


def test_approve_emits_into_the_course_community_dir(client, bundles_root):
    canonical = bundles_root / _COURSE / "lesson.json"
    canonical_before = canonical.read_bytes()
    item_id = _submit(client, _COURSE, _quiz(_COURSE_CONCEPT)).json()["item_id"]

    decided = _approve(client, item_id)

    assert decided.status_code == 200, decided.text
    expected = bundles_root / _COURSE / "community" / f"community-{item_id}.zip"
    assert _emitted_path(decided) == expected.resolve()
    # Only the final zip: no hidden temp left beside it.
    assert [p.name for p in expected.parent.iterdir()] == [expected.name]
    assert canonical.read_bytes() == canonical_before


def test_community_bundles_root_replaces_the_root_for_emission_only(
    client, bundles_root, tmp_path, monkeypatch
):
    override = tmp_path / "community-root"
    monkeypatch.setenv("COMMUNITY_BUNDLES_ROOT", str(override))
    # The course still loads from BUNDLES_ROOT: the override holds no lesson.json.
    item_id = _submit(client, _COURSE, _quiz(_COURSE_CONCEPT)).json()["item_id"]

    decided = _approve(client, item_id)

    assert decided.status_code == 200, decided.text
    expected = override / _COURSE / "community" / f"community-{item_id}.zip"
    assert _emitted_path(decided) == expected.resolve()
    assert expected.is_file()
    assert not (bundles_root / _COURSE / "community").exists()


def test_the_emitted_bundle_inherits_canonical_metadata_and_names_its_author(client, store):
    item_id = _submit(client, _COURSE, _quiz(_COURSE_CONCEPT)).json()["item_id"]
    emitted = _emitted_path(_approve(client, item_id))

    with zipfile.ZipFile(emitted) as zf:
        lesson_raw = zf.read("lesson.json").decode("utf-8")
        prov_raw = zf.read("prov.json").decode("utf-8")

    metadata = json.loads(lesson_raw)["metadata"]
    canonical = _canonical_bundle()["metadata"]
    for field in ("language", "target", "discipline"):
        assert metadata[field] == canonical[field], field
    assert metadata["authoring"] == {"mode": "teacher", "author_is_learner": True, "drafted_by": "learner"}
    # Both Pydantic mirrors accept the bundle and read the same authoring block.
    assert LessonBundle.model_validate_json(lesson_raw).metadata.authoring.author_is_learner
    assert CanonicalLessonBundle.model_validate_json(lesson_raw).metadata.authoring.mode == "teacher"
    # The learner pseudonym stays in the ledger.
    pseudonym = store.get_item(item_id).author_pseudonym
    assert pseudonym not in lesson_raw
    assert pseudonym not in prov_raw
