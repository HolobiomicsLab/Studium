"""reveal_rule.py — Python mirror of the runtime reveal guardrail (reveal.ts).

Behaviour-identical to the TS runtime so what the tutor ENFORCES online is what
this eval SCORES offline. Validated by tests/test_reveal_parity.py against a
shared fixture. Pure stdlib.
"""
from __future__ import annotations

import re
from typing import List, Optional, Set

_STOPWORDS: Set[str] = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "her", "was", "one", "our", "out", "had", "has", "have", "with",
    "this", "that", "from", "they", "will", "would", "there", "their", "what",
    "which", "when", "were", "been", "being", "into", "than", "then", "them",
    "these", "those", "some", "such", "only", "other", "more", "most", "also",
    "your", "about", "over", "between", "both", "each", "after", "before",
    "because", "while", "where", "how", "why", "who", "whom", "its",
    "should", "could", "may", "might", "must", "shall", "does", "did", "doing",
    "his", "she", "him", "use", "using", "used", "via", "per", "etc",
    "les", "des", "une", "que", "qui", "pour", "dans", "est", "avec", "pas",
}
_TOKEN_SPLIT = re.compile(r"[^0-9a-zA-ZÀ-ſ]+")
DEFAULT_REVEAL_JACCARD = 0.5


def tokenize(text: Optional[str]) -> Set[str]:
    if not text or not isinstance(text, str):
        return set()
    out: Set[str] = set()
    for raw in _TOKEN_SPLIT.split(text.lower()):
        if len(raw) < 3 or raw in _STOPWORDS:
            continue
        out.add(raw)
    return out


def jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    return (len(a & b) / len(union)) if union else 0.0


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def reveals_answer(text: str, banned: List[str], theta: float = DEFAULT_REVEAL_JACCARD) -> bool:
    """True if `text` reveals any banned answer (normalized-substring OR Jaccard>=theta)."""
    norm = _normalize(text)
    toks = tokenize(text)
    for b in banned:
        nb = _normalize(b)
        if len(nb) >= 6 and nb in norm:
            return True
        if jaccard(toks, tokenize(b)) >= theta:
            return True
    return False
