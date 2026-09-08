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

INT-STUDIUM-030 adds the OTHER half of the restraint, and it is structural rather than
numeric: *no surface exposes a control, parameter or route that narrows a published aggregate
to a caller-chosen subset of the cohort.* The two are not alternatives. A floor with a
drill-down behind it is defeated by the drill-down — twenty aggregates over overlapping
subsets reconstruct an individual without any one of them falling under five — and a
drill-down ban with no floor still publishes an aggregate over two people. Each covers the gap
the other leaves, so both are checked here, by the same discovery.
"""

import inspect
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

#: Request parameters that name ONE PERSON. A route is class-level (none of these) or
#: individual by design (one of them, MANDATORY, with its ADR in EXEMPT). The third state —
#: a class-level aggregate that also accepts an optional pseudonym — is the drill-down: the
#: floor is applied to the cohort, and the answer is then narrowed to somebody inside it.
NARROWING = {"learner", "pseudonyme", "learner_pseudonym", "pseudonym"}


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


#: States in which a route publishes no numbers. `suppressed` is the floor answering for this
#: cohort; `unavailable` is a surface withdrawn for every cohort, which the next test pins so
#: the word cannot become a way for an aggregate to skip the floor.
WITHHELD = {"suppressed", "unavailable"}


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
            if r.status_code != 200 or r.json().get("status") not in WITHHELD:
                unguarded.append(f"{method} {route.path} -> {r.status_code} {r.text[:120]}")
    assert not unguarded, "class-level endpoints serving a sub-floor cohort:\n" + "\n".join(unguarded)


def test_an_unavailable_route_is_withdrawn_rather_than_floored(client):
    """`unavailable` is the stronger claim, so it is held to the stronger standard: a route
    that reports it below the floor must report it at twenty-four learners too, and must say
    why. Otherwise the word is a way for an aggregate to answer the floor's discovery test
    without ever meeting the floor."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(24)])
    from analytics_collector_app import app

    withdrawn = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods & {"GET", "POST"}):
            if (method, route.path) in EXEMPT:
                continue
            body = c.request(method, f"{route.path}?course={COURSE}",
                             headers={"X-Course-Token": COURSE}).json()
            if body.get("status") == "unavailable":
                withdrawn.append((method, route.path, body))

    assert withdrawn, "no route is withdrawn; concept-mastery-history was (INT-STUDIUM-030)"
    for method, path, body in withdrawn:
        assert body.get("reason"), f"{method} {path} is unavailable and does not say why"
        assert "concepts" not in body, f"{method} {path} served its rows beside the refusal"


def test_no_class_level_endpoint_narrows_to_a_caller_chosen_person(client):
    """The structural restraint, checked the way the floor is: by DISCOVERY of the app's own
    signatures rather than a list somebody has to remember to update.

    Six routes were in the third state — `calibration` and `trust-calibration` took `learner`,
    `reasoning`, `ai-audit`, `journal` and `concept-mastery-history` took `pseudonyme` — and
    each applied the floor to the COURSE and then handed back one person inside it. The
    dashboard advertised two of them in its own UI copy. (INT-STUDIUM-030, INT-STUDIUM-005)
    """
    from analytics_collector_app import app

    offenders = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        params = set(inspect.signature(route.endpoint).parameters)
        for method in sorted(route.methods & {"GET", "POST"}):
            if (method, route.path) in EXEMPT:
                continue
            if narrowing := sorted(NARROWING & params):
                offenders.append(f"{method} {route.path} accepts {narrowing}")
    assert not offenders, (
        "class-level endpoints that narrow to a caller-chosen person:\n" + "\n".join(offenders)
    )


def test_an_exempt_endpoint_requires_its_pseudonym_rather_than_offering_it(client):
    """EXEMPT's reason IS the guardrail — "pseudonyme obligatoire". An exemption whose
    pseudonym is optional is a drill-down with an ADR number written on it, and it would also
    be a class-level aggregate nobody floored. Checked against the running app, so the two
    remaining individual reads cannot quietly acquire an aggregate mode."""
    c, _ = client
    for (method, path), reason in sorted(EXEMPT.items()):
        if not path.startswith("/metrics/"):
            continue
        r = c.request(method, f"{path}?course={COURSE}",
                      headers={"X-Course-Token": COURSE},
                      json={} if method == "POST" else None)
        assert r.status_code != 200, (
            f"{method} {path} answered without a pseudonym; its exemption ({reason}) rests on "
            "the pseudonym being mandatory"
        )


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
