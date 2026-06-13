"""Tests for the live tutor-turn loader (--log-tutor-text sidecar → TutorMoveRecords)."""

import json

from eval.validity.bea_tutor.loaders import all_bundle_banned, live_tutor_moves


def _bundle():
    return {"scenes": [
        {"id": "q1", "type": "quiz", "concept_refs": ["c1"], "question": "?",
         "choices": [{"id": "b", "text": "le peroxysome", "correct": True}],
         "feedback_correct": "Exact.", "feedback_incorrect": "Non.", "hints": []},
        {"id": "d1", "type": "discussion", "concept_refs": ["c1"], "topic": "t",
         "seed_claim": "le bruit masque le signal", "target_signals": ["justification"], "max_turns": 5},
    ]}


def test_all_bundle_banned_collects_quiz_answers_and_seed_claims():
    banned = all_bundle_banned(_bundle())
    assert "le peroxysome" in banned and "Exact." in banned
    assert "le bruit masque le signal" in banned


def test_live_tutor_moves_parses_sidecar_and_attaches_banned(tmp_path):
    sidecar = tmp_path / "tutor-texts.jsonl"
    sidecar.write_text("\n".join(json.dumps(x) for x in [
        {"scene_id": "d1", "move_kind": "probe_justification", "text": "Quel est le maillon le plus faible ?"},
        {"scene_id": "d1", "move_kind": "scaffold_hint", "text": "en fait le peroxysome est la réponse"},
    ]), encoding="utf-8")
    moves = live_tutor_moves(str(sidecar), _bundle())
    assert len(moves) == 2
    assert all(m.source == "live" for m in moves)
    assert moves[0].move_kind == "probe_justification"
    assert "le peroxysome" in moves[1].banned          # so the reveal dim can flag the 2nd turn


def test_live_tutor_moves_missing_file_is_empty():
    assert live_tutor_moves("/no/such/sidecar.jsonl", _bundle()) == []
