"""metrics.py — divergence / similarity / collapse scoring (pure stdlib).

These quantify how DIFFERENT two persona records are. "Persona collapse" is the
failure mode where two simulated students produce near-identical mastery AND
near-identical runtime behaviour — which makes the eval signal they're supposed
to separate (e.g. M3 calibration) unobservable.
"""

from __future__ import annotations

import math
from typing import Dict, List

from eval.validity.persona_validation.loader import PersonaRecord

# A pair scoring >= this on collapse_score is treated as "collapsed".
COLLAPSE_THRESHOLD = 0.98


def mastery_vector(rec: PersonaRecord, concepts: List[str]) -> List[float]:
    """Mastery aligned over a given concept-id list (missing concept -> 0.0)."""
    return [float(rec.mastery.get(c, 0.0)) for c in concepts]


def l1_distance(a: List[float], b: List[float]) -> float:
    """Sum of absolute differences. Shorter vector is zero-padded."""
    n = max(len(a), len(b))
    total = 0.0
    for i in range(n):
        av = a[i] if i < len(a) else 0.0
        bv = b[i] if i < len(b) else 0.0
        total += abs(av - bv)
    return total


def cosine_sim(a: List[float], b: List[float]) -> float:
    """Cosine similarity in [−1, 1]. A zero vector has no direction -> 0.0."""
    n = max(len(a), len(b))
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        av = a[i] if i < len(a) else 0.0
        bv = b[i] if i < len(b) else 0.0
        dot += av * bv
        na += av * av
        nb += bv * bv
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _normalized_distribution(counts: Dict[str, int], keys: List[str]) -> List[float]:
    total = sum(counts.get(k, 0) for k in keys)
    if total <= 0:
        return [0.0 for _ in keys]
    return [counts.get(k, 0) / total for k in keys]


def transition_distribution_distance(
    rec_a: PersonaRecord, rec_b: PersonaRecord
) -> float:
    """Normalized-L1 distance over the transition-kind multiset, in [0, 1].

    Each persona's transition counts are turned into a probability
    distribution over the union of kinds; the L1 distance between two
    distributions is in [0, 2], so we halve it to land in [0, 1] (0 = identical
    mix, 1 = fully disjoint).
    """
    keys = sorted(set(rec_a.transition_counts) | set(rec_b.transition_counts))
    if not keys:
        return 0.0
    da = _normalized_distribution(rec_a.transition_counts, keys)
    db = _normalized_distribution(rec_b.transition_counts, keys)
    return l1_distance(da, db) / 2.0


def collapse_score(
    rec_a: PersonaRecord, rec_b: PersonaRecord, concepts: List[str]
) -> float:
    """Similarity in [0, 1]; HIGH means the two personas have collapsed.

    Collapse requires BOTH near-identical mastery AND near-identical runtime
    behaviour. We combine:

    * mastery similarity  = 1 − (L1(mastery_a, mastery_b) / |concepts|)
      (L1 over per-concept mastery in [0,1] is at most |concepts|, so the
      normalized term is in [0,1]).
    * transition similarity = 1 − transition_distribution_distance.

    The score is the MINIMUM of the two similarities — collapse only when the
    personas agree on BOTH axes; differing on either axis pulls the score down.
    """
    n = len(concepts)
    if n > 0:
        va = mastery_vector(rec_a, concepts)
        vb = mastery_vector(rec_b, concepts)
        mastery_sim = 1.0 - (l1_distance(va, vb) / n)
    else:
        mastery_sim = 1.0
    mastery_sim = max(0.0, min(1.0, mastery_sim))

    transition_sim = 1.0 - transition_distribution_distance(rec_a, rec_b)
    transition_sim = max(0.0, min(1.0, transition_sim))

    return min(mastery_sim, transition_sim)
