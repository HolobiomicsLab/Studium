"""Legacy/research FastAPI app for the scene-synth service (A.7).

Exposes:
- ``GET  /health`` — liveness probe.
- ``POST /scenes/synthesize`` — orchestrates the registered SceneAgents and
  returns a ``LessonBundle`` ZIP URI.
- ``POST /scenes/critique-eval`` — scores a student critique against a
  set of claims + rubric (anti-offloading; cf. ADR 001/004).

Singletons ``_orchestrator`` and ``_critique_evaluator`` are module-level
so tests or a research host can inject them. No default orchestrator factory
exists: both start as ``None``, and their endpoints return HTTP 503 until an
explicit integration configures them.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from agents.base import SceneSynthError
from agents.critique_evaluator import CritiqueEvaluator
from bundler import validate_scene
from learner_items_store import LAItemEnvelope, LearnerItemsStore
from learner_review import (
    community_emit_dir,
    decide_item,
    peer_signals_view,
    record_peer_review,
)
from orchestrator import SceneSynthOrchestrator
from scene_synth_schemas import (
    CritiqueEvalRequest,
    CritiqueEvalResponse,
    LearnerDecideRequest,
    LearnerItemView,
    LearnerItemsListResponse,
    LearnerPeerReviewRequest,
    LearnerPeerSignalsView,
    LearnerSubmitRequest,
    LearnerValidateRequest,
    LearnerValidateResponse,
    LessonBundle,
    SynthesizeRequest,
    SynthesizeResponse,
)


app = FastAPI(title="scene-synth", version="0.1.0")

# The teacher's decision route. It is never reachable from a browser: no CORS grant,
# any request carrying an Origin header is refused, and it needs the review token.
_DECIDE_PATH = re.compile(r"/learner-items/[^/]+/decide/?")


class _CORSExceptDecisions(CORSMiddleware):
    """CORS for the learner UI, never for the decision route (no preflight grant, no header)."""

    async def __call__(self, scope, receive, send):  # type: ignore[override]
        if scope["type"] == "http" and _DECIDE_PATH.fullmatch(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# CORS for the browser-driven learner-as-author UI: author-web (:3000), the learner
# authoring form (validate + submit). The teacher dashboard (:3001) calls scene-synth from
# its server only (it holds STUDIUM_REVIEW_TOKEN there), so its origin is not listed.
app.add_middleware(
    _CORSExceptDecisions,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# The teacher credential for decisions on learner items: an environment variable of at
# least 32 characters, distinct from any course identifier, shared only with the teacher
# dashboard's server. Read per request; never logged, never echoed in a response.
REVIEW_TOKEN_ENV = "STUDIUM_REVIEW_TOKEN"
REVIEW_TOKEN_MIN_LENGTH = 32


def _require_review_token(
    authorization: Optional[str] = Header(default=None),
    origin: Optional[str] = Header(default=None),
) -> None:
    """Fail closed: no configured token, a browser origin, or a wrong token refuses the call."""
    configured = os.environ.get(REVIEW_TOKEN_ENV, "")
    if len(configured) < REVIEW_TOKEN_MIN_LENGTH:
        raise HTTPException(
            status_code=503,
            detail=f"decisions are disabled: set {REVIEW_TOKEN_ENV} (at least "
            f"{REVIEW_TOKEN_MIN_LENGTH} characters) on scene-synth and on the teacher dashboard",
        )
    if origin is not None:
        raise HTTPException(
            status_code=403,
            detail="decisions are not accepted from a browser; use the teacher dashboard",
        )
    scheme, _, presented = (authorization or "").partition(" ")
    # Both sides hashed first so compare_digest sees equal lengths whatever was sent.
    expected = hashlib.sha256(configured.encode("utf-8")).digest()
    received = hashlib.sha256(presented.strip().encode("utf-8")).digest()
    if scheme.lower() != "bearer" or not hmac.compare_digest(received, expected):
        raise HTTPException(status_code=401, detail="a valid teacher review token is required")


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

# Course bundles (A3 emit/discover reconciliation, V15 naming). BUNDLES_ROOT holds
# one directory per course, each with its canonical, immutable ``lesson.json``. An
# approved community bundle lands in ``<root>/<course_id>/community``, where the TS
# discoverCommunityBundles(<root>/<course_id>) scans, so a decide on the running
# server is discoverable by a live runtime rooted at that course without ever
# mutating the canonical course. COMMUNITY_BUNDLES_ROOT, when set, replaces
# BUNDLES_ROOT for emission only (same ``<course_id>/community`` join). Both are
# read per request, so tests and deployments only set the environment.
_DEFAULT_BUNDLES_ROOT = Path(__file__).resolve().parents[2] / "fixtures"
_CANONICAL_BUNDLE = "lesson.json"
# One directory name under BUNDLES_ROOT: no separator can slip in.
_COURSE_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")


def _bundles_root() -> Path:
    """The root holding one ``<course_id>/lesson.json`` per course (env ``BUNDLES_ROOT``)."""
    return Path(os.environ.get("BUNDLES_ROOT") or _DEFAULT_BUNDLES_ROOT)


def _course_emit_dir(course_id: str) -> Path:
    """Where the approved community bundles of ``course_id`` are written.

    ``<root>/<course_id>/community``, root being ``COMMUNITY_BUNDLES_ROOT`` when it
    is set and ``BUNDLES_ROOT`` otherwise.
    """
    root = os.environ.get("COMMUNITY_BUNDLES_ROOT") or _bundles_root()
    return community_emit_dir(Path(root) / course_id)


def _load_course(course_id: str) -> LessonBundle:
    """Parse the canonical bundle of ``course_id``; its concepts gate the learner items.

    Raises HTTP 400 when ``course_id`` is not a course id (which also forbids path
    traversal) and HTTP 404 when ``<BUNDLES_ROOT>/<course_id>/lesson.json`` is missing
    or is not a valid ``LessonBundle``.
    """
    if not _COURSE_ID.fullmatch(course_id):
        raise HTTPException(
            status_code=400,
            detail=f"course_id {course_id!r} must match {_COURSE_ID.pattern}",
        )
    location = f"{course_id}/{_CANONICAL_BUNDLE}"
    path = _bundles_root() / course_id / _CANONICAL_BUNDLE
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"unknown course {course_id!r}: no {location} under BUNDLES_ROOT",
        )
    try:
        return LessonBundle.model_validate_json(path.read_bytes())
    except ValidationError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"course {course_id!r}: {location} is not a valid LessonBundle "
            f"({exc.error_count()} validation errors)",
        ) from exc


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


@app.post("/scenes/critique-eval", response_model=CritiqueEvalResponse, response_model_exclude_none=True)
def critique_eval(req: CritiqueEvalRequest) -> CritiqueEvalResponse:
    if _critique_evaluator is None:
        raise HTTPException(
            status_code=503, detail="critique evaluator not configured"
        )
    try:
        result = _critique_evaluator.evaluate(
            claims=[c.model_dump() for c in req.claims],
            rubric=req.rubric.model_dump(),
            student_critique=req.student_critique,
        )
    except ValueError as e:
        # the judge's reply was unusable (not JSON, bad score, malformed covered_ids): a failed
        # upstream call, not a server bug. The TS adapter degrades to its keyword scorer on non-2xx.
        raise HTTPException(status_code=502, detail=f"critique judge reply unusable: {e}")
    return CritiqueEvalResponse(
        score=result.score,
        feedback=result.feedback,
        covered_ids=result.covered_ids,
    )


# --------------------------------------------------------------------------- #
# Learner-as-author endpoints (plan §"P2").
# --------------------------------------------------------------------------- #


@app.post("/learner-items/validate", response_model=LearnerValidateResponse)
def learner_validate(req: LearnerValidateRequest) -> LearnerValidateResponse:
    """Validate ONE scene (validate-only, no write) via the pure ``validate_scene``.

    The scene may cite only concepts of its course's canonical bundle; an unusable
    course id or bundle is 400 / 404 (see ``_load_course``).
    """
    course = _load_course(req.course_id)
    result = validate_scene(req.scene, course_concept_ids=[c.id for c in course.concepts])
    return LearnerValidateResponse(**result)


@app.post("/learner-items", response_model=LearnerItemView, status_code=201)
def learner_submit(req: LearnerSubmitRequest) -> LearnerItemView:
    """Stage a learner-authored scene as ``review_state='submitted'``.

    Learner endpoints can ONLY ever write ``submitted``; surfacing happens
    EXCLUSIVELY through ``decide_item`` (the rule-003 gate). A failing scene is
    rejected (422) and nothing is staged. The HMAC ``author_pseudonym`` is
    computed server-side and is NEVER returned in the response. An unusable course
    id or canonical bundle is 400 / 404 (see ``_load_course``).
    """
    course = _load_course(req.course_id)
    validation = validate_scene(req.scene, course_concept_ids=[c.id for c in course.concepts])
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


@app.post(
    "/learner-items/{item_id}/decide",
    response_model=LearnerItemView,
    dependencies=[Depends(_require_review_token)],
)
def learner_decide(item_id: str, req: LearnerDecideRequest) -> LearnerItemView:
    """Teacher decision (rule-003 chokepoint) — approve / reject / request_revision.

    Authenticated first (``_require_review_token``): 503 when no review token is
    configured, 403 from a browser origin, 401 without the right bearer token, all
    before the item is even looked up. Reviewer guards (empty, too long, the item's
    author) and a missing approve timestamp surface as 400; an unknown item is 404,
    and so is an item whose course has no usable canonical bundle. On approve the
    community bundle, with its ``approval.json`` record, is emitted into
    ``_course_emit_dir`` with the course's metadata, and the pseudonym is
    asserted-scrubbed by ``decide_item``.
    """
    current = _learner_store.get_item(item_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"unknown item {item_id!r}")
    # The learner's own handle as reviewer maps to the item's pseudonym: a self-review.
    if _author_pseudonym(current.course_id, (req.reviewer or "").strip()) == current.author_pseudonym:
        raise HTTPException(
            status_code=400,
            detail="the reviewer cannot be the item's author: a learner never decides on their own item",
        )
    course = _load_course(current.course_id)
    try:
        env = decide_item(
            _learner_store,
            item_id,
            decision=req.decision,
            reviewer=req.reviewer,
            reviewed_at=req.reviewed_at,
            bundles_root=_course_emit_dir(current.course_id),
            course_concepts=[c.model_dump() for c in course.concepts],
            course_metadata=course.metadata.model_dump(),
            note_code=req.note_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _to_view(env)


# --------------------------------------------------------------------------- #
# Learner-as-author peer-review loop (plan §"P3").
# --------------------------------------------------------------------------- #


@app.post("/learner-items/{item_id}/peer-review", response_model=LearnerItemView)
def learner_peer_review(
    item_id: str, req: LearnerPeerReviewRequest
) -> LearnerItemView:
    """Record ONE peer test+rating (scalars only) into the item's aggregate.

    The body carries NO free text and NO peer identity (``extra='forbid'``); only
    passed / rating / helpful. The aggregate lives in the ledger envelope's
    ``peer_signals`` and is NEVER routed to telemetry. A first review of a
    ``submitted`` item opens ``peer_review``; a non-peer-testable item is 400, an
    unknown item is 404.
    """
    if _learner_store.get_item(item_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown item {item_id!r}")
    try:
        env = record_peer_review(
            _learner_store,
            item_id,
            passed=req.passed,
            rating=req.rating,
            helpful=req.helpful,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _to_view(env)


@app.get(
    "/learner-items/{item_id}/peer-signals", response_model=LearnerPeerSignalsView
)
def learner_peer_signals(item_id: str) -> LearnerPeerSignalsView:
    """K-suppressed teacher read of an item's peer-signal aggregate.

    Returns ``status='suppressed'`` (count + floor only) below the min-raters
    floor (mirroring tools/class_report.py k-anonymity); the four aggregate
    scalars otherwise. An unknown item is 404.
    """
    if _learner_store.get_item(item_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown item {item_id!r}")
    view = peer_signals_view(_learner_store, item_id)
    return LearnerPeerSignalsView(**view)


__all__ = ["app"]
