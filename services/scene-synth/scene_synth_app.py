"""FastAPI app for the scene-synth service (A.7).

Exposes:
- ``GET  /health`` — liveness probe.
- ``POST /scenes/synthesize`` — orchestrates the six SceneAgents and
  returns a ``LessonBundle`` ZIP URI.
- ``POST /scenes/critique-eval`` — scores a student critique against a
  set of claims + rubric (anti-offloading; cf. ADR 001/004).

Singletons ``_orchestrator`` and ``_critique_evaluator`` are module-level
so tests can override them via ``monkeypatch.setattr``. The default
factory ``_build_default_orchestrator`` returns ``None`` unless the
``ABS_CAPSULE_ROOT`` env var is set, so the app boots in test contexts
without a real LLM.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from agents.base import SceneSynthError
from agents.critique_evaluator import CritiqueEvaluator
from bundler import validate_scene
from learner_items_store import LAItemEnvelope, LearnerItemsStore
from learner_review import decide_item
from orchestrator import SceneSynthOrchestrator
from scene_synth_schemas import (
    CritiqueEvalRequest,
    CritiqueEvalResponse,
    LearnerDecideRequest,
    LearnerItemView,
    LearnerItemsListResponse,
    LearnerSubmitRequest,
    LearnerValidateRequest,
    LearnerValidateResponse,
    SynthesizeRequest,
    SynthesizeResponse,
)


app = FastAPI(title="scene-synth", version="0.1.0")

# CORS for the deferred author-web (:3000) form. Confirmed absent before this
# pass; learner endpoints are browser-driven from that origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Module-level singletons — overridable in tests via monkeypatch.
_orchestrator: Optional[SceneSynthOrchestrator] = None
_critique_evaluator: Optional[CritiqueEvaluator] = None

# Learner-as-author state. Overridable in tests via monkeypatch.setattr.
_LEARNER_DATA_ROOT = Path(
    os.environ.get("LEARNER_DATA_ROOT", "/tmp/studium-learner-items")
)
_learner_store: LearnerItemsStore = LearnerItemsStore(
    _LEARNER_DATA_ROOT / "learner_items.jsonl"
)
_learner_bundles_root: Path = _LEARNER_DATA_ROOT / "community-bundles"

# Demo course context (plan §"Minor defaults": hardcoded to atomistique-l1).
# The single course concept a learner quiz on radial nodes references.
_DEMO_COURSE_ID = "atomistique-l1"
_COURSE_CONCEPTS: list[dict] = [
    {
        "id": "c-orbitales-formes",
        "title": "Formes des orbitales",
        "description": "Nombre de nœuds radiaux et angulaires des orbitales.",
        "bloom_level_target": "understand",
    }
]


def _course_concept_ids() -> list[str]:
    return [c["id"] for c in _COURSE_CONCEPTS]


def _assert_demo_course(course_id: str) -> None:
    """MVP single-course guard: validation uses the hardcoded demo concepts, so a
    request for any other course_id is rejected rather than silently validated
    against (and stored under) the wrong course."""
    if course_id != _DEMO_COURSE_ID:
        raise HTTPException(
            status_code=400,
            detail=f"course_id must be {_DEMO_COURSE_ID!r} for the MVP (got {course_id!r})",
        )


def _pseudonym_secret() -> bytes:
    """HMAC key for the author pseudonym (scene-synth env var; server-only)."""
    return os.environ.get("LEARNER_PSEUDONYM_SECRET", "dev-insecure-secret").encode(
        "utf-8"
    )


def _author_pseudonym(course_id: str, author_handle: str) -> str:
    """HMAC-SHA256(course_id|author_handle) — server-only, NEVER distributed.

    Deterministic per (course, author) so the same learner maps to a stable
    pseudonym in the ledger, but the raw handle is never recoverable from it.
    """
    msg = f"{course_id}|{author_handle}".encode("utf-8")
    digest = hmac.new(_pseudonym_secret(), msg, hashlib.sha256).hexdigest()
    return f"hmac-{digest[:32]}"


def _to_view(env: LAItemEnvelope) -> LearnerItemView:
    """Project an envelope to a CLIENT-SAFE view — author_pseudonym is DROPPED."""
    return LearnerItemView(
        item_id=env.item_id,
        course_id=env.course_id,
        target_bundle_ref=env.target_bundle_ref,
        schema_version=env.schema_version,
        scene=env.scene,
        review_state=env.review_state,
        reviewed_by=env.reviewed_by,
        reviewed_at=env.reviewed_at,
        review_note_code=env.review_note_code,
        validation=env.validation.model_dump(),
        created_at=env.created_at,
        published_bundle_ref=env.published_bundle_ref,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scenes/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest) -> SynthesizeResponse:
    if _orchestrator is None:
        raise HTTPException(
            status_code=503, detail="orchestrator not configured"
        )
    options = req.options.model_dump() if req.options else {}
    try:
        result = _orchestrator.synthesize_lesson(
            lesson_plan=req.lesson_plan,
            options=options,
        )
    except SceneSynthError as e:
        raise HTTPException(
            status_code=502, detail=f"LLM call failed: {e}"
        )
    return SynthesizeResponse(**result)


@app.post("/scenes/critique-eval", response_model=CritiqueEvalResponse)
def critique_eval(req: CritiqueEvalRequest) -> CritiqueEvalResponse:
    if _critique_evaluator is None:
        raise HTTPException(
            status_code=503, detail="critique evaluator not configured"
        )
    result = _critique_evaluator.evaluate(
        claims=[c.model_dump() for c in req.claims],
        rubric=req.rubric.model_dump(),
        student_critique=req.student_critique,
    )
    return CritiqueEvalResponse(score=result.score, feedback=result.feedback)


# --------------------------------------------------------------------------- #
# Learner-as-author endpoints (plan §"P2").
# --------------------------------------------------------------------------- #


@app.post("/learner-items/validate", response_model=LearnerValidateResponse)
def learner_validate(req: LearnerValidateRequest) -> LearnerValidateResponse:
    """Validate ONE scene (validate-only, no write) via the pure ``validate_scene``."""
    _assert_demo_course(req.course_id)
    result = validate_scene(req.scene, course_concept_ids=_course_concept_ids())
    return LearnerValidateResponse(**result)


@app.post("/learner-items", response_model=LearnerItemView, status_code=201)
def learner_submit(req: LearnerSubmitRequest) -> LearnerItemView:
    """Stage a learner-authored scene as ``review_state='submitted'``.

    Learner endpoints can ONLY ever write ``submitted``; surfacing happens
    EXCLUSIVELY through ``decide_item`` (the rule-003 gate). A failing scene is
    rejected (422) and nothing is staged. The HMAC ``author_pseudonym`` is
    computed server-side and is NEVER returned in the response.
    """
    _assert_demo_course(req.course_id)
    validation = validate_scene(req.scene, course_concept_ids=_course_concept_ids())
    if not validation["ok"]:
        raise HTTPException(
            status_code=422,
            detail={"message": "scene failed validation", "errors": validation["errors"]},
        )

    env = LAItemEnvelope(
        item_id=str(uuid.uuid4()),
        course_id=req.course_id,
        target_bundle_ref=req.target_bundle_ref,
        scene=req.scene,
        author_pseudonym=_author_pseudonym(req.course_id, req.author_handle),
        created_at=req.created_at,
        review_state="submitted",
        validation=validation,
    )
    _learner_store.append_new(env)
    return _to_view(env)


@app.get("/learner-items", response_model=LearnerItemsListResponse)
def learner_list(
    course: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
) -> LearnerItemsListResponse:
    """List latest snapshots, optionally filtered by course and/or state."""
    items = _learner_store.list_items(course_id=course, state=state)  # type: ignore[arg-type]
    return LearnerItemsListResponse(items=[_to_view(e) for e in items])


@app.post("/learner-items/{item_id}/decide", response_model=LearnerItemView)
def learner_decide(item_id: str, req: LearnerDecideRequest) -> LearnerItemView:
    """Teacher decision (rule-003 chokepoint) — approve / reject / request_revision.

    Approve guards (empty reviewer / timestamp) surface as 400; an unknown item
    is 404. On approve the community bundle is emitted and the pseudonym is
    asserted-scrubbed by ``decide_item``.
    """
    if _learner_store.get_item(item_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown item {item_id!r}")
    try:
        env = decide_item(
            _learner_store,
            item_id,
            decision=req.decision,
            reviewer=req.reviewer,
            reviewed_at=req.reviewed_at,
            bundles_root=_learner_bundles_root,
            course_concepts=_COURSE_CONCEPTS,
            note_code=req.note_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _to_view(env)


__all__ = ["app"]
