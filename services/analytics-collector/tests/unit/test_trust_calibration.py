"""Unit tests for trust_calibration (judgment-over-artifact calibration surface).

Distinct from confidence_calibration (declared-vs-competence, Brier). This is the
teacher-facing surface of the engine's `trust_calibration` dimension: how well the
learner's TRUST in an AI reading of a real artifact matches ground truth, computed
telemetry-natively from the grounded spot_the_flaw audits (`ai_audit_result`).

Per scorable scene (planted_errors > 0, counters pooled across that scene's events):
    over_trust    = missed / planted             (credulous: missed planted flaws, +)
    over_distrust = min(fp, planted) / planted    (skeptical: flagged sound claims, -)
    gap           = over_trust - over_distrust    in [-1, 1]

overall trust_calibration = mean(gap) over scorable scenes (mirrors ai_audit overall);
None if no scene is scorable. Band mirrors confidence:
    |gap| <= TRUST_WELL_BAND(0.4) -> "bien"; gap > band -> "sur" (surconfiance IA);
    gap < -band -> "sous" (mefiance IA).

HONESTY BOUNDARY (asserted below): the live offline flaw-matcher hard-codes
false_positives=0 (no sound-claims ground truth), so in production the over-distrust
direction is structurally 0 and gap only moves >= 0. The aggregate faithfully reflects
whatever fp the telemetry carries; the "sous" band is reachable only if a richer grader
ever emits fp > 0.
"""

import json
from pathlib import Path

from metrics import TRUST_WELL_BAND, compute_trust_calibration


def _base(idx=0, pseudo="hmac:learner0"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
    }


def _audit_event(idx, scene_id, tp, fp, planted, missed, pseudo="hmac:learner0"):
    return {
        **_base(idx, pseudo=pseudo),
        "type": "ai_audit_result",
        "scene_id": scene_id,
        "true_positives": tp,
        "false_positives": fp,
        "planted_errors": planted,
        "missed": missed,
    }


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-06-28.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def test_well_calibrated_perfect_audit(tmp_path):
    """Caught every planted flaw, no false positives -> gap 0, band 'bien'."""
    events = [_audit_event(0, "s1", tp=3, fp=0, planted=3, missed=0)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert r["trust_calibration"] == 0.0
    assert r["band"] == "bien"
    assert r["over_trust"] == 0.0
    assert r["over_distrust"] == 0.0
    assert r["n_audits"] == 1
    assert r["per_scene"][0]["scene_id"] == "s1"
    assert r["per_scene"][0]["gap"] == 0.0


def test_over_trust_missed_flaws(tmp_path):
    """Missed 2 of 3 planted flaws -> over_trust 2/3, gap > band, band 'sur'."""
    events = [_audit_event(0, "s1", tp=1, fp=0, planted=3, missed=2)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert abs(r["trust_calibration"] - (2 / 3)) < 1e-9
    assert r["band"] == "sur"  # over-trust (surconfiance IA)
    assert abs(r["over_trust"] - (2 / 3)) < 1e-9
    assert r["over_distrust"] == 0.0


def test_over_distrust_false_positives(tmp_path):
    """Flagged 3 sound claims (fp=3) on a 3-flaw scene -> over_distrust 1, band 'sous'.

    Only reachable if a grader ever emits fp>0 (live matcher hard-codes fp=0)."""
    events = [_audit_event(0, "s1", tp=3, fp=3, planted=3, missed=0)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert abs(r["trust_calibration"] - (-1.0)) < 1e-9
    assert r["band"] == "sous"  # over-distrust (mefiance IA)
    assert r["over_trust"] == 0.0
    assert r["over_distrust"] == 1.0


def test_false_positives_capped_at_planted(tmp_path):
    """fp far exceeding planted is capped so over_distrust stays bounded at 1."""
    events = [_audit_event(0, "s1", tp=0, fp=9, planted=3, missed=3)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    # over_trust = 3/3 = 1 ; over_distrust = min(9,3)/3 = 1 ; gap = 0
    assert r["over_distrust"] == 1.0
    assert r["over_trust"] == 1.0
    assert r["trust_calibration"] == 0.0
    assert r["band"] == "bien"


def test_planted_zero_not_scorable(tmp_path):
    """A scene with no planted flaws is unscorable; sole such scene -> None/None."""
    events = [_audit_event(0, "s1", tp=0, fp=0, planted=0, missed=0)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert r["trust_calibration"] is None
    assert r["band"] is None
    assert r["n_audits"] == 0


def test_no_audit_events_returns_none(tmp_path):
    """No ai_audit_result events at all -> unmeasured (None), n_audits 0."""
    events = [{**_base(0), "type": "scene_entered", "scene_id": "s1"}]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert r["trust_calibration"] is None
    assert r["band"] is None
    assert r["n_audits"] == 0
    assert r["per_scene"] == []


def test_counters_pooled_across_events_same_scene(tmp_path):
    """Two ai_audit_result events for one scene sum their counters before scoring."""
    events = [
        _audit_event(0, "s1", tp=1, fp=0, planted=2, missed=1),
        _audit_event(1, "s1", tp=2, fp=0, planted=2, missed=0),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    # pooled: missed=1, planted=4 -> over_trust = 1/4 = 0.25 ; gap 0.25 <= 0.4 -> bien
    assert r["n_audits"] == 1
    assert abs(r["over_trust"] - 0.25) < 1e-9
    assert r["band"] == "bien"


def test_overall_is_mean_of_per_scene_gaps_ignoring_unscorable(tmp_path):
    """3 scenes: over-trust(0.667), unscorable(None), calibrated(0) -> mean over 2 = 0.333."""
    events = [
        _audit_event(0, "s1", tp=1, fp=0, planted=3, missed=2),  # gap 0.667
        _audit_event(1, "s2", tp=0, fp=0, planted=0, missed=0),  # None
        _audit_event(2, "s3", tp=3, fp=0, planted=3, missed=0),  # gap 0.0
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert r["n_audits"] == 2
    assert abs(r["trust_calibration"] - ((2 / 3) + 0.0) / 2) < 1e-9
    assert r["band"] == "bien"  # 0.333 <= 0.4


def test_filter_by_learner(tmp_path):
    """learner filter isolates one pseudonym's audits."""
    events = [
        _audit_event(0, "s1", tp=1, fp=0, planted=3, missed=2, pseudo="hmac:a"),  # over-trust
        _audit_event(1, "s1", tp=3, fp=0, planted=3, missed=0, pseudo="hmac:b"),  # calibrated
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    ra = compute_trust_calibration(data_dir, "c1", learner="hmac:a")
    assert ra["band"] == "sur"
    rb = compute_trust_calibration(data_dir, "c1", learner="hmac:b")
    assert rb["band"] == "bien"


def test_band_constant_is_exposed_and_consistent(tmp_path):
    """TRUST_WELL_BAND matches the engine's 0.4 and gates the band boundaries."""
    assert TRUST_WELL_BAND == 0.4
    # gap exactly at the band edge counts as well-calibrated (<= band)
    # over_trust = 0.4 -> missed/planted = 2/5
    events = [_audit_event(0, "s1", tp=3, fp=0, planted=5, missed=2)]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_trust_calibration(data_dir, "c1")
    assert abs(r["trust_calibration"] - 0.4) < 1e-9
    assert r["band"] == "bien"
