import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/ingest"))

FIXTURE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../fixtures/m2/abs_capsule_minimal")
)


def _manifest_with_abs_capsule():
    return {
        "manifest_id": "m-abs-001",
        "target": "L3",
        "duration_minutes": 45,
        "language": "fr",
        "keywords": "metabolomics LC-MS",
        "corpus_refs": [
            {
                "ref_id": "abs-1",
                "ref_type": "abs_capsule",
                "abs_capsule_path": FIXTURE_PATH,
            }
        ],
        "text_preview": "LC-MS feature detection workflow.",
    }


def test_planner_agent_abs_creates_reproduction_scene():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(_manifest_with_abs_capsule(), target="L3")
    scene_types = [s.type.value for s in plan.scene_outlines]
    assert "reproduction" in scene_types


def test_planner_agent_abs_task_card_id_set():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(_manifest_with_abs_capsule(), target="L3")
    reproduction_scenes = [s for s in plan.scene_outlines if s.type.value == "reproduction"]
    assert len(reproduction_scenes) >= 1
    assert reproduction_scenes[0].abs_task_card_id == "task_001"


def test_planner_agent_abs_edam_on_objective():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(_manifest_with_abs_capsule(), target="L3")
    objectives_with_edam = [o for o in plan.learning_objectives if o.edam_operation]
    assert len(objectives_with_edam) >= 1
    assert objectives_with_edam[0].edam_operation == "http://edamontology.org/operation_3214"


def test_planner_agent_abs_prov_includes_ro_crate():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(_manifest_with_abs_capsule(), target="L3")
    assert plan.prov_derived_from is not None
    assert any("abs" in uri or "rocrate" in uri for uri in plan.prov_derived_from)


def test_planner_emits_judgment_scene_when_requested():
    """With ``emit_judgment_scenes`` on, the planner emits a capsule-grounded
    ``spot_the_flaw`` judgment outline alongside the reproduction outline — closing
    the "planner can't even request a judgment scene" gap. The outline points at the
    same task card (the composer later runs it + attaches the real reference_result)."""
    from agents.planner_agent import PlannerAgent
    manifest = {**_manifest_with_abs_capsule(), "emit_judgment_scenes": True}
    plan, _ = PlannerAgent().generate(manifest, target="L3")
    scene_types = [s.type.value for s in plan.scene_outlines]
    assert "spot_the_flaw" in scene_types
    judgment = [s for s in plan.scene_outlines if s.type.value == "spot_the_flaw"]
    assert judgment[0].abs_task_card_id == "task_001"


def test_planner_omits_judgment_scene_by_default():
    """Default OFF: existing courses keep their exact scene shape (no surprise scenes)."""
    from agents.planner_agent import PlannerAgent
    plan, _ = PlannerAgent().generate(_manifest_with_abs_capsule(), target="L3")
    assert "spot_the_flaw" not in [s.type.value for s in plan.scene_outlines]
