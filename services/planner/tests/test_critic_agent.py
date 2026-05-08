import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))


def _sample_plan():
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, BloomLevel, SceneType
    return LessonPlan(
        schema_version="1.0",
        id="plan-critic-test",
        title="Test critic",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Comprendre LC-MS", bloom_level=BloomLevel.understand),
            LearningObjective(id="obj-2", description="Appliquer LC-MS", bloom_level=BloomLevel.apply),
        ],
        scene_outlines=[
            SceneOutline(id="sc-1", type=SceneType.concept, title="Concept", objective_refs=["obj-1"]),
            SceneOutline(id="sc-2", type=SceneType.reproduction, title="TP", objective_refs=["obj-2"]),
            SceneOutline(id="sc-3", type=SceneType.quiz, title="Quiz", objective_refs=["obj-1", "obj-2"]),
        ],
    )


def _plan_bloom_inconsistent():
    """Plan avec bloom_level=apply mais aucune scène reproduction/simulation."""
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, BloomLevel, SceneType
    return LessonPlan(
        schema_version="1.0",
        id="plan-incons",
        title="Plan incohérent",
        language="fr",
        target="L3",
        duration_minutes=30,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Appliquer", bloom_level=BloomLevel.apply),
        ],
        scene_outlines=[
            SceneOutline(id="sc-1", type=SceneType.concept, title="Concept seul", objective_refs=["obj-1"]),
        ],
    )


def _plan_doi_without_uri():
    """Plan avec CorpusRef DOI sans prov_entity_uri."""
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, CorpusRef, BloomLevel, SceneType, RefType
    return LessonPlan(
        schema_version="1.0",
        id="plan-noUri",
        title="Plan sans URI",
        language="fr",
        target="L3",
        duration_minutes=30,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Comprendre", bloom_level=BloomLevel.understand),
        ],
        scene_outlines=[
            SceneOutline(id="sc-1", type=SceneType.concept, title="Concept", objective_refs=["obj-1"]),
        ],
        corpus_refs=[
            CorpusRef(ref_id="ref-1", ref_type=RefType.doi, doi="10.1234/test", prov_entity_uri=None),
        ],
    )


def test_critic_agent_returns_critique_result():
    from agents.critic_agent import CriticAgent
    from planner_schemas import CritiqueResult
    agent = CriticAgent()
    result = agent.review(_sample_plan())
    assert isinstance(result, CritiqueResult)
    assert 0.0 <= result.score <= 1.0
    assert isinstance(result.annotations, list)


def test_critic_agent_prov_activity_uri():
    from agents.critic_agent import CriticAgent
    agent = CriticAgent()
    result = agent.review(_sample_plan())
    assert result.prov_activity_uri.startswith("urn:studium:activity:critic:")


def test_critic_agent_bloom_consistency_true():
    """Plan cohérent (apply + scène reproduction) → bloom_consistency=True."""
    from agents.critic_agent import CriticAgent
    agent = CriticAgent()
    result = agent.review(_sample_plan())
    assert result.bloom_consistency is True


def test_critic_agent_bloom_consistency_false():
    """Plan incohérent (apply sans reproduction/simulation) → bloom_consistency=False."""
    from agents.critic_agent import CriticAgent
    agent = CriticAgent()
    result = agent.review(_plan_bloom_inconsistent())
    assert result.bloom_consistency is False
    assert len(result.ontology_warnings) >= 1


def test_critic_agent_ontology_warning_doi_no_uri():
    """CorpusRef avec DOI mais sans prov_entity_uri → ontology_warning."""
    from agents.critic_agent import CriticAgent
    agent = CriticAgent()
    result = agent.review(_plan_doi_without_uri())
    assert any("prov_entity_uri" in w for w in result.ontology_warnings)
