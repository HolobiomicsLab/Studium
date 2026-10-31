"""A plan whose 'apply' coverage cannot survive synthesis must say so while it is still a plan.

The critic accepts `simulation` OR `reproduction` as evidence that a high-Bloom objective has a
scene. Only `reproduction` can actually be built: scene-synth has no `simulation` agent, and the
bundle vocabulary has no `simulation` member either — so an outline naming it is skipped with a
warning no caller reads, and the plan that passed the check ships an apply-level objective with no
scene behind it. The check was true about the plan and misleading about the lesson.

These tests pin two things: the warning fires exactly when the coverage is unbuildable, and the
planner's list of unbuildable types cannot drift away from scene-synth's declaration of what it
cannot build. The drift guard is the reason it is safe to name `simulation` in two services: the
production code does not import across the service boundary (the `sys.path` segregation in
CLAUDE.md is deliberate), but this test does, and it fails the day the two disagree.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))


def _plan(apply_scene_types):
    from lesson_plan_schema import (
        BloomLevel,
        LearningObjective,
        LessonPlan,
        SceneOutline,
        SceneType,
    )

    scenes = [SceneOutline(id="sc-1", type=SceneType.concept, title="Concept", objective_refs=["obj-1"])]
    for i, t in enumerate(apply_scene_types):
        scenes.append(SceneOutline(id=f"sc-a{i}", type=t, title=t.value, objective_refs=["obj-2"]))
    return LessonPlan(
        schema_version="1.0",
        id="plan-buildability",
        title="Couverture apply",
        language="fr",
        target="L1",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Comprendre", bloom_level=BloomLevel.understand),
            LearningObjective(id="obj-2", description="Appliquer", bloom_level=BloomLevel.apply),
        ],
        scene_outlines=scenes,
    )


def _review(plan):
    from agents.critic_agent import CriticAgent

    return CriticAgent().review(plan)


def _abandon_warnings(result):
    return [w for w in result.ontology_warnings if "abandonnées à la synthèse" in w]


def test_simulation_only_coverage_is_flagged_while_the_plan_can_still_change():
    from lesson_plan_schema import SceneType

    result = _review(_plan([SceneType.simulation]))
    # the plan IS internally coherent — the warning is about what synthesis will do to it
    assert result.bloom_consistency is True
    warned = _abandon_warnings(result)
    assert len(warned) == 1, result.ontology_warnings
    assert "simulation" in warned[0]
    assert "reproduction" in warned[0], "the warning must name the buildable alternative"


def test_reproduction_coverage_is_not_flagged():
    from lesson_plan_schema import SceneType

    result = _review(_plan([SceneType.reproduction]))
    assert result.bloom_consistency is True
    assert _abandon_warnings(result) == []


def test_a_buildable_scene_alongside_an_unbuildable_one_is_enough():
    from lesson_plan_schema import SceneType

    result = _review(_plan([SceneType.simulation, SceneType.reproduction]))
    assert _abandon_warnings(result) == [], "reproduction still reaches the learner"


def test_no_apply_scene_at_all_keeps_the_original_verdict():
    """The pre-existing failure mode is untouched: no covering scene is still inconsistent."""
    result = _review(_plan([]))
    assert result.bloom_consistency is False
    assert any("aucune scène" in w for w in result.ontology_warnings)
    assert _abandon_warnings(result) == [], "one warning for one problem, not two"


def _scene_synth_vocabulary():
    """Read scene-synth's declaration in a SUBPROCESS.

    Both services own a top-level package called `agents`; importing scene-synth's orchestrator
    into a planner test process makes `agents.critic_agent` and `agents.ai_critique_agent` fight
    over the same module name — the very collision `tools/pytest_all.py` exists to avoid. A
    subprocess gets a clean `sys.path` and hands back plain JSON.
    """
    import json
    import subprocess

    scene_synth = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../scene-synth"))
    code = (
        "import json, sys; sys.path.insert(0, %r); import orchestrator as o; "
        "print(json.dumps({'supported': sorted(o.SUPPORTED_SCENE_TYPES), "
        "'unsupported': sorted(o.KNOWN_UNSUPPORTED_SCENE_TYPES)}))" % scene_synth
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_the_unbuildable_list_matches_what_scene_synth_declares_it_cannot_build():
    """The two services must not drift: this is the only place they are compared."""
    vocab = _scene_synth_vocabulary()
    SUPPORTED_SCENE_TYPES = set(vocab["supported"])
    KNOWN_UNSUPPORTED_SCENE_TYPES = set(vocab["unsupported"])

    from agents.critic_agent import _APPLY_SCENE_TYPES, _UNBUILDABLE_APPLY_SCENE_TYPES

    declared = {t for t in _APPLY_SCENE_TYPES if t.value not in SUPPORTED_SCENE_TYPES}
    assert _UNBUILDABLE_APPLY_SCENE_TYPES == declared, (
        f"the critic thinks {sorted(t.value for t in _UNBUILDABLE_APPLY_SCENE_TYPES)} cannot be "
        f"built; scene-synth's agents say {sorted(t.value for t in declared)}. Whichever moved, "
        f"the other has to follow — otherwise the plan-time warning lies in one direction or the "
        f"other."
    )
    # and the gap is a declared decision on the scene-synth side, not an accident
    for t in _UNBUILDABLE_APPLY_SCENE_TYPES:
        assert t.value in KNOWN_UNSUPPORTED_SCENE_TYPES, (
            f"{t.value!r} is unbuildable but scene-synth does not declare why."
        )
