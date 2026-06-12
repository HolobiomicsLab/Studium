"""Tests for loader.py — CSV plug-in seam for real KT datasets."""

import textwrap

from eval.validity.kt_calibration.loader import load_interactions_csv


def test_load_default_schema(tmp_path):
    csv = tmp_path / "interactions.csv"
    csv.write_text(
        textwrap.dedent(
            """\
            student,skill,correct,order
            s1,addition,1,0
            s1,addition,0,1
            s2,addition,1,0
            """
        )
    )
    rows = load_interactions_csv(str(csv))
    assert rows == [
        {"student": "s1", "skill": "addition", "correct": 1, "order": 0},
        {"student": "s1", "skill": "addition", "correct": 0, "order": 1},
        {"student": "s2", "skill": "addition", "correct": 1, "order": 0},
    ]


def test_load_with_column_mapping(tmp_path):
    csv = tmp_path / "ednet.csv"
    csv.write_text(
        textwrap.dedent(
            """\
            user_id,skill_id,is_correct,ts
            u1,k7,1,100
            u1,k7,1,200
            """
        )
    )
    rows = load_interactions_csv(
        str(csv),
        cols={
            "student": "user_id",
            "skill": "skill_id",
            "correct": "is_correct",
            "order": "ts",
        },
    )
    assert rows[0] == {"student": "u1", "skill": "k7", "correct": 1, "order": 100}
    assert rows[1]["order"] == 200


def test_correct_coerced_to_int_0_or_1(tmp_path):
    csv = tmp_path / "x.csv"
    csv.write_text("student,skill,correct,order\na,b,1,0\na,b,0,1\n")
    rows = load_interactions_csv(str(csv))
    assert rows[0]["correct"] == 1
    assert rows[1]["correct"] == 0
    assert isinstance(rows[0]["correct"], int)
