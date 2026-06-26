"""Wave1-C — the three requested atomistique-l1 active-learning example scenes.

Locks in, for the authored fixture (fixtures/atomistique-l1/lesson.json):

- a `comparison` scene on c-orbitales-formes (AI-vs-teacher, orbital radial nodes),
- a `summary_audit` scene on c-particules (AI summary with a planted omission),
- a `prompt_practice` scene on c-remplissage ("écris un prompt … règle de Hund"),

and asserts the three scientific/pedagogical invariants that make them USABLE
offline (no API key):

1. each is on the requested concept with the requested type, and is a registered
   LWG task node (graph parity with the scenes);
2. each is OFFLINE-GRADEABLE *and* DISCRIMINATING: a model answer covers every
   cue/flaw, while an empty answer covers none — using a faithful Python mirror of
   the TS ai-audit-matcher normalize()/flawMatches() (accent + super/subscript
   folding), so the offline scorer the engine falls back to actually works;
3. NO ANSWER-KEY LEAK: no model_* reveal and no claim/key_point *text* appears in
   any learner-visible field (the answer key is never rendered pre-answer).

This is the schema-validation + grounding companion to the TS grader tests in
packages/lesson-session/src/grading/active-learning-graders.test.ts (which prove
the GRADERS wire these inputs); here we prove the authored FIXTURE is gradeable.
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pytest

from scene_synth_schemas import LessonBundle

REPO_ROOT = Path(__file__).resolve().parents[3]
BUNDLE_PATH = REPO_ROOT / "fixtures" / "atomistique-l1" / "lesson.json"


# --------------------------------------------------------------------------- #
# Faithful Python mirror of packages/lesson-session/src/grading/ai-audit-matcher.ts
# (normalize + flawMatches). Kept tiny + local so the test has no JS dependency.
# --------------------------------------------------------------------------- #


def _normalize(text: str) -> str:
    # NFKD + strip combining marks (é→e, 2p³→2p3, H₂O→h2o); _, -, ' (straight/curly) → space.
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
def by_id(bundle: LessonBundle) -> dict:
    return {s.id: s for s in bundle.scenes}


# The three requested scenes: (scene_id, type, required concept).
REQUESTED = [
    ("s3c-compare-noeuds", "comparison", "c-orbitales-formes"),
    ("s1b-audit-particules", "summary_audit", "c-particules"),
    ("s5d-prompt-hund", "prompt_practice", "c-remplissage"),
]

# A model answer per scene that a competent learner would write (accent-free is NOT
# required — the matcher folds accents; we use natural French here to prove that).
MODEL_ANSWERS = {
    "s3c-compare-noeuds": (
        "L'enseignant distingue le nœud radial (une sphère) du nœud angulaire "
        "(un plan) ; il relie la formule à l'orbitale 3D où l'on voit les deux "
        "lobes, et explique le total."
    ),
    "s1b-audit-particules": (
        "Le résumé omet que Z (le nombre de protons) définit l'élément, et il "
        "oublie la définition des isotopes."
    ),
    "s5d-prompt-hund": (
        "J'écris un prompt : explique pourquoi, pour un niveau L1, avec un "
        "exemple concret (l'azote 2p³) et un schéma de cases quantiques en sortie."
    ),
}


def _cues_of(scene) -> list[str]:
    """The answer-key cues, whichever field carries them (claims vs key_points)."""
    if hasattr(scene, "claims") and scene.claims:
        return [c for claim in scene.claims for c in claim.flaws_expected]
    return [c for kp in scene.key_points for c in kp.cues]


def _visible_text(scene) -> str:
    """Concatenated LEARNER-VISIBLE fields (rendered pre-answer)."""
    parts = []
    for attr in (
        "prompt", "artifact_a", "artifact_b", "task", "starter_prompt",
        "source_content", "ai_summary", "flawed_content",
    ):
        v = getattr(scene, attr, None)
        if v:
            parts.append(_normalize(v))
    return "  ".join(parts)


def _answer_key_text(scene) -> list[str]:
    """Reveal/answer-key fields that must NEVER render before the learner answers."""
    out = []
    for attr in ("model_answer", "model_correction", "model_prompt"):
        v = getattr(scene, attr, None)
        if v:
            out.append(_normalize(v))
    for claim in getattr(scene, "claims", None) or []:
        out.append(_normalize(claim.text))
    for kp in getattr(scene, "key_points", None) or []:
        out.append(_normalize(kp.text))
    return out


# --------------------------------------------------------------------------- #
# 1. Presence: requested type on requested concept, + LWG task node.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("scene_id, scene_type, concept", REQUESTED)
def test_requested_scene_present_on_concept(by_id, scene_id, scene_type, concept):
    assert scene_id in by_id, f"missing requested scene {scene_id}"
    scene = by_id[scene_id]
    assert scene.type == scene_type
    assert concept in scene.concept_refs


@pytest.mark.parametrize("scene_id, scene_type, concept", REQUESTED)
def test_requested_scene_is_lwg_task_node(bundle, scene_id, scene_type, concept):
    lwg = bundle.learning_workflow_graph
    assert lwg is not None
    task = next((n for n in lwg["nodes"] if n["id"] == f"task:{scene_id}"), None)
    assert task is not None, f"{scene_id} is not an LWG task node"
    assert task["scene_type"] == scene_type
    # …and it `assesses` the requested concept.
    assesses = [
        e for e in lwg["edges"]
        if e["relation"] == "assesses" and e["source"] == f"task:{scene_id}"
    ]
    assert any(e["target"] == f"concept:{concept}" for e in assesses)


# --------------------------------------------------------------------------- #
# 2. Offline-gradeable AND discriminating (no API key needed).
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("scene_id, scene_type, concept", REQUESTED)
def test_model_answer_fully_covers_cues(by_id, scene_id, scene_type, concept):
    scene = by_id[scene_id]
    cues = _cues_of(scene)
    assert cues, "scene must carry at least one cue/flaw"
    hits, total = _coverage(cues, MODEL_ANSWERS[scene_id])
    assert hits == total, f"{scene_id}: only {hits}/{total} cues covered offline"


@pytest.mark.parametrize("scene_id, scene_type, concept", REQUESTED)
def test_empty_answer_covers_nothing(by_id, scene_id, scene_type, concept):
    scene = by_id[scene_id]
    hits, _ = _coverage(_cues_of(scene), "rien à signaler, je ne sais pas")
    assert hits == 0, f"{scene_id}: an empty answer must not score (got {hits})"


# --------------------------------------------------------------------------- #
# 3. No answer-key leak into learner-visible fields.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("scene_id, scene_type, concept", REQUESTED)
def test_no_answer_key_leak(by_id, scene_id, scene_type, concept):
    scene = by_id[scene_id]
    visible = _visible_text(scene)
    leaked = [ak for ak in _answer_key_text(scene) if ak and ak in visible]
    assert not leaked, f"{scene_id}: answer-key text leaked into a visible field"


def test_prompt_practice_starter_is_visible_not_an_answer(by_id):
    """starter_prompt is the refinable affordance — present AND deliberately weak
    (it must NOT already satisfy the cues, or the exercise is given away)."""
    scene = by_id["s5d-prompt-hund"]
    assert scene.starter_prompt, "prompt_practice should ship a starter_prompt to refine"
    hits, total = _coverage(_cues_of(scene), scene.starter_prompt)
    assert hits < total, "the starter_prompt must not already cover the cues"
