"""Tests for fetch_assistments.py — preprocess source KT logs to canonical schema."""

from eval.validity.kt_calibration.fetch_assistments import (
    _read_source,
    _valid_skill,
    preprocess_rows,
)


def test_valid_skill_filters_placeholders():
    assert _valid_skill("143") is True
    assert _valid_skill("addition") is True  # non-numeric ids kept
    assert _valid_skill("") is False
    assert _valid_skill("  ") is False
    assert _valid_skill("nan") is False
    assert _valid_skill("NaN") is False
    assert _valid_skill("-1") is False


def test_preprocess_maps_columns_and_sequential_order():
    rows = [
        {"user_id": "0", "skill_id": "143", "correct": "1", "timestamp": "0"},
        {"user_id": "0", "skill_id": "143", "correct": "0", "timestamp": "0"},
        {"user_id": "7", "skill_id": "12", "correct": "1", "timestamp": "5"},
    ]
    out = preprocess_rows(rows)
    assert out == [
        {"student": "0", "skill": "143", "correct": 1, "order": 0},
        {"student": "0", "skill": "143", "correct": 0, "order": 1},
        {"student": "7", "skill": "12", "correct": 1, "order": 2},
    ]


def test_preprocess_drops_invalid_skill_rows_and_renumbers_order():
    rows = [
        {"user_id": "0", "skill_id": "143", "correct": "1"},
        {"user_id": "0", "skill_id": "", "correct": "0"},  # dropped
        {"user_id": "0", "skill_id": "nan", "correct": "1"},  # dropped
        {"user_id": "0", "skill_id": "20", "correct": "1"},
    ]
    out = preprocess_rows(rows)
    assert [r["skill"] for r in out] == ["143", "20"]
    assert [r["order"] for r in out] == [0, 1]  # contiguous after filtering


def test_preprocess_coerces_float_correct():
    rows = [{"user_id": "1", "skill_id": "2", "correct": "1.0"}]
    assert preprocess_rows(rows)[0]["correct"] == 1


def test_read_source_sniffs_tab_delimiter(tmp_path):
    tsv = tmp_path / "src.csv"
    tsv.write_text("user_id\tskill_id\tcorrect\n0\t143\t1\n0\t143\t0\n")
    rows = _read_source(str(tsv))
    assert rows[0]["user_id"] == "0"
    assert rows[0]["skill_id"] == "143"
    assert rows[1]["correct"] == "0"


def test_read_source_sniffs_comma_delimiter(tmp_path):
    csv_path = tmp_path / "src.csv"
    csv_path.write_text("user_id,skill_id,correct\n0,143,1\n")
    rows = _read_source(str(csv_path))
    assert rows[0]["skill_id"] == "143"
