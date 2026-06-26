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
  - reject / request_revision record the decision but leave NO bundle.

``decide_item`` is the EXCLUSIVE surfacing path: only here does an item reach
``published`` and only here is a community bundle written. Learner endpoints can
only ever write ``submitted``.
"""
from __future__ import annotations

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

    Given the COURSE bundles root (the dir holding the immutable canonical
    ``lesson.json``), return ``<root>/community`` — exactly where the TS
    ``discoverCommunityBundles(course_bundles_root)`` scans. Pass the result as
    ``decide_item(..., bundles_root=...)`` so the emitted ``community-<id>.zip``
    is DISCOVERABLE without ever touching the canonical course.
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


def _synthesize_single_concept_plan(
    env: LAItemEnvelope,
    *,
    course_concepts: list[dict],
    reviewer: str,
) -> dict:
    """Build a minimal single-scene ``lesson_plan`` for the approved scene.

    The plan references the ONE course concept the scene's ``concept_refs`` point
    at (so ``build_bundle``'s ``concept_refs ⊆ course concepts`` gate passes), and
    seeds ``validated_by`` = the teacher IRI (rule-003 vouching). The learner
    ``author_pseudonym`` is NEVER placed in the plan — it stays in the ledger.
    """
    scene_dict = env.scene.model_dump(exclude_none=True)
    refs = set(scene_dict.get("concept_refs") or [])
    # Keep exactly the concepts the scene references (and at least one, since the
    # bundle requires a non-empty concepts list). Order-preserving.
    concepts = [c for c in course_concepts if c.get("id") in refs]
    if not concepts and course_concepts:
        concepts = [course_concepts[0]]

    lesson_id = f"community-{env.item_id}"
    return {
        "lesson_id": lesson_id,
        "plan_id": f"plan-{lesson_id}",
        "title": scene_dict.get("title", "Community item"),
        "metadata": {
            "title": scene_dict.get("title", "Community item"),
            "target": "L1",
            "duration_minutes": max(
                1, round((scene_dict.get("estimated_seconds") or 60) / 60)
            ),
            "language": "fr",
            "discipline": "general",
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
        The teacher IRI vouching for the item (required + non-empty on approve).
    reviewed_at:
        ISO-Z timestamp, PASSED IN (never ``now()``); required on approve.
    bundles_root:
        Directory the emitted community bundle ZIP is written under (approve).
    course_concepts:
        The owning course's concept dicts; the synthesized plan references the
        one(s) the scene cites so the bundle validates.
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
    if decision == "approve":
        if not reviewer:
            raise ValueError(
                "approve requires a non-empty reviewer (the teacher vouching for the item)"
            )
        if not reviewed_at:
            raise ValueError(
                "approve requires an explicit reviewed_at timestamp (deterministic; never now())"
            )

    current = store.get_item(item_id)
    if current is None:
        raise ValueError(f"unknown item {item_id!r}")

    # ---- idempotency: terminal-state items are returned unchanged --------- #
    if current.review_state in _TERMINAL:
        return current

    # ---- non-approve: record decision, leave NO bundle ------------------- #
    if decision != "approve":
        return store.transition(
            item_id,
            _NON_APPROVE_STATE[decision],
            reviewed_by=reviewer or None,
            reviewed_at=reviewed_at or None,
            review_note_code=note_code,
        )

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
        approved, course_concepts=course_concepts, reviewer=reviewer
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
    return published


def _assert_pseudonym_scrubbed(bundle_path: Path, pseudonym: str) -> None:
    """Assert ``pseudonym`` is absent from both files in the emitted bundle."""
    import zipfile

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
    "record_peer_review",
    "peer_signals_view",
    "DEFAULT_MIN_RATERS",
    "COMMUNITY_DIR",
    "community_emit_dir",
]
