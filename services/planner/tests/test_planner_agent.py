import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))


SAMPLE_MANIFEST = {
    "manifest_id": "m-001",
    "target": "L3",
    "duration_minutes": 45,
    "language": "fr",
    "keywords": "metabolomics",
    "corpus_refs": [
        {"ref_id": "ref-1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}
    ],
    "text_preview": "Metabolomics is the study of metabolites.",
}


def test_planner_agent_returns_lesson_plan():
    from agents.planner_agent import PlannerAgent
    from lesson_plan_schema import LessonPlan
    agent = PlannerAgent()
    plan, audit = agent.generate(SAMPLE_MANIFEST, target="L3")
    assert isinstance(plan, LessonPlan)
    assert plan.target == "L3"
    assert len(plan.learning_objectives) >= 1
    assert len(plan.scene_outlines) >= 1


def test_planner_agent_populates_prov_entity_uri():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(SAMPLE_MANIFEST, target="L3")
    assert plan.prov_entity_uri is not None
    assert plan.prov_entity_uri.startswith("urn:studium:plan:")


def test_planner_agent_populates_prov_generated_by():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(SAMPLE_MANIFEST, target="L3")
    assert plan.prov_generated_by is not None
    assert "planner" in plan.prov_generated_by


def test_planner_agent_populates_bloom_uri():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    plan, _ = agent.generate(SAMPLE_MANIFEST, target="L3")
    for obj in plan.learning_objectives:
        assert obj.bloom_uri is not None
        assert obj.bloom_uri.startswith("urn:studium:bloom:")


def test_planner_agent_audit_trace():
    from agents.planner_agent import PlannerAgent
    agent = PlannerAgent()
    _, audit = agent.generate(SAMPLE_MANIFEST, target="L3")
    assert audit["status"] == "ok"
    assert "provider" in audit
    assert "alias" in audit
    assert "latency_s" in audit


def test_planner_agent_pydantic_valid():
    """Régression rule 002 : le plan passe Pydantic."""
    from agents.planner_agent import PlannerAgent
    from lesson_plan_schema import LessonPlan
    agent = PlannerAgent()
    plan, _ = agent.generate(SAMPLE_MANIFEST, target="M1")
    plan2 = LessonPlan(**plan.model_dump())
    assert plan2.id == plan.id
