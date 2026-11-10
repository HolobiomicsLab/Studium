"""``decide_item()`` — the SOLE rule-003 publish chokepoint for learner items.

The plan's audit established that ``approve_course`` (services/planner/provenance/
approval.py) is hard-coupled to ``.lwg`` JSON-LD claim graphs and that its
``validated_by`` only enforces ``min_length=3`` (it does NOT verify a teacher
IRI). So learner-authored scenes get a DEDICATED gate here. This module mirrors
``approve_course``'s INVARIANTS — NOT its .lwg-coupled code:

  - approve requires a NON-EMPTY reviewer AND a PASSED-IN ``reviewed_at`` — both
    raised as ``ValueError`` BEFORE any mutation, so a missing identity/timestamp
    can never produce a published item (timestamps are never ``now()``);
  - re-approve / re-publish is IDEMPOTENT (a terminal-state item is returned
    unchanged, no new ledger line, original timestamp preserved);
  - the learner ``author_pseudonym`` is preserved ONLY in the ledger as
    ``prior_author`` (mirrors ``approve_course``'s ``prior_assertions``); it is
    asserted-scrubbed from BOTH ``lesson.json`` and ``prov.json`` of the emitted
    community bundle;
  - the emitted bundle inherits its course's language, target and discipline, and
    says who wrote it: ``metadata.authoring = {mode: teacher, author_is_learner:
    true, drafted_by: learner}`` (a learner drafted it, the deciding teacher validated it);
  - the emitted ZIP carries an ``approval.json`` member next to ``lesson.json``
    (``studium-approval/1``, the field names ``experience_packet.py approve`` writes for a
    teacher lesson) bound to the sha256 of the exact ``lesson.json`` member bytes, so a
    reader can tell a recorded approval from a bundle that merely names a validator;
  - every effective decision appends one line to the decision log
    (``learner_decisions.jsonl`` beside the ledger): who, when, what, which item and, on
    approve, the sha256 of the published ``lesson.json`` and of the ZIP. No credential is
    ever passed to this module, so none can reach the log;
  - the reviewer is a declared name: empty, longer than ``MAX_REVIEWER_LENGTH`` or equal to
    the item's author pseudonym is refused before any mutation, for every decision;
    on ``approve`` an identifier starting with ``urn:`` is refused too, because learners
    read that name on the published lesson;
  - reject / request_revision record the decision but leave NO bundle.

``decide_item`` is the EXCLUSIVE surfacing path: only here does an item reach
``published`` and only here is a community bundle written. Learner endpoints can
only ever write ``submitted``.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bundler import build_bundle
from learner_items_store import (
    IllegalTransitionError,
    LAItemEnvelope,
    LAPeerSignals,
    LAReviewNoteCode,
    LearnerItemsStore,
)

# A3 — emit/discover PATH reconciliation. The TS runtime's
# discoverCommunityBundles(courseRoot) (packages/lesson-session-host/src/
# community-bundles.ts) scans ``<courseRoot>/community`` for ``community-<id>.zip``.
# So the emit side must write into the SAME ``community/`` subdir of the course
# root, never into the course root itself (that would risk colliding with /
# mutating the canonical ``lesson.json``). This constant MIRRORS the TS
# ``COMMUNITY_DIR`` export; ``community_emit_dir(courseRoot)`` is the single helper
# every caller (the FastAPI app, the e2e driver) uses to hand ``decide_item`` the
# right directory, so both ends agree by construction.
COMMUNITY_DIR = "community"


def community_emit_dir(course_bundles_root: str | Path) -> Path:
    """The directory an approved community bundle is emitted into for a course.

    Given a course's directory (``<BUNDLES_ROOT>/<course_id>``, holding the
    immutable canonical ``lesson.json``), return its ``community`` subdir — exactly
    where the TS ``discoverCommunityBundles(course_bundles_root)`` scans. Pass the
    result as ``decide_item(..., bundles_root=...)`` so the emitted
    ``community-<id>.zip`` is DISCOVERABLE without ever touching the canonical course.
    """
    return Path(course_bundles_root) / COMMUNITY_DIR


# k-anonymity floor for any teacher-facing peer-signal read, mirroring
# tools/class_report.py's --min-learners: below this many ratings a per-item
# aggregate could re-identify the handful of peers who rated it.
DEFAULT_MIN_RATERS = 3

# Decisions accepted by the teacher-facing gate. Distinct from the raw ledger
# transition vocabulary: ``approve`` fans out to approved→published.
_DECISIONS = {"approve", "reject", "request_revision"}

# Terminal states for which a repeated decision is a no-op (idempotency).
_TERMINAL = {"published", "rejected", "revision_requested"}

# Decision → the ledger state a non-approve decision lands in.
_NON_APPROVE_STATE = {
    "reject": "rejected",
    "request_revision": "revision_requested",
}

# Approved item: learner-written, validated by the deciding teacher. ``drafted_by`` is
# ``learner`` because the learner wrote the scene and its answer key; a bundle without it
# would read as teacher-drafted (draftedByOf defaults a teacher-mode bundle to "teacher").
_COMMUNITY_AUTHORING = {"mode": "teacher", "author_is_learner": True, "drafted_by": "learner"}

# The approval record a community bundle carries: same schema and field names as the record
# ``tools/experience_packet.py approve`` writes next to a teacher lesson (``APPROVAL_SCHEMA``
# there), plus ``decision_route``, which says the decision came through this gate. The
# writer is not imported: experience_packet.py pulls the whole authoring CLI with it.
APPROVAL_SCHEMA = "studium-approval/1"
APPROVAL_MEMBER = "approval.json"
LESSON_MEMBER = "lesson.json"
DECISION_ROUTE = "learner-contribution"
APPROVAL_TOOL = "scene-synth decide_item 1.0"

# A declared reviewer name, not an identity check: bounded so a decision log line stays a line.
MAX_REVIEWER_LENGTH = 200

# Canonical course metadata an emitted community bundle inherits.
_INHERITED_METADATA_FIELDS = ("language", "target", "discipline")


def _synthesize_single_concept_plan(
    env: LAItemEnvelope,
    *,
    course_concepts: list[dict],
    course_metadata: Optional[dict],
) -> dict:
    """Build a minimal single-scene ``lesson_plan`` for the approved scene.

    The plan references the course concepts the scene's ``concept_refs`` point at
    (so ``build_bundle``'s ``concept_refs ⊆ course concepts`` gate passes), inherits
    the course's language, target and discipline from ``course_metadata`` (the
    bundler's defaults when it is None), and carries the community ``authoring``
    block. The learner ``author_pseudonym`` is NEVER placed in the plan — it stays
    in the ledger; ``validated_by`` comes from ``decide_item``'s prov seed.
    """
    scene_dict = env.scene.model_dump(exclude_none=True)
    refs = set(scene_dict.get("concept_refs") or [])
    # Keep exactly the concepts the scene references (and at least one, since the
    # bundle requires a non-empty concepts list). Order-preserving.
    concepts = [c for c in course_concepts if c.get("id") in refs]
    if not concepts and course_concepts:
        concepts = [course_concepts[0]]
    canonical = course_metadata or {}
    inherited = {k: canonical[k] for k in _INHERITED_METADATA_FIELDS if k in canonical}

    lesson_id = f"community-{env.item_id}"
    return {
        "lesson_id": lesson_id,
        "plan_id": f"plan-{lesson_id}",
        "title": scene_dict.get("title", "Community item"),
        "metadata": {
            "title": scene_dict.get("title", "Community item"),
            "duration_minutes": max(
                1, round((scene_dict.get("estimated_seconds") or 60) / 60)
            ),
            **inherited,
            "authoring": dict(_COMMUNITY_AUTHORING),
        },
        "concepts": concepts,
        "scenes": [scene_dict],
        "rules": [],
    }


# --------------------------------------------------------------------------- #
# P3 — peer-review loop.
#
# A peer (a DIFFERENT learner) tests a learner-authored item and rates it. The
# review is reduced to SCALARS the instant it arrives (passed / rating 1-5 /
# helpful) and folded into the ledger envelope's ``peer_signals`` aggregate. No
# per-peer identity and no free text are ever persisted; the aggregate stays
# ledger-only and is NEVER routed to telemetry. Peer testing of a ``submitted``
# item opens the ``peer_review`` state; ``decide_item`` still approves from there.
# --------------------------------------------------------------------------- #


def record_peer_review(
    store: LearnerItemsStore,
    item_id: str,
    *,
    passed: bool,
    rating: int,
    helpful: bool,
    peer_pseudonym: Optional[str] = None,
) -> LAItemEnvelope:
    """Fold ONE peer test+rating into the item's ``peer_signals`` aggregate.

    Parameters
    ----------
    passed:
        Whether the peer's self-test of the item passed (a ``test`` counts
        toward ``n_tests``).
    rating:
        Integer 1-5 quality rating (raises ``ValueError`` outside the range).
    helpful:
        Whether the peer marked the item helpful (folds into ``helpful_votes``).
    peer_pseudonym:
        Accepted for caller symmetry but DELIBERATELY DISCARDED — no per-peer
        identity is ever persisted; only the four aggregate scalars are stored.

    Returns the updated latest snapshot. The first peer review of a ``submitted``
    item opens ``peer_review``; later reviews keep that state.
    """
    if not isinstance(rating, int) or isinstance(rating, bool) or not (1 <= rating <= 5):
        raise ValueError(f"rating must be an integer in 1..5, got {rating!r}")
    # NOTE: peer_pseudonym is intentionally NOT read past here.
    del peer_pseudonym

    current = store.get_item(item_id)
    if current is None:
        raise ValueError(f"unknown item {item_id!r}")

    prior = current.peer_signals
    # Every call is one peer "test" (its outcome is ``passed``) that also supplies
    # one rating, so n_tests and n_ratings both increment by one.
    n_tests = (prior.n_tests if prior else 0) + 1
    n_ratings = (prior.n_ratings if prior else 0) + 1
    prior_sum = (prior.mean_rating * prior.n_ratings) if prior else 0.0
    mean_rating = (prior_sum + rating) / n_ratings
    helpful_votes = (prior.helpful_votes if prior else 0) + (1 if helpful else 0)

    aggregate = LAPeerSignals(
        n_tests=n_tests,
        n_ratings=n_ratings,
        mean_rating=mean_rating,
        helpful_votes=helpful_votes,
    )
    try:
        return store.update_peer_signals(item_id, aggregate)
    except IllegalTransitionError as exc:
        # surface non-peer-testable states as a plain ValueError for the caller.
        raise ValueError(str(exc)) from exc


def peer_signals_view(
    store: LearnerItemsStore,
    item_id: str,
    *,
    min_raters: int = DEFAULT_MIN_RATERS,
) -> dict:
    """Teacher-facing, K-SUPPRESSED read of an item's peer-signal aggregate.

    Mirrors tools/class_report.py: below ``min_raters`` ratings the aggregate
    scalars are WITHHELD (a tiny rater pool could re-identify the peers), and the
    view returns only ``status='suppressed'`` plus the floor and the rater count.
    At/above the floor the four aggregate scalars are returned.
    """
    current = store.get_item(item_id)
    signals = current.peer_signals if current is not None else None
    n_ratings = signals.n_ratings if signals else 0

    if signals is None or n_ratings < min_raters:
        return {
            "status": "suppressed",
            "n_ratings": n_ratings,
            "min_raters": min_raters,
            "reason": (
                f"k-anonymity floor: need >= {min_raters} peer ratings before an "
                f"item-level aggregate can be shown (have {n_ratings})."
            ),
        }
    return {
        "status": "ok",
        "n_tests": signals.n_tests,
        "n_ratings": signals.n_ratings,
        "mean_rating": round(signals.mean_rating, 3),
        "helpful_votes": signals.helpful_votes,
        "min_raters": min_raters,
    }


def decide_item(
    store: LearnerItemsStore,
    item_id: str,
    *,
    decision: str,
    reviewer: str,
    reviewed_at: str,
    bundles_root: str | Path,
    course_concepts: list[dict],
    course_metadata: Optional[dict] = None,
    note_code: Optional[LAReviewNoteCode] = None,
) -> LAItemEnvelope:
    """Teacher decision on a learner-submitted item (rule-003 chokepoint).

    Parameters
    ----------
    store:
        The append-only ledger.
    item_id:
        The item under review.
    decision:
        One of ``approve`` / ``reject`` / ``request_revision``.
    reviewer:
        The declared name of the teacher deciding (required for every decision, stripped,
        at most ``MAX_REVIEWER_LENGTH`` characters, never the item's author pseudonym).
        Authenticating the caller is the HTTP layer's job (``scene_synth_app``).
    reviewed_at:
        ISO-Z timestamp, PASSED IN (never ``now()``); required on approve.
    bundles_root:
        Directory the emitted community bundle ZIP is written under (approve).
    course_concepts:
        The owning course's concept dicts; the synthesized plan references the
        one(s) the scene cites so the bundle validates.
    course_metadata:
        The owning course's canonical ``metadata``; the emitted bundle inherits
        its ``language``, ``target`` and ``discipline`` (bundler defaults if None).
    note_code:
        Optional review note enum recorded on the envelope.

    Returns
    -------
    LAItemEnvelope
        The latest snapshot after the decision (idempotent on terminal states).
    """
    # ---- guards BEFORE any mutation -------------------------------------- #
    if decision not in _DECISIONS:
        raise ValueError(
            f"decision must be one of {sorted(_DECISIONS)}, got {decision!r}"
        )
    reviewer = (reviewer or "").strip()
    if not reviewer:
        raise ValueError(
            f"{decision} requires a non-empty reviewer (the teacher deciding on the item)"
        )
    if len(reviewer) > MAX_REVIEWER_LENGTH:
        raise ValueError(
            f"reviewer must be at most {MAX_REVIEWER_LENGTH} characters, got {len(reviewer)}"
        )
    if decision == "approve":
        # Learners read the reviewer of a published contribution: an identifier is not a person.
        if reviewer.lower().startswith("urn:"):
            raise ValueError(
                "approve needs the reviewer's name, not an identifier (urn:…): a published contribution names a person"
            )
        if not reviewed_at:
            raise ValueError(
                "approve requires an explicit reviewed_at timestamp (deterministic; never now())"
            )

    current = store.get_item(item_id)
    if current is None:
        raise ValueError(f"unknown item {item_id!r}")
    if reviewer == current.author_pseudonym:
        raise ValueError("the reviewer cannot be the item's author: a learner never decides on their own item")

    # ---- idempotency: terminal-state items are returned unchanged --------- #
    if current.review_state in _TERMINAL:
        return current

    # ---- non-approve: record decision, leave NO bundle ------------------- #
    if decision != "approve":
        decided = store.transition(
            item_id,
            _NON_APPROVE_STATE[decision],
            reviewed_by=reviewer,
            reviewed_at=reviewed_at or None,
            review_note_code=note_code,
        )
        _log_decision(store, decided, decision=decision, reviewer=reviewer, reviewed_at=reviewed_at)
        return decided

    # ---- approve: submitted/peer_review -> approved -> published ---------- #
    # RESUMABLE: the approve fan-out (transition->approved, build, scrub, publish)
    # is not a single atomic step. If a prior approve moved the item to 'approved'
    # but the bundle emit/scrub failed, the item is stranded ('approved' is not
    # terminal, and approved->approved is illegal), so a repeat approve must RESUME
    # from the existing 'approved' snapshot rather than re-transition.
    # prior_author preserves the learner pseudonym in the LEDGER only (mirrors
    # approve_course's prior_assertions).
    if current.review_state == "approved":
        approved = current
    else:
        approved = store.transition(
            item_id,
            "approved",
            reviewed_by=reviewer,
            reviewed_at=reviewed_at,
            review_note_code=note_code,
            prior_author=current.author_pseudonym,
        )

    # Synthesize a minimal single-concept plan and emit the community bundle.
    plan = _synthesize_single_concept_plan(
        approved, course_concepts=course_concepts, course_metadata=course_metadata
    )
    bundles_root = Path(bundles_root)
    bundles_root.mkdir(parents=True, exist_ok=True)
    output_path = bundles_root / f"{plan['lesson_id']}.zip"
    # Build into a hidden TEMP path, verify the pseudonym is scrubbed, and only
    # then atomically move it into the discovery root — so a failed scrub (or a
    # crash mid-emit) never leaves a leaking/partial artifact where the runtime
    # would discover it. The item stays resumably 'approved' until publish.
    tmp_path = bundles_root / f".{plan['lesson_id']}.tmp.zip"
    prov_seed = {
        "agent": "studium-learner-as-author",
        "version": "0.1.0",
        # validated_by = the teacher IRI (rule-003 vouching), NOT the learner.
        "validator": reviewer,
    }
    try:
        build_bundle(plan, [approved.scene], tmp_path, prov_seed)
        # PRIVACY assertion: the learner pseudonym must appear in NEITHER
        # lesson.json NOR prov.json of the distributed bundle — checked on the
        # temp file BEFORE it is moved into the discovery root.
        _assert_pseudonym_scrubbed(tmp_path, approved.author_pseudonym)
        # The record goes in before the move too: a bundle is never discoverable without it.
        lesson_sha256 = _add_approval_record(
            tmp_path, reviewer=approved.reviewed_by or reviewer,
            reviewed_at=approved.reviewed_at or reviewed_at,
        )
        tmp_path.replace(output_path)  # atomic rename within the same dir
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    bundle_uri = output_path.resolve().as_uri()

    published = store.transition(
        item_id,
        "published",
        published_bundle_ref=bundle_uri,
    )
    _log_decision(
        store, published, decision=decision,
        reviewer=approved.reviewed_by or reviewer,
        reviewed_at=approved.reviewed_at or reviewed_at,
        lesson_sha256=lesson_sha256,
        bundle_zip_sha256=hashlib.sha256(output_path.read_bytes()).hexdigest(),
    )
    return published


def approval_record(*, lesson_bytes: bytes, reviewer: str, reviewed_at: str) -> dict:
    """The ``approval.json`` of a community bundle, bound to these exact ``lesson.json`` bytes."""
    return {
        "schema": APPROVAL_SCHEMA,
        "bundle_sha256": hashlib.sha256(lesson_bytes).hexdigest(),
        "reviewer": reviewer,
        "reviewed_at": reviewed_at,
        "tool": APPROVAL_TOOL,
        "decision_route": DECISION_ROUTE,
    }


def _add_approval_record(bundle_path: Path, *, reviewer: str, reviewed_at: str) -> str:
    """Append ``approval.json`` to the ZIP, hashing the ``lesson.json`` member as written.

    Returns the sha256 of that member. The member is read back from the archive rather than
    recomputed, so the hash is of the bytes a reader will load.
    """
    with zipfile.ZipFile(bundle_path) as zf:
        lesson_bytes = zf.read(LESSON_MEMBER)
        if APPROVAL_MEMBER in zf.namelist():
            raise AssertionError(f"{bundle_path.name!r} already holds an {APPROVAL_MEMBER}")
    record = approval_record(lesson_bytes=lesson_bytes, reviewer=reviewer, reviewed_at=reviewed_at)
    with zipfile.ZipFile(bundle_path, "a", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(APPROVAL_MEMBER, json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    return record["bundle_sha256"]


def decision_log_path(store: LearnerItemsStore) -> Path:
    """The append-only decision log kept beside the ledger."""
    return store.path.with_name("learner_decisions.jsonl")


def _log_decision(
    store: LearnerItemsStore,
    env: LAItemEnvelope,
    *,
    decision: str,
    reviewer: str,
    reviewed_at: str,
    lesson_sha256: Optional[str] = None,
    bundle_zip_sha256: Optional[str] = None,
) -> None:
    """Append one line: who decided, when, what, on which item, and what was published.

    ``reviewed_at`` is the time the reviewer declared; ``recorded_at`` is the server clock
    when the line was written. Only the arguments listed here reach the line.
    """
    line = {
        "item_id": env.item_id,
        "course_id": env.course_id,
        "decision": decision,
        "review_state": env.review_state,
        "reviewer": reviewer,
        "reviewed_at": reviewed_at,
        "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "decision_route": DECISION_ROUTE,
    }
    if env.review_note_code:
        line["review_note_code"] = env.review_note_code
    if lesson_sha256:
        line["lesson_sha256"] = lesson_sha256
        line["bundle_zip_sha256"] = bundle_zip_sha256
        line["published_bundle_ref"] = env.published_bundle_ref
    path = decision_log_path(store)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")


def _assert_pseudonym_scrubbed(bundle_path: Path, pseudonym: str) -> None:
    """Assert ``pseudonym`` is absent from both files in the emitted bundle."""
    with zipfile.ZipFile(bundle_path) as zf:
        for name in ("lesson.json", "prov.json"):
            content = zf.read(name).decode("utf-8")
            if pseudonym and pseudonym in content:
                raise AssertionError(
                    f"author_pseudonym leaked into {name} of the community bundle "
                    f"{bundle_path.name!r}"
                )


__all__ = [
    "decide_item",
    "approval_record",
    "decision_log_path",
    "APPROVAL_SCHEMA",
    "APPROVAL_MEMBER",
    "DECISION_ROUTE",
    "MAX_REVIEWER_LENGTH",
    "record_peer_review",
    "peer_signals_view",
    "DEFAULT_MIN_RATERS",
    "COMMUNITY_DIR",
    "community_emit_dir",
]
