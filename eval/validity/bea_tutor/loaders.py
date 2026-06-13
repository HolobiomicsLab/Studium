# loaders.py — turn a lesson bundle's authored scaffolding into TutorMoveRecords.
from __future__ import annotations

from typing import List

from eval.validity.bea_tutor.bea import TutorMoveRecord


def _quiz_banned(scene: dict) -> List[str]:
    banned: List[str] = []
    for ch in scene.get("choices", []) or []:
        if isinstance(ch, dict) and ch.get("correct") and ch.get("text"):
            banned.append(str(ch["text"]))
    if scene.get("feedback_correct"):
        banned.append(str(scene["feedback_correct"]))
    return banned


def authored_scaffolding_moves(bundle: dict) -> List[TutorMoveRecord]:
    """Hints/feedback of every quiz scene become tutor moves (BEA-scoreable, no runtime)."""
    if not isinstance(bundle, dict):
        return []
    out: List[TutorMoveRecord] = []
    for scene in bundle.get("scenes", []) or []:
        if not isinstance(scene, dict) or scene.get("type") != "quiz":
            continue
        banned = _quiz_banned(scene)
        for hint in scene.get("hints", []) or []:
            out.append(TutorMoveRecord(text=str(hint), move_kind="scaffold_hint",
                                       in_reply_to_signal="question", banned=banned, source="authored"))
        if scene.get("feedback_incorrect"):
            out.append(TutorMoveRecord(text=str(scene["feedback_incorrect"]), move_kind="acknowledge_extend",
                                       in_reply_to_signal="justification", banned=banned, source="authored"))
        if scene.get("feedback_correct"):
            out.append(TutorMoveRecord(text=str(scene["feedback_correct"]), move_kind="probe_synthesis",
                                       in_reply_to_signal="synthesis",
                                       banned=[b for b in banned if b != scene["feedback_correct"]], source="authored"))
    return out
