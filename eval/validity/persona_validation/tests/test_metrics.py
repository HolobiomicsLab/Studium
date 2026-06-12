"""Tests for metrics.py — distance / similarity / collapse scoring."""

import math

from eval.validity.persona_validation.loader import PersonaRecord
from eval.validity.persona_validation.metrics import (
    COLLAPSE_THRESHOLD,
    collapse_score,
    cosine_sim,
    l1_distance,
    mastery_vector,
    transition_distribution_distance,
)


def _rec(persona, mastery, transitions):
    counts = {}
    for t in transitions:
        counts[t] = counts.get(t, 0) + 1
    return PersonaRecord(
        persona=persona,
        completed=True,
        n_turns=len(transitions),
        transition_kinds=list(transitions),
        transition_counts=counts,
        mastery=dict(mastery),
        autonomy_ratio=1.0,
        rules_fired=set(),
    )


def test_l1_distance():
    assert l1_distance([0.0, 0.0], [0.0, 0.0]) == 0.0
    assert l1_distance([1.0, 0.0], [0.0, 1.0]) == 2.0
    assert math.isclose(l1_distance([0.8, 0.2], [0.5, 0.4]), 0.5)


def test_cosine_sim_identical_and_orthogonal():
    assert math.isclose(cosine_sim([1.0, 1.0], [1.0, 1.0]), 1.0)
    assert math.isclose(cosine_sim([1.0, 0.0], [0.0, 1.0]), 0.0)


def test_cosine_sim_zero_vector_is_zero():
    # zero vector has no direction — defined as 0 similarity, must not divide-by-zero
    assert cosine_sim([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert cosine_sim([0.0, 0.0], [0.0, 0.0]) == 0.0


def test_mastery_vector_aligned_over_sorted_concepts():
    rec = _rec("p", {"c-b": 0.4, "c-a": 0.9}, ["next"])
    concepts = ["c-a", "c-b", "c-c"]
    # c-c absent -> 0.0; order follows the given concept list
    assert mastery_vector(rec, concepts) == [0.9, 0.4, 0.0]


def test_transition_distribution_distance_normalized_l1():
    a = _rec("a", {}, ["next", "next", "complete"])
    b = _rec("b", {}, ["next", "next", "complete"])
    assert transition_distribution_distance(a, b) == 0.0

    # fully disjoint transition mixes -> max normalized L1 distance == 1.0
    c = _rec("c", {}, ["next", "next"])
    d = _rec("d", {}, ["remediate_alt", "remediate_alt"])
    assert math.isclose(transition_distribution_distance(c, d), 1.0)


def test_collapse_score_identical_records_near_one():
    a = _rec("a", {"c-a": 0.8, "c-b": 0.5}, ["next", "next", "complete"])
    b = _rec("b", {"c-a": 0.8, "c-b": 0.5}, ["next", "next", "complete"])
    concepts = ["c-a", "c-b"]
    score = collapse_score(a, b, concepts)
    assert score >= COLLAPSE_THRESHOLD
    assert math.isclose(score, 1.0, abs_tol=1e-9)


def test_collapse_score_divergent_records_low():
    # very different mastery AND transition mix -> low collapse score
    a = _rec("a", {"c-a": 0.95, "c-b": 0.95}, ["next", "next", "next", "complete"])
    b = _rec(
        "b",
        {"c-a": 0.1, "c-b": 0.1},
        ["remediate_alt", "remediate_alt", "remediate_alt", "complete"],
    )
    concepts = ["c-a", "c-b"]
    score = collapse_score(a, b, concepts)
    assert score < COLLAPSE_THRESHOLD
    assert score < 0.6


def test_collapse_score_in_unit_interval():
    a = _rec("a", {"c-a": 0.7}, ["next"])
    b = _rec("b", {"c-a": 0.3}, ["remediate_alt"])
    s = collapse_score(a, b, ["c-a"])
    assert 0.0 <= s <= 1.0
