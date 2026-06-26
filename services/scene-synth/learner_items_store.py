"""Append-only JSONL ledger for the "learner-as-author" LAItem (plan §"Data model").

The learner authors EXACTLY ONE schema-pure ``Scene`` (a verbatim member of the
``scene_synth_schemas.Scene`` discriminated union — the SAME contract the bundler
validates), wrapped in a thin ``LAItemEnvelope`` that carries ALL
authoring/governance/peer metadata OUTSIDE the scene body.

Storage: an append-only ``learner_items.jsonl`` per course. Each line is the
LATEST snapshot for an ``item_id`` at write time; the full history is replayable
by reading every line in order, and the current state is the last line seen per
``item_id``. This parallels the ``approval.json`` sidecar.

Forward-only transition table (illegal transitions raise):
    submitted          -> {peer_review, approved, rejected, revision_requested}
    peer_review        -> {approved, rejected, revision_requested}
    revision_requested -> {}        (a revision is a NEW item_id, not in-place)
    approved           -> {published}
    published          -> {}
    rejected           -> {}

PRIVACY: ``author_pseudonym`` is an HMAC, SERVER-ONLY — it lives only here in the
ledger and MUST NEVER be written into any distributed bundle. ``peer_signals``
(reserved, P3) are ledger-only scalars/enums, k-suppressed in any view, never
routed to telemetry. Free text never goes to telemetry.

Pydantic mirror of packages/lesson-bundle-schema/src/learner-item.ts +
packages/.../python/lesson_bundle_schema/__init__.py (dual-path, rule 002). The
``Scene`` type is bound to the LOCAL ``scene_synth_schemas`` so envelope
validation is byte-for-byte the bundler's scene contract.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from scene_synth_schemas import Scene


def _require_iso8601(value: str) -> str:
    """Parity with the Zod mirror's z.string().datetime(): reject non-ISO timestamps."""
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value

# ---------------------------------------------------------------------------
# Lifecycle types
# ---------------------------------------------------------------------------

LAReviewState = Literal[
    "submitted",
    "peer_review",
    "revision_requested",
    "approved",
    "published",
    "rejected",
]

LAReviewNoteCode = Literal[
    "factual_error",
    "ambiguous_distractor",
    "off_topic",
    "ok",
]

# Forward-only transition table. The authoritative copy of the lifecycle; the
# Zod mirror (LA_LEGAL_TRANSITIONS) keeps a frozen, list-valued copy for TS.
LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"peer_review", "approved", "rejected", "revision_requested"},
    "peer_review": {"approved", "rejected", "revision_requested"},
    "revision_requested": set(),
    "approved": {"published"},
    "published": set(),
    "rejected": set(),
}


def transition_allowed(frm: str, to: str) -> bool:
    """True iff ``frm -> to`` is a legal forward-only transition."""
    return to in LEGAL_TRANSITIONS.get(frm, set())


class IllegalTransitionError(ValueError):
    """Raised when an LAItem is moved along an edge not in ``LEGAL_TRANSITIONS``."""


# ---------------------------------------------------------------------------
# Envelope (Pydantic mirror — keep in parity with the Zod/package definitions)
# ---------------------------------------------------------------------------

class LAValidation(BaseModel):
    ok: bool
    validator_version: str = Field(min_length=1)
    errors: list[str] = Field(default_factory=list)


class LAPeerSignals(BaseModel):
    """RESERVED for the P3 peer-review loop. Ledger-only; k-suppressed in views."""

    n_tests: int = Field(ge=0)
    n_ratings: int = Field(ge=0)
    mean_rating: float
    helpful_votes: int = Field(ge=0)


class LAItemEnvelope(BaseModel):
    item_id: str = Field(min_length=1)
    course_id: str = Field(min_length=1)
    target_bundle_ref: str = Field(min_length=1)
    schema_version: Literal["1.4"] = "1.4"
    # SCHEMA-PURE: a verbatim member of the Scene discriminated union.
    scene: Scene
    # HMAC, SERVER-ONLY — NEVER distributed in any emitted bundle.
    author_pseudonym: str = Field(min_length=1)
    prior_author: Optional[str] = None
    created_at: str = Field(min_length=1)  # ISO-Z, passed-in (never now())
    review_state: LAReviewState
    reviewed_by: Optional[str] = None  # teacher IRI
    reviewed_at: Optional[str] = None  # ISO-Z, passed-in
    review_note_code: Optional[LAReviewNoteCode] = None
    validation: LAValidation
    peer_signals: Optional[LAPeerSignals] = None  # RESERVED (P3); ledger-only
    published_bundle_ref: Optional[str] = None  # file:// of emitted community bundle

    @field_validator("created_at")
    @classmethod
    def _created_at_iso(cls, v: str) -> str:
        return _require_iso8601(v)

    @field_validator("reviewed_at")
    @classmethod
    def _reviewed_at_iso(cls, v: Optional[str]) -> Optional[str]:
        return _require_iso8601(v) if v is not None else v


