import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../packages/lesson-plan-schema/python"))
from lesson_plan_schema import EnrichmentMetadata

def test_passages_is_a_valid_mode():
    m = EnrichmentMetadata(
        enricher_version="1.0",
        perspicacite_mode_used="passages",
        timestamp="2026-06-10T00:00:00Z",
        degraded=False,
    )
    assert m.perspicacite_mode_used == "passages"
