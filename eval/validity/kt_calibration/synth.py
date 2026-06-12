"""synth.py — synthetic KT data generator (Rasch / IRT with learning).

Generates ground-truth-known interactions so the harness itself can be
validated: a model that actually tracks learning must beat the RunningMean
floor on this data.

Model: for student ``i`` (ability ``theta_i``) attempting skill ``j``
(difficulty ``d_j``) for the ``t``-th time (0-indexed ``attempt``):

    P(correct) = sigmoid(theta_i - d_j + learning_rate * attempt)

Abilities are assigned monotonically by student index so tests can assert that
higher-ability students have higher mean correctness. Difficulties are spread
across skills. Outcomes are sampled 0/1 from a seeded ``random.Random`` passed
in — the global ``random`` module is never touched, so runs are reproducible.

Returns a flat list of dicts ``{student, skill, correct, order}`` where
``order`` is the per-(student, skill) attempt index (0-based).
"""

from __future__ import annotations

import math
import random
from typing import Dict, List


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def generate_synthetic(
    n_students: int = 50,
    n_skills: int = 6,
    n_attempts: int = 20,
    seed: int = 0,
    learning_rate: float = 0.25,
    ability_spread: float = 3.0,
    difficulty_spread: float = 2.0,
) -> List[Dict]:
    """Generate a deterministic Rasch/IRT interaction stream.

    Args:
        n_students: number of students.
        n_skills:   number of skills.
        n_attempts: attempts each student makes on each skill.
        seed:       seed for a local ``random.Random`` (reproducible).
        learning_rate: per-attempt logit gain (the learning signal).
        ability_spread: range of student abilities (theta in roughly
            [-spread/2, +spread/2]).
        difficulty_spread: range of skill difficulties.

    Returns:
        Flat list of ``{student, skill, correct, order}`` dicts. The order in
        the list is student-major, then skill, then attempt — i.e. each
        (student, skill) block is already chronologically ordered.
    """
    rng = random.Random(seed)

    # Monotone abilities by student index: s000 lowest .. sNNN highest.
    if n_students > 1:
        abilities = [
            -ability_spread / 2.0 + ability_spread * i / (n_students - 1)
            for i in range(n_students)
        ]
    else:
        abilities = [0.0]

    if n_skills > 1:
        difficulties = [
            -difficulty_spread / 2.0 + difficulty_spread * j / (n_skills - 1)
            for j in range(n_skills)
        ]
    else:
        difficulties = [0.0]

    records: List[Dict] = []
    for i in range(n_students):
        student = f"s{i:03d}"
        theta = abilities[i]
        for j in range(n_skills):
            skill = f"k{j:03d}"
            d = difficulties[j]
            for t in range(n_attempts):
                logit = theta - d + learning_rate * t
                p = _sigmoid(logit)
                correct = 1 if rng.random() < p else 0
                records.append(
                    {
                        "student": student,
                        "skill": skill,
                        "correct": correct,
                        "order": t,
                    }
                )
    return records
