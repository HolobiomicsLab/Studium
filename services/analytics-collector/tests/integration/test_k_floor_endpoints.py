"""The k-anonymity floor on the LIVE collector endpoints (INT-STUDIUM-005).

The floor existed only offline, in `tools/class_report.py`. The collector served class-level
aggregates to the teacher dashboard with no minimum-learner guard at all, so a cohort of one or
two could be read straight off the trust and completion tabs — the deployment was weaker than
the path nobody deploys.

Three decisions carried in from INT-STUDIUM-030 rather than re-opened here:

  * the unit is the LESSON. A pseudonym is HMAC(learnerId:lessonId), so a union across lessons
    counts learner-lesson pairs and cannot lift a lesson over the floor;
  * a suppressed answer states the floor and never the cohort. Publishing the count inverts the
    floor: the only cohorts named exactly would be the ones it exists to protect;
  * the floor is not a caller's option. It is server configuration (`ANALYTICS_MIN_LEARNERS`),
    the same shape as `ANALYTICS_DATA_DIR`; a query parameter would let the reader switch off
    the restraint they are the subject of.

`test_every_class_level_endpoint_applies_the_floor` enumerates the app's own routes instead of
listing them, so an endpoint added tomorrow fails this suite until it is either floored or
exempted here with a reason. That is the INT-STUDIUM-011 lesson: a hand-written list of
surfaces reproduces the gap it was written to close.
"""

import json
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

COURSE = "course-x"

#: Endpoints that are per-learner BY DESIGN, each under its own ADR, and so are not
#: class-level aggregates for a floor to apply to. They carry their own guardrail: a
#: pseudonym is mandatory, which is what stops an accidental inter-student ranking.
EXEMPT = {
    ("GET", "/health"): "not a metric",
    ("POST", "/telemetry"): "ingestion, not a read",
    ("GET", "/metrics/ai-literacy"): "ADR 011 — pseudonyme obligatoire, formative individual read",
    ("POST", "/metrics/blueprint"): "ADR 013 — per-learner formative score, pseudonyme required",
}


def _event(idx: int, lesson: str = "demo", **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef0123{idx:02d}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": lesson,
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
        "type": "scene_completed",
        "scene_id": "s1",
        "success": True,
    }
    base.update(overrides)
    return base


def _seed(data_dir: Path, events: list[dict], course: str = COURSE) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-06-28.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ANALYTICS_MIN_LEARNERS", "5")
    from analytics_collector_app import app
    return TestClient(app), tmp_path


def _get(client, path: str) -> dict:
    r = client.get(f"{path}?course={COURSE}", headers={"X-Course-Token": COURSE})
    assert r.status_code == 200, (path, r.status_code, r.text)
    return r.json()


def test_a_cohort_below_the_floor_is_suppressed_and_its_size_withheld(client):
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(2)])

    body = _get(c, "/metrics/progress")
    assert body["status"] == "suppressed"
    assert body["min_learners"] == 5
    assert "n_learners" not in body
    assert "2" not in body["reason"], body["reason"]
    assert "scenes" not in body, "the aggregate was served alongside the suppression"


def test_a_cohort_at_the_floor_is_served(client):
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(5)])

    body = _get(c, "/metrics/progress")
    assert body.get("status") != "suppressed"
    assert body["scenes"]["s1"]["n_learners"] == 5


def test_the_floor_is_per_lesson_and_a_union_across_lessons_cannot_lift_it(client):
    """Six learners, three in each of two lessons. A course-wide count would read six and
    publish; the pseudonyms are salted per lesson, so those are six learner-lesson pairs and
    no lesson has five people in it."""
    c, data_dir = client
    _seed(data_dir, [_event(i, lesson="l1") for i in range(3)]
                    + [_event(i, lesson="l2") for i in range(3, 6)])

    assert _get(c, "/metrics/progress")["status"] == "suppressed"


def test_an_event_without_an_identity_suppresses_rather_than_guesses(client):
    """No pseudonym or no lesson_id means no cohort can be established. Counting the rest and
    publishing would apply the floor to a population the floor cannot see."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(5)] + [_event(9, learner_pseudonym=None)])
    assert _get(c, "/metrics/progress")["status"] == "suppressed"

    _seed(data_dir, [_event(i) for i in range(5)] + [_event(9, lesson_id=None)])
    assert _get(c, "/metrics/progress")["status"] == "suppressed"


def test_an_empty_course_serves_its_empty_aggregate_rather_than_a_suppression(client):
    """The repair must not delete a real signal to hide a number. There is nobody to protect
    on an empty course, the empty aggregate already says "no data" unambiguously, and turning
    it into `suppressed` would tell an operator with a wrong course token that they had found
    a class too small to report on."""
    c, _ = client
    body = _get(c, "/metrics/progress")
    assert body == {"scenes": {}}


def test_the_floor_is_not_a_query_parameter(client):
    """The reader must not be able to switch off the restraint they are the subject of."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(2)])

    r = c.get(f"/metrics/progress?course={COURSE}&min_learners=1",
              headers={"X-Course-Token": COURSE})
    assert r.status_code == 200
    assert r.json()["status"] == "suppressed"


def test_every_class_level_endpoint_applies_the_floor(client):
    """Discovery, not a list: a new aggregate endpoint fails here until it is floored, or
    named in EXEMPT with the reason it is not a class-level read."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(2)])
    from analytics_collector_app import app

    assert len(EXEMPT) < sum(1 for r in app.routes if isinstance(r, APIRoute)), \
        "everything is exempt; this test proves nothing"
    unguarded = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods & {"GET", "POST"}):
            if (method, route.path) in EXEMPT:
                continue
            r = c.request(method, f"{route.path}?course={COURSE}",
                          headers={"X-Course-Token": COURSE})
            if r.status_code != 200 or r.json().get("status") != "suppressed":
                unguarded.append(f"{method} {route.path} -> {r.status_code} {r.text[:120]}")
    assert not unguarded, "class-level endpoints serving a sub-floor cohort:\n" + "\n".join(unguarded)


def test_the_exempt_endpoints_are_the_ones_an_adr_made_individual(client):
    """EXEMPT is a claim about the app, so it is checked against the app: every exempt path
    must still exist, or the exemption is protecting nothing and hiding a real route."""
    from analytics_collector_app import app

    live = {(m, r.path) for r in app.routes if isinstance(r, APIRoute)
            for m in r.methods & {"GET", "POST"}}
    assert set(EXEMPT) <= live, f"stale exemption(s): {set(EXEMPT) - live}"


def test_the_floor_has_one_definition(client):
    """The constant the offline report and the live endpoints apply is the same object."""
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "tools"))
    import class_report
    import metrics

    assert metrics.MIN_LEARNERS == 5
    assert class_report.MIN_LEARNERS_DEFAULT is metrics.MIN_LEARNERS
