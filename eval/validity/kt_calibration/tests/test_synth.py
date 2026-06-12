"""Tests for synth.py — deterministic Rasch/IRT synthetic KT data."""

from collections import defaultdict

from eval.validity.kt_calibration.synth import generate_synthetic


def test_deterministic_same_seed_same_data():
    a = generate_synthetic(n_students=10, n_skills=4, n_attempts=8, seed=42)
    b = generate_synthetic(n_students=10, n_skills=4, n_attempts=8, seed=42)
    assert a == b


def test_different_seed_differs():
    a = generate_synthetic(n_students=10, n_skills=4, n_attempts=8, seed=1)
    b = generate_synthetic(n_students=10, n_skills=4, n_attempts=8, seed=2)
    assert a != b


def test_record_shape_and_counts():
    data = generate_synthetic(n_students=5, n_skills=3, n_attempts=6, seed=0)
    assert len(data) == 5 * 3 * 6
    rec = data[0]
    assert set(rec.keys()) == {"student", "skill", "correct", "order"}
    assert rec["correct"] in (0, 1)


def test_does_not_use_global_random():
    # Calling with a fixed seed must not depend on / perturb global random state.
    import random

    random.seed(123)
    before = random.random()
    random.seed(123)
    generate_synthetic(n_students=5, n_skills=3, n_attempts=4, seed=7)
    after = random.random()
    assert before == after


def test_higher_ability_students_have_higher_mean_correctness():
    # generator assigns ability by student index (monotone); aggregate proves
    # the IRT signal is present: top-ability cohort beats bottom-ability cohort.
    data = generate_synthetic(n_students=40, n_skills=5, n_attempts=20, seed=3)
    by_student = defaultdict(list)
    for r in data:
        by_student[r["student"]].append(r["correct"])
    means = {s: sum(v) / len(v) for s, v in by_student.items()}
    # students are labelled s000..s039 by ascending ability
    ordered = [means[s] for s in sorted(means)]
    bottom = sum(ordered[:10]) / 10
    top = sum(ordered[-10:]) / 10
    assert top > bottom


def test_learning_increases_correctness_over_attempts():
    data = generate_synthetic(n_students=60, n_skills=5, n_attempts=20, seed=5)
    early = [r["correct"] for r in data if r["order"] < 3]
    late = [r["correct"] for r in data if r["order"] >= 17]
    assert sum(late) / len(late) > sum(early) / len(early)
