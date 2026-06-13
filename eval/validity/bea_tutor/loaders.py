# loaders.py — turn authored scaffolding (and live tutor turns) into TutorMoveRecords.
from __future__ import annotations

import json
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


def all_bundle_banned(bundle: dict) -> List[str]:
    """Every answer string a LIVE tutor turn must not reveal: each quiz's correct-choice
    text + feedback_correct, plus each discussion scene's seed_claim. Used to BEA-score
    live tutor turns (the --log-tutor-text sidecar carries no banned of its own)."""
    if not isinstance(bundle, dict):
        return []
    banned: List[str] = []
    for scene in bundle.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        if scene.get("type") == "quiz":
            banned.extend(_quiz_banned(scene))
        elif scene.get("type") == "discussion" and scene.get("seed_claim"):
            banned.append(str(scene["seed_claim"]))
    # de-dup, preserve order
    seen: set = set()
    return [b for b in banned if not (b in seen or seen.add(b))]


def live_tutor_moves(sidecar_path: str, bundle: dict) -> List[TutorMoveRecord]:
    """Parse a runtime ``tutor-texts.jsonl`` sidecar (--log-tutor-text) into LIVE tutor
    moves, attaching the bundle's banned answer strings so the reveal dim can score them.

    Each sidecar line is ``{"scene_id", "move_kind", "text"}``. Defensive: missing file or
    a corrupt line is skipped, never raised.
    """
    banned = all_bundle_banned(bundle)
    out: List[TutorMoveRecord] = []
    try:
        with open(sidecar_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(obj, dict) or not isinstance(obj.get("text"), str):
                    continue
                out.append(TutorMoveRecord(text=obj["text"], move_kind=str(obj.get("move_kind", "")),
                                           banned=list(banned), source="live"))
    except OSError:
        return []
    return out
