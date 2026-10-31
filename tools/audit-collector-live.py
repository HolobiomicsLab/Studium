#!/Users/nothiasl/git/prototype-build/.venv/bin/python
"""Seed and verify a local analytics-collector through its public HTTP API."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "http://127.0.0.1:8106"
MAIN_COURSE = "studium-audit-cohort"
SMALL_COURSE = "studium-audit-private"
ANONYMOUS_COURSE = "studium-audit-anonymous"
LESSON_ID = "synthetic-analytics-lesson"
BUNDLE_VERSION = "1.1:synthetic-analytics-lesson@2026-09-10T09:00:00Z"
TIMESTAMP = "2026-09-10T09:00:00Z"


def call(
    method: str,
    path: str,
    *,
    token: str | None = None,
    payload: dict | None = None,
) -> tuple[int, dict]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if token is not None:
        headers["X-Course-Token"] = token
    request = Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def metric(course: str, endpoint: str, *, token: str | None = None) -> tuple[int, dict]:
    query = urlencode({"course": course})
    return call("GET", f"/metrics/{endpoint}?{query}", token=course if token is None else token)


def common(event_id: str, learner: str, course_lesson: str = LESSON_ID) -> dict:
    return {
        "event_id": event_id,
        "learner_pseudonym": learner,
        "lesson_id": course_lesson,
        "bundle_version": BUNDLE_VERSION,
        "client_timestamp": TIMESTAMP,
    }


def make_main_events() -> list[dict]:
    signals = ["justification", "hypothesis", "question", "counterexample", "synthesis"]
    confidences = [0.9, 0.8, 0.7, 0.6, 0.5]
    completion_rates = [0.5, 0.6, 0.7, 0.8, 0.9]
    score_sources = ["keyword", "keyword", "llm", "llm", "verdict_deck"]
    events: list[dict] = []
    for index in range(5):
        learner = f"synthetic-learner-{index + 1}"
        prefix = f"main-{index + 1}"
        base = common(prefix, learner)
        events.extend(
            [
                {**base, "event_id": f"{prefix}-scene-intro", "type": "scene_completed", "scene_id": "s-intro", "duration_ms": 1000 + index, "success": True},
                {**base, "event_id": f"{prefix}-scene-quiz", "type": "scene_completed", "scene_id": "s-quiz", "duration_ms": 2000 + index, "success": index < 4},
                {**base, "event_id": f"{prefix}-quiz", "type": "quiz_answered", "scene_id": "s-quiz", "item_id": "q1", "correct": index < 3, "response_time_ms": 1500 + index, "confidence": confidences[index]},
                {**base, "event_id": f"{prefix}-critique", "type": "critique_submitted", "scene_id": "s-audit", "llm_score": 0.7, "completion_rate": completion_rates[index], "scene_type": "ai_critique", "score_source": score_sources[index]},
                {**base, "event_id": f"{prefix}-hint", "type": "adaptation_applied", "rule_id": "synthetic-hint-rule", "signal": "hint", "modulator": "scaffolding", "value": 1.0},
                {**base, "event_id": f"{prefix}-reasoning", "type": "reasoning_signal", "scene_id": "s-reasoning", "signal": signals[index], "confidence": 0.8, "turn_index": index},
                {**base, "event_id": f"{prefix}-audit", "type": "ai_audit_result", "scene_id": "s-audit", "planted_errors": 2, "true_positives": 2 if index in (0, 2, 4) else 1, "false_positives": 1 if index == 2 else 0, "missed": 1 if index in (1, 3) else 0, "sound_total": 2},
                {**base, "event_id": f"{prefix}-journal", "type": "journal_entry_submitted", "scene_id": "s-journal", "entry_length": 100 + index * 10, "revision_count": 1 if index < 2 else 0, "is_revision": index < 2},
                {**base, "event_id": f"{prefix}-completed", "type": "lesson_completed", "total_duration_ms": 12000 + index, "autonomy_ratio": 0.5},
                {**base, "event_id": f"{prefix}-vote", "type": "cooperative_vote", "question_id": "synthetic-q", "group_size": 5, "aggregate_only": True},
                {**base, "event_id": f"{prefix}-convergence", "type": "cooperative_convergence", "synthesis_id": f"synthetic-synthesis-{index + 1}", "group_size": 5, "confidence_distribution_aggregated": [0, 0, 0, 2, 3], "role_coverage": 0.8},
            ]
        )
    return events


def assert_close(actual: float, expected: float) -> None:
    assert abs(actual - expected) < 1e-9, (actual, expected)


def main() -> int:
    report_path = Path(sys.argv[1])
    results: dict[str, object] = {
        "base_url": BASE_URL,
        "tokens": {
            "published": MAIN_COURSE,
            "below_floor": SMALL_COURSE,
            "unknown_identity": ANONYMOUS_COURSE,
        },
        "requests": {},
    }

    status, health = call("GET", "/health")
    assert status == 200 and health == {"status": "ok"}
    results["requests"]["health"] = {"status_code": status, "body": health}

    main_events = make_main_events()
    status, body = call("POST", "/telemetry", token=MAIN_COURSE, payload={"events": main_events})
    assert status == 200 and body == {"accepted": 55}
    results["requests"]["seed_published"] = {"status_code": status, "body": body}

    endpoints = [
        "progress", "calibration", "autonomy", "trust-calibration",
        "course-completion", "reasoning", "ai-audit", "journal",
        "cooperation", "scene-breakdown",
    ]
    published: dict[str, dict] = {}
    for endpoint in endpoints:
        status, body = metric(MAIN_COURSE, endpoint)
        assert status == 200
        assert body.get("status") != "suppressed", (endpoint, body)
        published[endpoint] = body
    results["requests"]["published_metrics"] = published

    assert published["progress"]["scenes"]["s-intro"] == {
        "completion_rate": 1.0, "n_graded": 5, "n_ungraded": 0, "n_learners": 5,
    }
    assert published["progress"]["scenes"]["s-quiz"] == {
        "completion_rate": 0.8, "n_graded": 5, "n_ungraded": 0, "n_learners": 5,
    }
    assert_close(published["calibration"]["brier_score"], 0.15)
    assert published["calibration"]["n_items"] == 5
    assert published["calibration"]["judgement"]["cohort_band"] == "5–9"
    assert_close(published["autonomy"]["autonomy_ratio"], 0.5)
    assert_close(published["autonomy"]["critique_completion_rate"], 0.7)
    assert_close(published["autonomy"]["keyword_graded_rate"], 0.4)
    assert published["autonomy"]["n_critique"] == 5
    assert published["autonomy"]["n_hints"] == 5
    assert_close(published["trust-calibration"]["trust_calibration"], 0.1)
    assert published["trust-calibration"]["band"] == "bien"
    assert_close(published["trust-calibration"]["over_trust"], 0.2)
    assert_close(published["trust-calibration"]["over_distrust"], 0.1)
    assert published["course-completion"] == {
        "lessons": {LESSON_ID: {"n_completed": 5}}, "total_completions": 5,
    }
    reasoning_scene = published["reasoning"]["scenes"]["s-reasoning"]
    assert_close(reasoning_scene["score"], 1.0)
    assert reasoning_scene["n_signals"] == 5
    assert published["ai-audit"]["overall_accuracy"] == 0.7
    assert published["journal"]["entries_total"] == 5
    assert published["journal"]["mean_length"] == 120.0
    assert published["journal"]["revision_rate"] == 0.4
    assert published["cooperation"]["n_sessions"] == 5
    assert published["cooperation"]["votes_per_session_mean"] == 1.0
    assert published["cooperation"]["convergence_quality"] == 0.9
    assert published["scene-breakdown"]["ai_critique"] == {
        "n": 5, "mean_completion_rate": 0.7,
    }

    small_events = []
    for index in range(2):
        small_events.append({
            **common(f"small-{index + 1}", f"synthetic-small-{index + 1}"),
            "type": "scene_completed", "scene_id": "s-private",
            "duration_ms": 500, "success": bool(index),
        })
    status, body = call("POST", "/telemetry", token=SMALL_COURSE, payload={"events": small_events})
    assert status == 200 and body == {"accepted": 2}
    results["requests"]["seed_below_floor"] = {"status_code": status, "body": body}

    suppressed: dict[str, dict] = {}
    for endpoint in endpoints:
        status, body = metric(SMALL_COURSE, endpoint)
        assert status == 200
        assert set(body) == {"status", "min_learners", "reason"}, (endpoint, body)
        assert body["status"] == "suppressed" and body["min_learners"] == 5
        assert "Exact counts are withheld." in body["reason"]
        assert "scenes" not in body
        assert "n_learners" not in body
        assert "n_items" not in body
        assert "completion_rate" not in body
        suppressed[endpoint] = body
    results["requests"]["below_floor_metrics"] = suppressed

    anonymous_event = {
        **common("anonymous-1", ""),
        "type": "scene_completed", "scene_id": "s-anonymous",
        "duration_ms": 100, "success": True,
    }
    status, body = call("POST", "/telemetry", token=ANONYMOUS_COURSE, payload={"events": [anonymous_event]})
    assert status == 200 and body == {"accepted": 1}
    results["requests"]["seed_unknown_identity"] = {"status_code": status, "body": body}
    status, body = metric(ANONYMOUS_COURSE, "progress")
    assert status == 200
    assert set(body) == {"status", "min_learners", "reason"}
    assert body["status"] == "suppressed" and body["min_learners"] == 5
    assert body["reason"].startswith("unknown identity:")
    assert "s-anonymous" not in json.dumps(body)
    results["requests"]["unknown_identity_metric"] = {"status_code": status, "body": body}

    invalid_event = dict(anonymous_event)
    invalid_event.pop("learner_pseudonym")
    invalid_event["event_id"] = "missing-pseudonym"
    status, body = call("POST", "/telemetry", token="studium-audit-invalid", payload={"events": [invalid_event]})
    assert status == 422
    results["requests"]["missing_identity_rejected"] = {"status_code": status, "body": body}

    status, body = metric(MAIN_COURSE, "progress", token="wrong-synthetic-token")
    assert status == 403
    results["requests"]["wrong_token"] = {"status_code": status, "body": body}
    path = f"/metrics/progress?{urlencode({'course': MAIN_COURSE})}"
    status, body = call("GET", path)
    assert status == 401
    results["requests"]["missing_token"] = {"status_code": status, "body": body}

    report_path.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "result": "PASS",
        "main_events_accepted": 55,
        "below_floor_events_accepted": 2,
        "anonymous_events_accepted": 1,
        "published_token": MAIN_COURSE,
        "suppressed_token": SMALL_COURSE,
        "anonymous_token": ANONYMOUS_COURSE,
        "report": str(report_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
