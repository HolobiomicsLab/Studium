"""Unit tests for reasoning_depth_score (M5.2).

Score formula v1 (choix B — binarisé) :
    score = sum(weight[signal] for signal in signals_present_at_least_once)
    weights = {justification: 0.25, hypothesis: 0.20, counterexample: 0.20,
               synthesis: 0.20, question: 0.15}
    max possible = 1.00 (les 5 signaux présents au moins une fois)
"""

import json
from pathlib import Path

import metrics
from metrics import compute_reasoning_depth_score


def _base(idx=0, pseudo="hmac:learner0"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-12T10:00:00Z",
    }


def _signal_event(idx, scene_id, signal, pseudo="hmac:learner0", turn_index=0):
    return {
        **_base(idx, pseudo=pseudo),
        "type": "reasoning_signal",
        "scene_id": scene_id,
        "signal": signal,
        "confidence": 0.9,
        "turn_index": turn_index,
    }


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / "2026-05-12.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def test_score_uniform_signals(tmp_path):
    """5 events, un par signal distinct → score = 1.00 (tous présents)."""
    events = [
        _signal_event(0, "s1", "justification", turn_index=0),
        _signal_event(1, "s1", "hypothesis", turn_index=1),
        _signal_event(2, "s1", "counterexample", turn_index=2),
        _signal_event(3, "s1", "synthesis", turn_index=3),
        _signal_event(4, "s1", "question", turn_index=4),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    s1 = result["scenes"]["s1"]
    assert s1["score"] == 1.00
    assert s1["n_signals"] == 5
    assert s1["breakdown"]["justification"] == 0.2
    assert s1["breakdown"]["hypothesis"] == 0.2
    assert s1["breakdown"]["counterexample"] == 0.2
    assert s1["breakdown"]["synthesis"] == 0.2
    assert s1["breakdown"]["question"] == 0.2


def test_score_only_justifications(tmp_path):
    """N events tous « justification » → score = 0.25."""
    events = [
        _signal_event(i, "s1", "justification", turn_index=i) for i in range(4)
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    s1 = result["scenes"]["s1"]
    assert s1["score"] == 0.25
    assert s1["n_signals"] == 4
    assert s1["breakdown"]["justification"] == 1.0


def test_score_two_signals_present(tmp_path):
    """events « justification » + « counterexample » → score = 0.45."""
    events = [
        _signal_event(0, "s1", "justification", turn_index=0),
        _signal_event(1, "s1", "counterexample", turn_index=1),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    s1 = result["scenes"]["s1"]
    assert abs(s1["score"] - 0.45) < 1e-9
    assert s1["n_signals"] == 2


def test_no_signals_returns_none(tmp_path):
    """Aucun reasoning_signal pour la scène → score=null, n_signals=0."""
    # Scene a exists via other events (scene_entered), but no reasoning_signal.
    events = [
        {**_base(0), "type": "scene_entered", "scene_id": "s1", "scene_type": "discussion"},
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    # No reasoning_signal events anywhere → scenes empty dict. La forme est exacte : une clé
    # nouvelle doit se justifier ici plutôt que d'apparaître. `withheld_below_floor` est
    # INT-STUDIUM-030 R1 — un booléen, jamais un compte, et il est faux ici parce qu'aucune
    # scène n'a été retenue : il n'y en avait aucune.
    assert result == {"scenes": {}, "withheld_below_floor": False,
                      "judgement": {"cohort_band": None,
                                    "cohort_counts": "no contributors: this number was "
                                                     "computed over nobody",
                                    "non_attribution": metrics.NON_ATTRIBUTION}}


def test_breakdown_proportions_correct(tmp_path):
    """events {3 just, 1 hyp, 1 question} (total 5) → score = 0.60."""
    events = [
        _signal_event(0, "s1", "justification", turn_index=0),
        _signal_event(1, "s1", "justification", turn_index=1),
        _signal_event(2, "s1", "justification", turn_index=2),
        _signal_event(3, "s1", "hypothesis", turn_index=3),
        _signal_event(4, "s1", "question", turn_index=4),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    s1 = result["scenes"]["s1"]
    # score (binarisé) = 0.25 (just) + 0.20 (hyp) + 0.15 (question) = 0.60
    assert abs(s1["score"] - 0.60) < 1e-9
    assert s1["n_signals"] == 5
    # breakdown = proportions (utile pour le frontend)
    assert abs(s1["breakdown"]["justification"] - 0.6) < 1e-9
    assert abs(s1["breakdown"]["hypothesis"] - 0.2) < 1e-9
    assert abs(s1["breakdown"]["question"] - 0.2) < 1e-9
    assert s1["breakdown"].get("counterexample", 0.0) == 0.0
    assert s1["breakdown"].get("synthesis", 0.0) == 0.0


def test_clamping_0_to_1(tmp_path):
    """Score toujours dans [0,1] quelle que soit la combinaison."""
    events = [
        _signal_event(0, "s1", "justification", turn_index=0),
        _signal_event(1, "s1", "hypothesis", turn_index=1),
        _signal_event(2, "s1", "counterexample", turn_index=2),
        _signal_event(3, "s1", "synthesis", turn_index=3),
        _signal_event(4, "s1", "question", turn_index=4),
        # Doublons : ne doivent pas faire dépasser 1.0
        _signal_event(5, "s1", "justification", turn_index=5),
        _signal_event(6, "s1", "hypothesis", turn_index=6),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_reasoning_depth_score(data_dir, "c1")
    s1 = result["scenes"]["s1"]
    assert 0.0 <= s1["score"] <= 1.0
    assert s1["score"] == 1.0


def test_filter_by_pseudonyme(tmp_path):
    """events de 2 pseudonymes différents, filtre par 1 → seuls ses events comptent."""
    events = [
        _signal_event(0, "s1", "justification", pseudo="hmac:a", turn_index=0),
        _signal_event(1, "s1", "justification", pseudo="hmac:a", turn_index=1),
        _signal_event(2, "s1", "hypothesis", pseudo="hmac:b", turn_index=0),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result_a = compute_reasoning_depth_score(data_dir, "c1", pseudonyme="hmac:a")
    s1_a = result_a["scenes"]["s1"]
    assert s1_a["score"] == 0.25  # only justification
    assert s1_a["n_signals"] == 2

    result_b = compute_reasoning_depth_score(data_dir, "c1", pseudonyme="hmac:b")
    s1_b = result_b["scenes"]["s1"]
    assert s1_b["score"] == 0.20  # only hypothesis
    assert s1_b["n_signals"] == 1


def test_filter_by_scene_id(tmp_path):
    """events de 2 scènes, filtre par 1 → seuls ses events."""
    events = [
        _signal_event(0, "s1", "justification", turn_index=0),
        _signal_event(1, "s2", "hypothesis", turn_index=0),
        _signal_event(2, "s2", "counterexample", turn_index=1),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result_s2 = compute_reasoning_depth_score(data_dir, "c1", scene_id="s2")
    assert "s1" not in result_s2["scenes"]
    s2 = result_s2["scenes"]["s2"]
    assert abs(s2["score"] - 0.40) < 1e-9  # hypothesis + counterexample
    assert s2["n_signals"] == 2
