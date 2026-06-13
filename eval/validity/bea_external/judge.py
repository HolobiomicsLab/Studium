# judge.py — LLM judge for BEA "providing guidance" (verbatim rubric). Pure stdlib + a JudgeClient.
from __future__ import annotations

from typing import Dict, Optional, Protocol


class JudgeClient(Protocol):
    def complete_json(self, prompt: str, system: Optional[str] = None): ...


# BEA "providing guidance" dimension, reused verbatim (BEA 2023/2025 shared task).
BEA_GUIDANCE_RUBRIC = (
    "Providing Guidance — Does the tutor's turn offer the student correct and relevant "
    "guidance (a hint, explanation, supporting question, or example) that helps them make "
    "progress, WITHOUT simply handing over the full answer? Rate on a 3-point scale:\n"
    "- yes: clear, relevant guidance that moves the student's thinking forward.\n"
    "- to_some_extent: partial or vague guidance.\n"
    "- no: no guidance (e.g. only praise/greeting, or it just states the answer)."
)

_SCORE = {"yes": 1.0, "to_some_extent": 0.5, "no": 0.0}


def build_judge_prompt(turn_text: str, question: Optional[str] = None) -> str:
    ctx = f"Problem context: {question}\n\n" if question else ""
    return (
        f"{BEA_GUIDANCE_RUBRIC}\n\n{ctx}Tutor turn to rate:\n\"\"\"\n{turn_text}\n\"\"\"\n\n"
        'Respond with STRICT JSON ONLY: {"guidance": "<yes|to_some_extent|no>"}'
    )


def parse_judgment(obj) -> Optional[Dict]:
    if not isinstance(obj, dict):
        return None
    label = obj.get("guidance")
    if not isinstance(label, str) or label not in _SCORE:
        return None
    return {"label": label, "score": _SCORE[label]}


def judge_guidance(turn_text: str, client: JudgeClient, question: Optional[str] = None) -> Optional[Dict]:
    """Score one tutor turn on BEA guidance via the client. Returns None on bad output
    (graceful degradation — the caller decides how to treat a missing judgment)."""
    try:
        raw = client.complete_json(build_judge_prompt(turn_text, question))
    except Exception:
        return None
    return parse_judgment(raw)


class StubJudge:
    """Deterministic JudgeClient for tests: 'yes' if the turn contains a marker, else 'no'."""

    def __init__(self, yes_if_contains: str = "?"):
        self.marker = yes_if_contains

    def complete_json(self, prompt: str, system: Optional[str] = None):
        # the prompt embeds the turn between triple quotes
        turn = prompt.split('"""', 2)[1] if prompt.count('"""') >= 2 else prompt
        return {"guidance": "yes" if self.marker in turn else "no"}
