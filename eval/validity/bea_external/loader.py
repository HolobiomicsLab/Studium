"""loader.py — parse MathDial conversations into labeled teacher turns. Pure stdlib.

MathDial `conversation` cells look like:
    Teacher: (probing)<text>|EOM|Student: <text>|EOM|Teacher: (telling)<text>|EOM|...
We keep only Teacher turns that carry a (move) tag, map move -> is_guiding
(probing|focus = guiding/Socratic; telling|generic = direct), and attach the
dialogue's banned answer strings (numeric tokens from ground_truth).
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from typing import List

_MOVE_RE = re.compile(r"^Teacher:\s*\((\w+)\)(.*)$", re.DOTALL)
_GUIDING = {"probing", "focus"}
_NUM_RE = re.compile(r"-?\d[\d,]*\.?\d*")


@dataclass
class TeacherTurn:
    text: str
    move: str
    is_guiding: bool
    banned: List[str] = field(default_factory=list)
    qid: str = ""


def banned_from_ground_truth(ground_truth: str) -> List[str]:
    """Distinct numeric tokens in the solution (the answer strings a reveal would state)."""
    seen: List[str] = []
    for m in _NUM_RE.findall(ground_truth or ""):
        tok = m.strip().rstrip(".")
        if tok and tok not in seen:
            seen.append(tok)
    return seen


def parse_conversation(conversation: str, banned: List[str], qid: str = "") -> List[TeacherTurn]:
    out: List[TeacherTurn] = []
    for part in (conversation or "").split("|EOM|"):
        part = part.strip()
        m = _MOVE_RE.match(part)
        if not m:
            continue
        move = m.group(1).lower()
        text = m.group(2).strip()
        out.append(TeacherTurn(text=text, move=move, is_guiding=move in _GUIDING,
                               banned=list(banned), qid=qid))
    return out


def load_mathdial_csv(path: str) -> List[TeacherTurn]:
    """All labeled teacher turns across a MathDial CSV. Defensive: skips bad rows."""
    csv.field_size_limit(10 ** 7)
    turns: List[TeacherTurn] = []
    try:
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                banned = banned_from_ground_truth(row.get("ground_truth", ""))
                turns.extend(parse_conversation(row.get("conversation", ""), banned, row.get("qid", "")))
    except OSError:
        return []
    return turns
