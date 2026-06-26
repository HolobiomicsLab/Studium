"""Wave2-D2 — the authored atomistique-l1 communication_sim example scene.

Locks in, for the authored fixture (fixtures/atomistique-l1/lesson.json):

- a `communication_sim` scene on c-orbitales-formes (Dubas "simuler des situations
  de communication professionnelle"): explain to a TD classmate WHY the 2p has two
  lobes, WITHOUT jargon,

and asserts the three scientific/pedagogical invariants that make it USABLE
offline (no API key):

1. it is on the requested concept with the requested type, and is a registered LWG
   task node that `assesses` that concept (graph parity with the scene);
2. it is OFFLINE-GRADEABLE *and* DISCRIMINATING: a model answer covers every cue,
   while an empty answer covers none — using a faithful Python mirror of the TS
   ai-audit-matcher normalize()/flawMatches() (accent + super/subscript folding),
   so the offline scorer the engine falls back to actually works. The authored
   model_response self-covers every cue (the scene is self-grading offline);
3. NO ANSWER-KEY LEAK: no model_response reveal and no key_point *text* appears in
   any learner-visible field (scenario / prompt) — the answer key is never rendered
   pre-answer.

Companion to the TS grader test in
packages/lesson-session/src/grading/active-learning-graders.test.ts (which proves
the GRADERS wire the {kind:"communication"} input); here we prove the authored
FIXTURE is gradeable.
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pytest

from scene_synth_schemas import CommunicationSimScene, LessonBundle

REPO_ROOT = Path(__file__).resolve().parents[3]
BUNDLE_PATH = REPO_ROOT / "fixtures" / "atomistique-l1" / "lesson.json"

SCENE_ID = "s3d-communicate-2p"
CONCEPT = "c-orbitales-formes"


# --------------------------------------------------------------------------- #
# Faithful Python mirror of packages/lesson-session/src/grading/ai-audit-matcher.ts
# (normalize + flawMatches). Kept tiny + local so the test has no JS dependency.
# --------------------------------------------------------------------------- #


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    no_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    out = no_marks.lower()
    for ch in ("_", "-", "'", "’"):
        out = out.replace(ch, " ")
    return out


def _flaw_matches(flaw: str, normalized_critique: str) -> bool:
    needle = _normalize(flaw).strip()
    if not needle:
        return False
    if needle in normalized_critique:
        return True
    flaw_tokens = [t for t in _normalize(flaw).split() if t]
    if not flaw_tokens:
        return False
    return all(t in normalized_critique for t in flaw_tokens)


def _coverage(cues: list[str], critique: str) -> tuple[int, int]:
    norm = _normalize(critique)
    return sum(_flaw_matches(c, norm) for c in cues), len(cues)


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def bundle() -> LessonBundle:
    raw = json.loads(BUNDLE_PATH.read_text())
    return LessonBundle.model_validate(raw)


@pytest.fixture(scope="module")
def scene(bundle: LessonBundle) -> CommunicationSimScene:
    sc = next((s for s in bundle.scenes if s.id == SCENE_ID), None)
    assert sc is not None, f"missing requested scene {SCENE_ID}"
    assert isinstance(sc, CommunicationSimScene)
    return sc


def _cues_of(scene: CommunicationSimScene) -> list[str]:
    return [c for kp in scene.key_points for c in kp.cues]


# --------------------------------------------------------------------------- #
# 1. Presence: requested type on requested concept, + LWG task node.
# --------------------------------------------------------------------------- #


def test_scene_present_on_concept(scene: CommunicationSimScene):
    assert scene.type == "communication_sim"
    assert CONCEPT in scene.concept_refs


def test_scene_is_lwg_task_node(bundle: LessonBundle):
    lwg = bundle.learning_workflow_graph
    assert lwg is not None
    task = next((n for n in lwg["nodes"] if n["id"] == f"task:{SCENE_ID}"), None)
    assert task is not None, f"{SCENE_ID} is not an LWG task node"
    assert task["scene_type"] == "communication_sim"
    assesses = [
        e for e in lwg["edges"]
        if e["relation"] == "assesses" and e["source"] == f"task:{SCENE_ID}"
    ]
    assert any(e["target"] == f"concept:{CONCEPT}" for e in assesses)


# --------------------------------------------------------------------------- #
# 2. Offline-gradeable AND discriminating (no API key needed).
# --------------------------------------------------------------------------- #


def test_at_least_one_cue(scene: CommunicationSimScene):
    assert len(scene.key_points) >= 1
    assert _cues_of(scene), "scene must carry at least one cue"


def test_model_response_self_covers_cues(scene: CommunicationSimScene):
    """The authored model_response covers EVERY cue — the example is self-grading
    offline (the requested 'self-covering the model_response' property)."""
    hits, total = _coverage(_cues_of(scene), scene.model_response)
    assert hits == total, f"only {hits}/{total} cues covered by the model_response"


def test_empty_answer_covers_nothing(scene: CommunicationSimScene):
    hits, _ = _coverage(_cues_of(scene), "je ne sais pas trop quoi dire")
    assert hits == 0, f"an empty answer must not score (got {hits})"


# --------------------------------------------------------------------------- #
# 3. No answer-key leak into learner-visible fields.
# --------------------------------------------------------------------------- #


def test_no_answer_key_leak(scene: CommunicationSimScene):
    visible = "  ".join(_normalize(v) for v in (scene.scenario, scene.prompt))
    answer_key = [_normalize(scene.model_response)]
    answer_key += [_normalize(kp.text) for kp in scene.key_points]
    leaked = [ak for ak in answer_key if ak and ak in visible]
    assert not leaked, "answer-key text leaked into a learner-visible field"
