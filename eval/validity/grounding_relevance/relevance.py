"""relevance.py — lexical (token-overlap) relevance primitives. Pure stdlib.

The contract is deliberately small and honest: relevance here is Jaccard overlap
between the bag of content words in a scene and the bag of content words in a
cited reference. It is a PROXY for topical relevance, not a semantic judge — a
ref that paraphrases the scene with zero shared vocabulary will score low. The
point is not to be a perfect grader but to cheaply separate citations that share
the scene's subject matter from citations that are clearly about something else
(the mock metabolomics paper on a peroxisomes lesson).
"""

from __future__ import annotations

import re
from typing import List, Optional, Set, Tuple

# A small, built-in English stopword set. Kept intentionally short: the goal is
# to drop function words that would otherwise inflate overlap between unrelated
# texts, not to do real linguistics. No external dependency (NLTK etc.).
_STOPWORDS: Set[str] = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "her", "was", "one", "our", "out", "had", "has", "have", "его", "with",
    "this", "that", "from", "they", "will", "would", "there", "their", "what",
    "which", "when", "were", "been", "being", "into", "than", "then", "them",
    "these", "those", "some", "such", "only", "other", "more", "most", "also",
    "your", "about", "over", "between", "both", "each", "after", "before",
    "because", "while", "where", "how", "why", "who", "whom", "its", "it's",
    "should", "could", "may", "might", "must", "shall", "does", "did", "doing",
    "his", "she", "him", "had", "use", "using", "used", "via", "per", "etc",
}

_TOKEN_SPLIT_RE = re.compile(r"[^0-9a-zA-Z]+")


def tokenize(text: Optional[str]) -> Set[str]:
    """Lowercase, split on any run of non-alphanumeric chars, drop stopwords and
    tokens shorter than 3 chars. Returns a set (bag-of-words, order-free).

    Defensive: ``None`` or non-str input yields the empty set.
    """
    if not text or not isinstance(text, str):
        return set()
    toks = set()
    for raw in _TOKEN_SPLIT_RE.split(text.lower()):
        if len(raw) < 3:
            continue
        if raw in _STOPWORDS:
            continue
        toks.add(raw)
    return toks


def jaccard(a: Set[str], b: Set[str]) -> float:
    """|a ∩ b| / |a ∪ b|. Returns 0.0 if both are empty (no false signal)."""
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def scene_text(scene: dict) -> str:
    """``scene.title + " " + scene.markdown`` — the content a citation grounds.

    Handles missing title/markdown gracefully (treated as empty).
    """
    if not isinstance(scene, dict):
        return ""
    title = scene.get("title") or ""
    markdown = scene.get("markdown") or scene.get("content") or ""
    return f"{title} {markdown}"


def ref_text(ref: dict) -> str:
    """``ref.title + " " + ref.excerpt`` — the citation's own descriptive text."""
    if not isinstance(ref, dict):
        return ""
    title = ref.get("title") or ""
    excerpt = ref.get("excerpt") or ""
    return f"{title} {excerpt}"


def ref_relevance(scene: dict, ref: dict) -> float:
    """Lexical relevance of a single ref to a scene: jaccard of their tokens."""
    return jaccard(tokenize(scene_text(scene)), tokenize(ref_text(ref)))


def _ref_id(ref: dict) -> str:
    """Stable, human-readable identifier for a ref: prefer DOI, fall back to title."""
    if not isinstance(ref, dict):
        return "<unknown>"
    return str(ref.get("doi") or ref.get("title") or "<unknown>")


def _bibliographic_refs(scene: dict) -> List[dict]:
    if not isinstance(scene, dict):
        return []
    evidence = scene.get("evidence")
    if not isinstance(evidence, dict):
        return []
    refs = evidence.get("bibliographic_refs")
    if not isinstance(refs, list):
        return []
    return [r for r in refs if isinstance(r, dict)]


def scene_relevance(scene: dict) -> Optional[dict]:
    """For a scene carrying ``evidence.bibliographic_refs``, return::

        {"best": <max ref relevance>,
         "mean": <mean ref relevance>,
         "per_ref": [(doi_or_title, score), ...]}

    Returns ``None`` when the scene has no evidence / no bibliographic refs —
    callers use that to skip non-grounded scenes (intro/concept without evidence).
    """
    refs = _bibliographic_refs(scene)
    if not refs:
        return None
    per_ref: List[Tuple[str, float]] = []
    for ref in refs:
        per_ref.append((_ref_id(ref), ref_relevance(scene, ref)))
    scores = [s for _, s in per_ref]
    return {
        "best": max(scores),
        "mean": sum(scores) / len(scores),
        "per_ref": per_ref,
    }
