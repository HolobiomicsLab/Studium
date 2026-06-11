from agents.planner_agent import PlannerAgent


def test_generate_derives_concepts_from_objectives():
    plan, _audit = PlannerAgent().generate({"manifest_id": "m1"}, target="L3")
    obj_ids = {o.id for o in plan.learning_objectives}
    concept_ids = {c.id for c in plan.concepts}
    assert concept_ids == obj_ids and len(plan.concepts) >= 1
    by_id = {c.id: c for c in plan.concepts}
    for o in plan.learning_objectives:
        c = by_id[o.id]
        assert c.bloom_level_target == o.bloom_level
        assert c.description == o.description
        assert c.title == o.description
