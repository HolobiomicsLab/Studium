"""P1 — tests for the append-only LAItem ledger (``learner_items_store``).

LLM-free, deterministic. They assert:
- an LAItemEnvelope round-trips Pydantic (valid quiz / spot_the_flaw / explain_back);
- the store appends one JSONL line per write and reconstructs the LATEST snapshot
  per ``item_id`` (history is replayable; latest wins);
- the forward-only transition table is enforced — legal transitions succeed,
  illegal ones raise (self-loops, backward edges, dead-end states);
- learner-written items can only be ``submitted`` at append time is a P2 concern,
  but the store rejects any FIRST state that is not ``submitted``;
- SCOPE-PURITY: ``envelope.scene`` round-trips through the UNMODIFIED bundler /
  ``Scene`` validation with NO learner/envelope keys leaking into the Scene.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bundler import build_bundle  # noqa: E402
from scene_synth_schemas import Scene  # noqa: E402
from pydantic import TypeAdapter  # noqa: E402

from learner_items_store import (  # noqa: E402
    LAItemEnvelope,
    LearnerItemsStore,
    LEGAL_TRANSITIONS,
    IllegalTransitionError,
    transition_allowed,
)

_SceneAdapter = TypeAdapter(Scene)


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


def _spot_scene() -> dict:
    return {
        "id": "s-flaw",
        "type": "spot_the_flaw",
        "title": "Erreur plantée",
        "objective_refs": [],
        "concept_refs": [],
        "estimated_seconds": 0,
        "adaptation_hooks": [],
        "flawed_content": "L'orbitale 3s a 3 nœuds radiaux.",
        "claims": [{"id": "k1", "text": "3 nœuds radiaux", "flaws_expected": ["n−ℓ−1", "2"]}],
        "model_correction": "n−ℓ−1 = 2.",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }


def _explain_scene() -> dict:
    return {
        "id": "s-eb",
        "type": "explain_back",
        "title": "Explique",
        "objective_refs": [],
        "concept_refs": [],
        "estimated_seconds": 0,
        "adaptation_hooks": [],
        "prompt": "Explique la règle n−ℓ−1.",
        "key_points": [{"id": "kp1", "text": "compter les nœuds", "cues": ["radial"]}],
        "model_explanation": "Les nœuds radiaux valent n−ℓ−1.",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }


def _envelope(scene: dict, item_id: str = "item-1", state: str = "submitted") -> dict:
    return {
        "item_id": item_id,
        "course_id": "atomistique-l1",
        "target_bundle_ref": "atomistique-l1.json",
        "schema_version": "1.4",
        "scene": scene,
        "author_pseudonym": "hmac-deadbeef",
        "created_at": "2026-06-26T10:00:00Z",
        "review_state": state,
        "validation": {"ok": True, "validator_version": "validate_scene/1.0", "errors": []},
    }


# ---------------------------------------------------------------------------
# Envelope round-trip (Pydantic mirror parity)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("scene", [_quiz_scene(), _spot_scene(), _explain_scene()])
def test_envelope_round_trips_full_scene_union(scene):
    env = LAItemEnvelope.model_validate(_envelope(scene))
    assert env.review_state == "submitted"
    assert env.author_pseudonym == "hmac-deadbeef"
    # dump → reload is stable
    reloaded = LAItemEnvelope.model_validate(env.model_dump())
    assert reloaded.scene.type == scene["type"]


def test_envelope_rejects_invalid_scene():
    bad = _envelope(_quiz_scene())
    bad["scene"]["type"] = "not_a_type"
    with pytest.raises(Exception):
        LAItemEnvelope.model_validate(bad)


# ---------------------------------------------------------------------------
# Transition table
# ---------------------------------------------------------------------------

def test_legal_transition_table_is_forward_only():
    assert LEGAL_TRANSITIONS == {
        "submitted": {"peer_review", "approved", "rejected", "revision_requested"},
        "peer_review": {"approved", "rejected", "revision_requested"},
        "revision_requested": set(),
        "approved": {"published"},
        "published": set(),
        "rejected": set(),
    }


@pytest.mark.parametrize(
    "frm,to",
    [
        ("submitted", "peer_review"),
        ("submitted", "approved"),
        ("submitted", "rejected"),
        ("submitted", "revision_requested"),
        ("peer_review", "approved"),
        ("peer_review", "rejected"),
        ("approved", "published"),
    ],
)
def test_legal_transitions_allowed(frm, to):
    assert transition_allowed(frm, to) is True


@pytest.mark.parametrize(
    "frm,to",
    [
        ("submitted", "submitted"),   # self-loop
        ("approved", "submitted"),    # backward
        ("published", "approved"),    # dead-end
        ("rejected", "approved"),     # dead-end
        ("revision_requested", "approved"),  # revision => new item_id, not in-place
        ("approved", "rejected"),     # cannot un-approve to reject
    ],
)
def test_illegal_transitions_forbidden(frm, to):
    assert transition_allowed(frm, to) is False


# ---------------------------------------------------------------------------
# Append-only ledger semantics
# ---------------------------------------------------------------------------

def test_first_write_must_be_submitted(tmp_path):
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    env = LAItemEnvelope.model_validate(_envelope(_quiz_scene(), state="approved"))
    with pytest.raises(IllegalTransitionError):
        store.append_new(env)


def test_append_new_then_transition_appends_one_line_each(tmp_path):
    path = tmp_path / "learner_items.jsonl"
    store = LearnerItemsStore(path)
    env = LAItemEnvelope.model_validate(_envelope(_quiz_scene()))
    store.append_new(env)
    assert path.read_text().strip().count("\n") == 0  # one line, no trailing newline counts

    store.transition("item-1", "approved", reviewed_by="https://uca.fr/teacher/1",
                     reviewed_at="2026-06-26T11:00:00Z")
    lines = [ln for ln in path.read_text().splitlines() if ln.strip()]
    assert len(lines) == 2  # append-only: original + new snapshot


def test_latest_snapshot_per_item_reconstruction(tmp_path):
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(LAItemEnvelope.model_validate(_envelope(_quiz_scene(), item_id="a")))
    store.append_new(LAItemEnvelope.model_validate(_envelope(_spot_scene(), item_id="b")))
    store.transition("a", "peer_review")
    store.transition("a", "approved", reviewed_by="https://uca.fr/teacher/1",
                     reviewed_at="2026-06-26T11:00:00Z")

    latest = store.latest_snapshots()
    assert set(latest.keys()) == {"a", "b"}
    assert latest["a"].review_state == "approved"
    assert latest["a"].reviewed_by == "https://uca.fr/teacher/1"
    assert latest["b"].review_state == "submitted"

    # get_item returns the latest snapshot
    assert store.get_item("a").review_state == "approved"


def test_transition_rejects_illegal_jump(tmp_path):
    store = LearnerItemsStore(tmp_path / "learner_items.jsonl")
    store.append_new(LAItemEnvelope.model_validate(_envelope(_quiz_scene())))
    store.transition("item-1", "approved", reviewed_by="t", reviewed_at="2026-06-26T11:00:00Z")
    with pytest.raises(IllegalTransitionError):
        store.transition("item-1", "submitted")  # backward


def test_reload_from_disk_reconstructs_latest(tmp_path):
    path = tmp_path / "learner_items.jsonl"
    store = LearnerItemsStore(path)
    store.append_new(LAItemEnvelope.model_validate(_envelope(_quiz_scene())))
    store.transition("item-1", "approved", reviewed_by="t", reviewed_at="2026-06-26T11:00:00Z")

    # fresh store over the same file replays the ledger
    store2 = LearnerItemsStore(path)
    assert store2.get_item("item-1").review_state == "approved"


# ---------------------------------------------------------------------------
# SCOPE-PURITY — the scene must round-trip through the UNMODIFIED bundler/Scene
# validation with no learner/envelope keys leaking into the Scene body.
# ---------------------------------------------------------------------------

_ENVELOPE_ONLY_KEYS = {
    "item_id", "course_id", "target_bundle_ref", "author_pseudonym",
    "prior_author", "created_at", "review_state", "reviewed_by", "reviewed_at",
    "review_note_code", "validation", "peer_signals", "published_bundle_ref",
}


@pytest.mark.parametrize("scene", [_quiz_scene(), _spot_scene(), _explain_scene()])
def test_scope_purity_scene_has_no_envelope_keys(scene):
    env = LAItemEnvelope.model_validate(_envelope(scene))
    scene_dict = env.scene.model_dump(exclude_none=True)
    leaked = _ENVELOPE_ONLY_KEYS & set(scene_dict.keys())
    assert leaked == set(), f"envelope keys leaked into scene: {leaked}"
    # round-trips through the SAME Scene union the bundler validates
    _SceneAdapter.validate_python(scene_dict)


def test_scope_purity_strips_smuggled_envelope_keys():
    """SCOPE-PURITY (adversarial): governance keys SMUGGLED into the scene body are
    stripped on validation — a learner cannot back-door an 'approved' state, a fake
    pseudonym, or a forged validation into the schema-pure Scene."""
    smuggled_scene = {
        **_quiz_scene(),
        "author_pseudonym": "hmac-evil",
        "review_state": "approved",
        "validation": {"ok": True, "validator_version": "forged", "errors": []},
        "reviewed_by": "teacher:evil",
        "published_bundle_ref": "file:///etc/passwd",
    }
    env = LAItemEnvelope.model_validate(_envelope(smuggled_scene))
    scene_dict = env.scene.model_dump(exclude_none=True)
    leaked = _ENVELOPE_ONLY_KEYS & set(scene_dict.keys())
    assert leaked == set(), f"smuggled envelope keys survived in scene: {leaked}"
    # top-level governance is unaffected by the smuggle attempt
    assert env.review_state == "submitted"
    assert env.author_pseudonym == "hmac-deadbeef"


def test_scope_purity_scene_builds_through_unmodified_bundler(tmp_path):
    """The envelope's scene drops into build_bundle unchanged — no envelope
    keys, no author_pseudonym, reach the distributed lesson.json/prov.json."""
    env = LAItemEnvelope.model_validate(_envelope(_quiz_scene()))
    scene_dict = env.scene.model_dump(exclude_none=True)

    lesson_plan = {
        "lesson_id": "community-item-1",
        "plan_id": "community-item-1",
        "title": "Community item",
        "concepts": [
            {"id": "c-orbitales-formes", "title": "Formes des orbitales",
             "description": "d", "bloom_level_target": "apply"},
        ],
        "rules": [],
    }
    out = tmp_path / "community.zip"
    uri = build_bundle(lesson_plan, [scene_dict], out, {"agent": "scene-synth", "version": "0.1.0"})
    assert uri.startswith("file://")

    import zipfile
    with zipfile.ZipFile(out) as zf:
        lesson_txt = zf.read("lesson.json").decode("utf-8")
        prov_txt = zf.read("prov.json").decode("utf-8")
    assert "hmac-deadbeef" not in lesson_txt
    assert "hmac-deadbeef" not in prov_txt
    assert "author_pseudonym" not in lesson_txt
    assert "review_state" not in lesson_txt
