# tests/test_cli.py
import json
from eval.validity.reasoning_depth.run_reasoning_depth import main

def test_cli_on_a_run_dir(tmp_path, capsys):
    sd = tmp_path / "sessions" / "alex"; sd.mkdir(parents=True)
    (sd / "telemetry.jsonl").write_text("\n".join(json.dumps(x) for x in [
        {"type": "reasoning_signal", "scene_id": "d1", "signal": "question", "confidence": 0.8, "turn_index": 0},
        {"type": "reasoning_signal", "scene_id": "d1", "signal": "synthesis", "confidence": 0.8, "turn_index": 1},
        {"type": "tutor_move", "scene_id": "d1", "move_kind": "redirect_question", "in_reply_to_signal": "question", "revealed": False, "reveal_blocked": False, "turn_index": 0},
    ]), encoding="utf-8")
    rc = main(["--run-dir", str(tmp_path), "--no-report"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "REASONING-DEPTH" in out.upper()
    assert "contingency" in out.lower()
