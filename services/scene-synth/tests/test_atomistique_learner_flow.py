"""P5 — atomistique learner-as-author end-to-end (Python half).

Proves the FULL learner-as-author loop for the canonical atomistique-l1 course up
to the emitted community bundle — the meeting point the TS half (discover -> load
-> grade) then reads. The loop crosses Python and TS; this file owns the
author -> peer -> approve -> emit half:

  1. AUTHOR — a learner authors EXACTLY ONE schema-pure quiz Scene on the real
     course concept ``c-orbitales-formes`` (radial nodes of the 3s orbital =
     n-l-1 = 3-0-1 = 2, so the correct choice is the one labelled '2'). It is
     validated through the SAME ``validate_scene`` gate the bundler uses, then
     staged ``submitted`` via the store (the only state a learner can write).
  2. PEER — a different learner records ONE passing test+rating (P3). This opens
     ``peer_review``; only the four aggregate scalars are stored (no identity,
     no free text).
  3. APPROVE — the teacher approves via ``decide_item`` with a UCA IRI + an
     EXPLICIT timestamp (rule-003 chokepoint). A community bundle ZIP is emitted.
  4. EMIT — the emitted bundle is asserted valid (loads as a LessonBundle, carries
     the schema-pure quiz with the correct choice intact) AND pseudonym-scrubbed
     (the HMAC author pseudonym appears in NEITHER lesson.json NOR prov.json;
     it survives only in the ledger as ``prior_author``).

The bundle is emitted into a KNOWN bundles root laid out so the TS driver
(``fixtures/atomistique-l1/community_flow_check.mjs``) can read it directly:

    <root>/lesson.json                       # the canonical atomistique-l1 (copied, immutable)
    <root>/community/community-<item>.zip     # the emitted single-scene community bundle

so ``SessionHost({ bundlesRoot: <root> })`` discovers the community bundle via
``community/`` while still loading the canonical course by the ``lesson.json``
ref. The demo is internally consistent: 3s radial nodes = 2.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bundler import validate_scene  # noqa: E402
from learner_items_store import (  # noqa: E402
    LAItemEnvelope,
    LearnerItemsStore,
)
from learner_review import decide_item, peer_signals_view, record_peer_review  # noqa: E402
from scene_synth_schemas import LessonBundle  # noqa: E402

_CANONICAL_LESSON = (
    Path(__file__).resolve().parents[3] / "fixtures" / "atomistique-l1" / "lesson.json"
)

# The learner authors on this REAL course concept (it exists in the canonical bundle).
_CONCEPT_ID = "c-orbitales-formes"
_ITEM_ID = "atomistique-la-3s-noeuds"

_PSEUDONYM = "hmac-0123456789abcdef0123456789abcdef"
_TEACHER = "https://univ-cotedazur.fr/people/teacher-001"
_CREATED_AT = "2026-06-26T09:00:00Z"
_REVIEWED_AT = "2026-06-26T15:30:00Z"


def _course_concepts() -> list[dict]:
    """The canonical atomistique concepts (so the synthesized plan validates)."""
    return json.loads(_CANONICAL_LESSON.read_text(encoding="utf-8"))["concepts"]


def _authored_quiz_3s() -> dict:
    """A schema-pure quiz Scene: radial nodes of the 3s orbital = n-l-1 = 2.

    The correct choice is the one whose TEXT is '2' (choice id 'c'); the other
    choices are wrong. This is the item the TS classmate will later answer."""
    return {
        "id": "s-la-3s-noeuds",
        "type": "quiz",
        "title": "Nœuds radiaux de la 3s (item étudiant)",
        "objective_refs": [],
        "concept_refs": [_CONCEPT_ID],
        "estimated_seconds": 60,
        "adaptation_hooks": [],
        "question": "Combien de nœuds RADIAUX possède l'orbitale 3s ?",
        "choices": [
            {"id": "a", "text": "0", "correct": False},
            {"id": "b", "text": "1", "correct": False},
            {"id": "c", "text": "2", "correct": True},
            {"id": "d", "text": "3", "correct": False},
        ],
        "feedback_correct": "Exact : nœuds radiaux = n − ℓ − 1 = 3 − 0 − 1 = 2.",
        "feedback_incorrect": "Rappel : nœuds radiaux = n − ℓ − 1. Pour la 3s : 3 − 0 − 1 = 2.",
        "hints": ["n − ℓ − 1", "ℓ = 0 pour une orbitale s."],
    }


def _correct_choice_id(scene: dict) -> str:
    return next(c["id"] for c in scene["choices"] if c["correct"])


def _path_from_uri(uri: str) -> Path:
    return Path(url2pathname(urlparse(uri).path))


@pytest.fixture
def e2e_root(tmp_path: Path) -> Path:
    """A known bundles root the TS half reads: canonical lesson.json + community/."""
    root = tmp_path / "atomistique-l1"
    root.mkdir(parents=True)
    shutil.copyfile(_CANONICAL_LESSON, root / "lesson.json")
    return root


def test_demo_is_internally_consistent_3s_radial_nodes_is_2():
    """Guard the demo's chemistry: the authored item's correct answer is '2'
    (radial nodes of 3s = n−ℓ−1 = 3−0−1 = 2). If someone edits the scene and
    breaks this, the whole e2e premise is wrong — fail loudly here."""
    scene = _authored_quiz_3s()
    correct = next(c for c in scene["choices"] if c["correct"])
    assert correct["text"] == "2"
    # n - l - 1 for 3s: n=3, l=0 -> 2
    assert 3 - 0 - 1 == int(correct["text"])


def test_atomistique_author_peer_approve_emit_end_to_end(e2e_root: Path):
    """The full author -> peer -> approve -> emit half, ending at a valid,
    pseudonym-scrubbed community bundle in the known root the TS half reads."""
    concepts = _course_concepts()
    concept_ids = [c["id"] for c in concepts]
    assert _CONCEPT_ID in concept_ids  # the concept the learner authors on is real.

    scene = _authored_quiz_3s()

    # 1. AUTHOR — validate through the SAME gate the bundler uses, then stage.
    validation = validate_scene(scene, course_concept_ids=concept_ids)
    assert validation["ok"], validation["errors"]

    store = LearnerItemsStore(e2e_root / "learner_items.jsonl")
    env = LAItemEnvelope(
        item_id=_ITEM_ID,
        course_id="atomistique-l1",
        target_bundle_ref="atomistique-l1/lesson.json",
        scene=scene,
        author_pseudonym=_PSEUDONYM,
        created_at=_CREATED_AT,
        review_state="submitted",
        validation=validation,
    )
    store.append_new(env)
    assert store.get_item(_ITEM_ID).review_state == "submitted"

    # 2. PEER — a DIFFERENT learner records one passing test + rating (P3).
    after_peer = record_peer_review(
        store, _ITEM_ID, passed=True, rating=5, helpful=True, peer_pseudonym="peer-x"
    )
    assert after_peer.review_state == "peer_review"
    assert after_peer.peer_signals is not None
    assert after_peer.peer_signals.n_tests == 1
    assert after_peer.peer_signals.n_ratings == 1
    assert after_peer.peer_signals.mean_rating == 5.0
    # k-suppressed teacher view: one rating is below the floor -> withheld.
    assert peer_signals_view(store, _ITEM_ID)["status"] == "suppressed"

    # 3. APPROVE — teacher decision (UCA IRI + explicit timestamp) emits the bundle
    #    into <root>/community so the TS host discovers it via community/.
    community_root = e2e_root / "community"
    published = decide_item(
        store,
        _ITEM_ID,
        decision="approve",
        reviewer=_TEACHER,
        reviewed_at=_REVIEWED_AT,
        bundles_root=community_root,
        course_concepts=concepts,
        note_code="ok",
    )
    assert published.review_state == "published"
    assert published.reviewed_by == _TEACHER
    assert published.reviewed_at == _REVIEWED_AT
    # the learner pseudonym survives ONLY in the ledger, as prior_author.
    assert published.prior_author == _PSEUDONYM
    assert published.published_bundle_ref is not None

    bundle_path = _path_from_uri(published.published_bundle_ref)
    assert bundle_path.exists()
    # emitted at the TS-discoverable location: <root>/community/community-<item>.zip
    assert bundle_path.parent == community_root.resolve()
    assert bundle_path.name == f"community-{_ITEM_ID}.zip"

    # 4. EMIT — the bundle is VALID and pseudonym-SCRUBBED.
    with zipfile.ZipFile(bundle_path) as zf:
        lesson_raw = zf.read("lesson.json").decode("utf-8")
        prov_raw = zf.read("prov.json").decode("utf-8")
    # scrub: the HMAC pseudonym is absent from BOTH distributed files.
    assert _PSEUDONYM not in lesson_raw
    assert _PSEUDONYM not in prov_raw
    # valid: round-trips as a LessonBundle and carries the schema-pure quiz intact.
    lesson = json.loads(lesson_raw)
    bundle = LessonBundle.model_validate(lesson)
    assert bundle.validated_by == _TEACHER  # rule-003 vouching, not the learner.
    emitted_scene = next(s for s in lesson["scenes"] if s["type"] == "quiz")
    # the correct choice survived verbatim: the '2' choice is still the correct one.
    correct_choice = next(c for c in emitted_scene["choices"] if c["correct"])
    assert correct_choice["text"] == "2"
    assert _correct_choice_id(scene) == correct_choice["id"]

    # the canonical course was NEVER mutated (immutability).
    canonical_after = json.loads((e2e_root / "lesson.json").read_text(encoding="utf-8"))
    canonical_orig = json.loads(_CANONICAL_LESSON.read_text(encoding="utf-8"))
    assert canonical_after == canonical_orig
