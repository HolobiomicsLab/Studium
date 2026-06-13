# tests/test_telemetry.py
import json, os
from eval.validity.reasoning_depth.telemetry import read_events, events_of_type

def _write_run(tmp_path, lines):
    sd = tmp_path / "sessions" / "alex"
    sd.mkdir(parents=True)
    (sd / "telemetry.jsonl").write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    return str(tmp_path)

def test_read_events_collects_all_sessions(tmp_path):
    run = _write_run(tmp_path, [
        {"type": "reasoning_signal", "scene_id": "d1", "signal": "hypothesis", "confidence": 0.8, "turn_index": 0},
        {"type": "tutor_move", "scene_id": "d1", "move_kind": "invite_test", "in_reply_to_signal": "hypothesis", "revealed": False, "reveal_blocked": False, "turn_index": 0},
    ])
    evs = read_events(run)
    assert len(evs) == 2
    assert len(events_of_type(evs, "reasoning_signal")) == 1
    assert events_of_type(evs, "tutor_move")[0]["move_kind"] == "invite_test"

def test_read_events_missing_dir_is_empty():
    assert read_events("/no/such/dir") == []