# ---------------------------------------------------------------------------
# Append-only ledger
# ---------------------------------------------------------------------------

class LearnerItemsStore:
    """Append-only JSONL ledger keyed by ``item_id`` (latest snapshot wins).

    Construction replays any existing file so the in-memory latest-snapshot map
    is consistent with disk. Every mutation appends exactly one JSONL line; the
    file is never rewritten in place (the history stays intact).
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._latest: dict[str, LAItemEnvelope] = {}
        if self.path.exists():
            self._replay()

    # -- internal -----------------------------------------------------------

    def _replay(self) -> None:
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            env = LAItemEnvelope.model_validate(json.loads(line))
            self._latest[env.item_id] = env

    def _append_line(self, env: LAItemEnvelope) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(env.model_dump(exclude_none=True), ensure_ascii=False)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        self._latest[env.item_id] = env

    # -- public API ---------------------------------------------------------

    def append_new(self, env: LAItemEnvelope) -> LAItemEnvelope:
        """Stage a brand-new item. The FIRST state MUST be ``submitted``.

        Learner endpoints can only ever create ``submitted`` items; every later
        state is reachable only through ``transition()`` (the teacher path).
        """
        if env.item_id in self._latest:
            raise IllegalTransitionError(
                f"item {env.item_id!r} already exists; use transition()"
            )
        if env.review_state != "submitted":
            raise IllegalTransitionError(
                f"new item must start as 'submitted', got {env.review_state!r}"
            )
        self._append_line(env)
        return env

    def transition(
        self,
        item_id: str,
        to_state: LAReviewState,
        *,
        reviewed_by: Optional[str] = None,
        reviewed_at: Optional[str] = None,
        review_note_code: Optional[LAReviewNoteCode] = None,
        prior_author: Optional[str] = None,
        published_bundle_ref: Optional[str] = None,
        peer_signals: Optional[LAPeerSignals] = None,
    ) -> LAItemEnvelope:
        """Append a new snapshot moving ``item_id`` to ``to_state``.

        Raises ``IllegalTransitionError`` if the item is unknown or the edge is
        not in ``LEGAL_TRANSITIONS``. Carries forward all prior fields, applying
        only the explicitly-passed overrides.
        """
        current = self._latest.get(item_id)
        if current is None:
            raise IllegalTransitionError(f"unknown item {item_id!r}")
        if not transition_allowed(current.review_state, to_state):
            raise IllegalTransitionError(
                f"illegal transition {current.review_state!r} -> {to_state!r} "
                f"for item {item_id!r}"
            )

        data = current.model_dump(exclude_none=True)
        data["review_state"] = to_state
        if reviewed_by is not None:
            data["reviewed_by"] = reviewed_by
        if reviewed_at is not None:
            data["reviewed_at"] = reviewed_at
        if review_note_code is not None:
            data["review_note_code"] = review_note_code
        if prior_author is not None:
            data["prior_author"] = prior_author
        if published_bundle_ref is not None:
            data["published_bundle_ref"] = published_bundle_ref
        if peer_signals is not None:
            data["peer_signals"] = peer_signals.model_dump()

        new_env = LAItemEnvelope.model_validate(data)
        self._append_line(new_env)
        return new_env

    def get_item(self, item_id: str) -> Optional[LAItemEnvelope]:
        """Latest snapshot for ``item_id`` (or ``None``)."""
        return self._latest.get(item_id)

    def latest_snapshots(self) -> dict[str, LAItemEnvelope]:
        """Map of ``item_id -> latest snapshot`` (a shallow copy)."""
        return dict(self._latest)

    def list_items(
        self,
        *,
        course_id: Optional[str] = None,
        state: Optional[LAReviewState] = None,
    ) -> list[LAItemEnvelope]:
        """Latest snapshots filtered by course and/or state."""
        out = []
        for env in self._latest.values():
            if course_id is not None and env.course_id != course_id:
                continue
            if state is not None and env.review_state != state:
                continue
            out.append(env)
        return out


__all__ = [
    "LAItemEnvelope",
    "LAValidation",
    "LAPeerSignals",
    "LAReviewState",
    "LAReviewNoteCode",
    "LearnerItemsStore",
    "LEGAL_TRANSITIONS",
    "transition_allowed",
    "IllegalTransitionError",
]
