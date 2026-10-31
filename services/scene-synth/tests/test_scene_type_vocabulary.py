"""The three scene-type vocabularies must not drift in silence.

Three lists name scene types and nothing compared them:

* what a plan may ASK FOR — ``lesson_plan_schema.SceneType`` (9 members);
* what scene-synth can BUILD — the agents registered in the orchestrator (7);
* what a bundle can CARRY, and therefore what the learner runtime grades —
  ``scene_synth_schemas.SceneType`` (13).

Both gaps are silent. An outline naming a type with no agent is skipped with a warning that no
caller reads (``synthesize_lesson`` returns ``warnings``; nothing treats it as an error), so the
scene disappears between the plan and the bundle while every plan-level check that counted it
still passes — that is how ``simulation`` came to be plannable, counted by the critic's
apply-level bloom check, recommended by its canned verdict, built by nothing and not even
representable in a bundle. And in the other direction, five scene types the runtime grades exist
only where a human wrote them by hand; nothing in the pipeline says so.

These tests do not forbid a gap — a gap can be a legitimate product state. They forbid an
UNDECLARED one: every type is built, or listed with a reason. A stale entry (a type declared
missing that now has an agent) fails just as loudly, so the declaration cannot rot into a lie.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
_REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO / "packages" / "lesson-plan-schema" / "python"))

from lesson_plan_schema import SceneType as PlanSceneType  # noqa: E402
from orchestrator import (  # noqa: E402
    HAND_AUTHORED_ONLY_SCENE_TYPES,
    KNOWN_UNSUPPORTED_SCENE_TYPES,
    SUPPORTED_SCENE_TYPES,
)
from scene_synth_schemas import SceneType as BundleSceneType  # noqa: E402

PLANNABLE = {m.value for m in PlanSceneType}
BUNDLEABLE = set(BundleSceneType.__args__)  # type: ignore[attr-defined]


def test_every_plannable_scene_type_is_built_or_declared_unsupported():
    undeclared = PLANNABLE - SUPPORTED_SCENE_TYPES - set(KNOWN_UNSUPPORTED_SCENE_TYPES)
    assert not undeclared, (
        f"scene types a plan can ask for that nothing builds and nothing declares: "
        f"{sorted(undeclared)}. Add an agent, or add an entry with a reason to "
        f"KNOWN_UNSUPPORTED_SCENE_TYPES — a silently skipped outline is a scene that vanishes "
        f"between the plan and the bundle."
    )


def test_every_gradeable_scene_type_is_built_or_declared_hand_authored():
    # Either table counts as a declaration: `discussion` is both plannable and gradeable, so its
    # reason lives with the other unbuildable plannable types rather than being written twice.
    undeclared = (
        BUNDLEABLE
        - SUPPORTED_SCENE_TYPES
        - set(HAND_AUTHORED_ONLY_SCENE_TYPES)
        - set(KNOWN_UNSUPPORTED_SCENE_TYPES)
    )
    assert not undeclared, (
        f"scene types the runtime grades that no agent can write and nothing declares: "
        f"{sorted(undeclared)}. Either build them, or declare them hand-authored with the reason "
        f"— the authoring path stopping short of the grading path is a fact a teacher's lesson "
        f"depends on."
    )


def test_everything_this_service_builds_can_reach_a_learner():
    """Buildable but not representable is the worst gap: work is done and then dropped."""
    unreachable = SUPPORTED_SCENE_TYPES - BUNDLEABLE
    assert not unreachable, (
        f"agents exist for {sorted(unreachable)} but the bundle vocabulary cannot carry them, so "
        f"the synthesized scene could never be played."
    )


@pytest.mark.parametrize(
    "table_name,table",
    [
        ("KNOWN_UNSUPPORTED_SCENE_TYPES", KNOWN_UNSUPPORTED_SCENE_TYPES),
        ("HAND_AUTHORED_ONLY_SCENE_TYPES", HAND_AUTHORED_ONLY_SCENE_TYPES),
    ],
)
def test_no_stale_declaration(table_name: str, table: dict[str, str]):
    stale = SUPPORTED_SCENE_TYPES & set(table)
    assert not stale, (
        f"{table_name} declares {sorted(stale)} unbuildable, but an agent now exists. Remove the "
        f"entry, so the declaration keeps meaning what it says."
    )


def test_declarations_name_real_scene_types():
    unknown_plan = set(KNOWN_UNSUPPORTED_SCENE_TYPES) - PLANNABLE
    assert not unknown_plan, (
        f"declared unsupported but not a plannable SceneType: {sorted(unknown_plan)}. That table "
        f"is about what a PLAN can ask for."
    )
    unknown_bundle = set(HAND_AUTHORED_ONLY_SCENE_TYPES) - BUNDLEABLE
    assert not unknown_bundle, (
        f"declared hand-authored but not a bundle SceneType: {sorted(unknown_bundle)}. That table "
        f"is about what the RUNTIME grades."
    )


@pytest.mark.parametrize(
    "scene_type,reason",
    sorted({**KNOWN_UNSUPPORTED_SCENE_TYPES, **HAND_AUTHORED_ONLY_SCENE_TYPES}.items()),
)
def test_each_declared_gap_carries_a_reason(scene_type: str, reason: str):
    assert isinstance(reason, str) and len(reason.strip()) >= 60, (
        f"{scene_type!r} is declared missing with no usable reason. The next person needs to know "
        f"whether this is a gap to close or a decision that was taken."
    )
