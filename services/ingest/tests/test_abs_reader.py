import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "../../../fixtures/m2/abs_capsule_minimal"
)


def test_abs_reader_returns_capsule_data():
    from abs_reader import ABSCapsuleReader, ABSCapsuleData
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH)
    assert isinstance(data, ABSCapsuleData)


def test_abs_reader_task_cards():
    from abs_reader import ABSCapsuleReader
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH)
    assert len(data.task_cards) == 1
    assert data.task_cards[0].task_id == "task_001"
    assert data.task_cards[0].title == "LC-MS feature detection from mzML data"
    assert "sample.mzML" in data.task_cards[0].inputs
    assert "feature_table.csv" in data.task_cards[0].expected_outputs


def test_abs_reader_skills():
    from abs_reader import ABSCapsuleReader
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH)
    assert len(data.skills) == 1
    skill = data.skills[0]
    assert skill.slug == "lc_ms_feature_detection"
    assert skill.edam_operation == "http://edamontology.org/operation_3214"
    assert "http://edamontology.org/topic_0121" in skill.edam_topics


def test_abs_reader_doi():
    from abs_reader import ABSCapsuleReader
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH)
    assert data.doi == "10.1021/acs.analchem.0c04490"


def test_abs_reader_ro_crate_uri():
    from abs_reader import ABSCapsuleReader
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH)
    assert data.ro_crate_entity_uri is not None


def test_abs_reader_task_card_ids_filter():
    from abs_reader import ABSCapsuleReader
    reader = ABSCapsuleReader()
    data = reader.read(FIXTURE_PATH, task_card_ids=["task_001"])
    assert len(data.task_cards) == 1

    data_empty = reader.read(FIXTURE_PATH, task_card_ids=["task_999"])
    assert len(data_empty.task_cards) == 0
