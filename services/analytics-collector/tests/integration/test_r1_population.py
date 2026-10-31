"""R1 on the live endpoints (INT-STUDIUM-030, stage 2).

R2 asked whether a surface can be narrowed to one person. R1 asks a different question of the
same numbers: *which population is this number about?* Its three parts are

  1. every published number names the population it was computed over;
  2. that population is counted by exactly one rule;
  3. the rule operates inside one lesson.

`cohort_state` (INT-STUDIUM-005) already answers a coarser version at the wire: it refuses the
whole course when any lesson is under the floor. What it cannot see is that a metric is often
computed over a NARROWER population than the cohort it checked. A per-scene trust row is a
reading over the learners who audited that scene, and a class of thirty can have one of them.
The floor passed; the row is one person's judgement under a scene's name.

So each judgement metric here carries its own population, accumulated at the point where the
number is computed rather than re-derived from a second predicate, and each per-scene row is
floored over its own contributors. The population is published as a BAND, and what was
withheld as a FLAG — never a count. Both for the same reason: an exact number moves once per
contributor, and each move is an event a reader holding the roster can time against it.

The floor is set explicitly in this file rather than inherited from `tests/conftest.py`, which
lowers it to 1 for the suites that measure formulas. A privacy test that runs with the floor
switched off measures nothing.
"""

import json
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

COURSE = "course-r1"

#: Endpoints whose numbers are PARTICIPATION, not judgement — counts of what happened, which
#: call 1 of INT-STUDIUM-030 resolved may stay exact. Each needs its reason, and a new endpoint
#: fails the discovery test below until it is either given a population or classified here.
#: The two individual-by-design reads carry their own guardrail (a mandatory pseudonym under
#: their ADR) and are not class-level aggregates at all.
PARTICIPATION = {
    ("GET", "/health"): "not a metric",
    ("POST", "/telemetry"): "ingestion, not a read",
    ("GET", "/metrics/progress"): "how many reached each scene — a count, not a reading of anyone",
    ("GET", "/metrics/course-completion"): "distinct completers per lesson — a count",
    ("GET", "/metrics/scene-breakdown"): "engagement counts per scene type",
    ("GET", "/metrics/journal"): "journal activity counts, no free text",
    ("GET", "/metrics/cooperation"): "peer-room activity counts",
    ("GET", "/metrics/concept-mastery-history"): "withdrawn surface (INT-STUDIUM-030) — reports unavailable",
    ("GET", "/metrics/ai-literacy"): "ADR 011 — pseudonyme obligatoire, formative individual read",
    ("POST", "/metrics/blueprint"): "ADR 013 — per-learner formative score, pseudonyme required",
}


def _event(idx: int, lesson: str = "l1", **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef0123{idx:02d}",
        "learner_pseudonym": f"hmac:{lesson}:{idx}",
        "lesson_id": lesson,
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
        "type": "scene_completed",
        "scene_id": "s1",
        "success": True,
    }
    base.update(overrides)
    return base


def _audit(idx: int, scene: str, lesson: str = "l1", **overrides) -> dict:
    return _event(idx, lesson=lesson, type="ai_audit_result", scene_id=scene,
                  planted_errors=2, missed=1, false_positives=0, sound_total=2, **overrides)


def _quiz(idx: int, lesson: str = "l1", **overrides) -> dict:
    return _event(idx, lesson=lesson, type="quiz_answered", confidence=0.8, correct=True,
                  **overrides)


def _reasoning(idx: int, scene: str, lesson: str = "l1", **overrides) -> dict:
    return _event(idx, lesson=lesson, type="reasoning_signal", scene_id=scene,
                  signal="justification", **overrides)


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


# --------------------------------------------------------------------------------------
# 1. every published number names the population it was computed over
# --------------------------------------------------------------------------------------

def test_every_judgement_endpoint_publishes_the_population_it_was_computed_over(client):
    """Discovery, not a list — the INT-STUDIUM-011 lesson. A new endpoint fails here until it
    either names its population or is classified in PARTICIPATION with a reason."""
    c, data_dir = client
    _seed(data_dir, [_quiz(i) for i in range(6)]
                    + [_audit(i, "s1") for i in range(6)]
                    + [_reasoning(i, "s1") for i in range(6)])
    from analytics_collector_app import app

    assert len(PARTICIPATION) < sum(1 for r in app.routes if isinstance(r, APIRoute)), \
        "everything is classified as participation; this test proves nothing"
    unnamed = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods & {"GET", "POST"}):
            if (method, route.path) in PARTICIPATION:
                continue
            body = c.request(method, f"{route.path}?course={COURSE}",
                             headers={"X-Course-Token": COURSE}).json()
            if not isinstance(body, dict) or "judgement" not in body:
                unnamed.append(f"{method} {route.path} -> {sorted(body)[:8]}")
    assert not unnamed, "judgement endpoints publishing a number over an unnamed population:\n" \
                        + "\n".join(unnamed)


@pytest.mark.parametrize("n, band", [(5, "5–9"), (9, "5–9"),
                                     (12, "10–19"), (24, "20+")])
def test_a_judgement_population_is_published_as_a_band(client, n, band):
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(n)])
    assert _get(c, "/metrics/trust-calibration")["judgement"]["cohort_band"] == band


def test_the_band_moves_twice_where_an_exact_count_moves_every_contributor(client):
    """The property the band exists for. Five reads at five different cohort sizes; an exact
    count would print five different numbers, each move timeable against the roster."""
    c, data_dir = client
    bands = []
    for n in (5, 6, 7, 8, 9):
        _seed(data_dir, [_audit(i, "s1") for i in range(n)])
        bands.append(_get(c, "/metrics/trust-calibration")["judgement"]["cohort_band"])
    assert set(bands) == {"5–9"}, bands


def test_the_population_is_the_metrics_own_contributors_not_the_course_cohort(client):
    """Twenty-four learners on the course; six of them audited anything. The trust number is
    a reading over those six, and says six, not twenty-four."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(24)] + [_audit(i, "s1") for i in range(6)])
    assert _get(c, "/metrics/trust-calibration")["judgement"]["cohort_band"] == "5–9"


def test_a_number_computed_over_nobody_says_so_rather_than_borrowing_a_cohort(client):
    """An absent value is a measurement that says so. The course has a cohort; this metric
    has no contributors, and the two must not be confused."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)])
    body = _get(c, "/metrics/calibration")          # no quiz_answered anywhere
    assert body["brier_score"] is None
    assert body["judgement"]["cohort_band"] is None
    assert "over nobody" in body["judgement"]["cohort_counts"]


# --------------------------------------------------------------------------------------
# 2 + 3. one rule, inside one lesson
# --------------------------------------------------------------------------------------

def test_a_union_across_lessons_is_named_as_pairs_and_never_as_learners(client):
    """A pseudonym is HMAC(learnerId:lessonId). Across two lessons the same human holds two,
    so the union counts learner-lesson pairs — and the payload says which unit it counted
    rather than calling both "learners"."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1", lesson="l1") for i in range(6)]
                    + [_audit(i, "s1", lesson="l2") for i in range(6, 12)])
    counts = _get(c, "/metrics/trust-calibration")["judgement"]["cohort_counts"]
    assert counts == "learner-lesson pairs across the lessons in scope"


def test_one_lesson_counts_people(client):
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)])
    assert _get(c, "/metrics/trust-calibration")["judgement"]["cohort_counts"] == \
        "distinct learners within one lesson"


# --------------------------------------------------------------------------------------
# the per-population floor: the gap `cohort_state` cannot see
# --------------------------------------------------------------------------------------

def test_a_scene_audited_by_one_person_is_not_published(client):
    """The defect this stage exists for. The course cohort clears the floor, so `cohort_state`
    serves the endpoint; inside it, one scene was audited by one learner and its row is that
    learner's over-trust under a scene's name."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)] + [_audit(0, "s2")])
    body = _get(c, "/metrics/trust-calibration")
    assert [row["scene_id"] for row in body["per_scene"]] == ["s1"]
    assert body["withheld_below_floor"] is True


def test_a_reasoning_scene_below_the_floor_is_not_published(client):
    c, data_dir = client
    _seed(data_dir, [_reasoning(i, "s1") for i in range(6)] + [_reasoning(0, "s2")])
    body = _get(c, "/metrics/reasoning")
    assert list(body["scenes"]) == ["s1"]
    assert body["withheld_below_floor"] is True


def test_the_withheld_flag_does_not_encode_how_many(client):
    """One withheld scene and three withheld scenes produce the same payload. A count here
    would be monotone in the size of the class and read against a roster — the same reason the
    suppressed answer states the floor and never the cohort.

    This is the assertion that caught the R1 build on the Observatory: the counts had been
    taken out of the payload and left in the prose beside it, where they were exactly as
    readable. It is written as a property, not as "the key is gone", for that reason."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)] + [_audit(0, "s2")])
    one = _get(c, "/metrics/trust-calibration")
    _seed(data_dir, [_audit(i, "s1") for i in range(6)]
                    + [_audit(0, "s2"), _audit(1, "s3"), _audit(2, "s4")])
    three = _get(c, "/metrics/trust-calibration")
    assert one == three
    assert not [k for k in one if k.startswith("n_withheld")]
    for value in one.values():
        assert not (isinstance(value, str) and any(ch.isdigit() for ch in value)), value


def test_an_overall_gap_over_a_single_audited_learner_is_withheld_and_says_why(client):
    """The whole course clears the floor on `scene_completed`; exactly one learner audited
    anything. The mean over scorable scenes is then that one person's gap, so it is not
    published — and the refusal says which population fell short, not how far."""
    c, data_dir = client
    _seed(data_dir, [_event(i) for i in range(24)] + [_audit(0, "s1")])
    body = _get(c, "/metrics/trust-calibration")
    assert body["trust_calibration"] is None
    assert body["per_scene"] == []
    assert body["withheld_below_floor"] is True
    assert "fewer than the floor" in body["reason"]


def test_the_floor_is_not_lifted_by_asking_for_it(client):
    """`floor` is a server-side argument of the computation, not a query parameter. The
    reader must not be able to switch off the restraint they are the subject of."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)] + [_audit(0, "s2")])
    r = c.get(f"/metrics/trust-calibration?course={COURSE}&floor=0",
              headers={"X-Course-Token": COURSE})
    assert r.status_code == 200
    assert [row["scene_id"] for row in r.json()["per_scene"]] == ["s1"]


def test_the_default_floor_withholds_so_a_forgotten_argument_cannot_disclose(tmp_path,
                                                                             monkeypatch):
    """The unit tests read the raw formulas with `floor=0`. That is only safe while the
    DEFAULT is the publishable one: a caller who forgets the argument must withhold.

    The floor is set here rather than inherited: `tests/conftest.py` lowers it to 1 for the
    formula suites, and a default-value test that runs against a lowered default is measuring
    the fixture."""
    import metrics
    monkeypatch.setenv("ANALYTICS_MIN_LEARNERS", "5")
    _seed(tmp_path, [_audit(0, "s1")])
    raw = metrics.compute_trust_calibration(tmp_path, COURSE, floor=0)
    assert raw["per_scene"][0]["gap"] == 0.5
    default = metrics.compute_trust_calibration(tmp_path, COURSE)
    assert default["per_scene"] == [] and default["trust_calibration"] is None


def test_an_audited_scene_below_the_floor_is_withheld_from_ai_audit_too(client):
    """The same events feed /metrics/ai-audit, where a per-scene accuracy over one auditor is
    the same disclosure under a different name. Repairing one endpoint and not its twin leaves
    the reading available one route away."""
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)] + [_audit(0, "s2")])
    body = _get(c, "/metrics/ai-audit")
    assert [row["scene_id"] for row in body["per_scene"]] == ["s1"]
    assert body["n_scenes"] == 1, "n_scenes counted the withheld scene back into the payload"
    assert body["withheld_below_floor"] is True


def test_the_non_attribution_line_is_one_object_shared_by_every_surface(client):
    """Three surfaces publish these metrics — this endpoint, the Observatory page and
    `tools/class_report.py`. A sentence copied per surface says something different on each of
    them within a release or two, which is how the TS/Py over_distrust drift happened. The
    other two surfaces assert the same identity from their own suites."""
    import metrics
    c, data_dir = client
    _seed(data_dir, [_audit(i, "s1") for i in range(6)])
    for path in ("/metrics/trust-calibration", "/metrics/calibration",
                 "/metrics/autonomy", "/metrics/reasoning", "/metrics/ai-audit"):
        assert _get(c, path)["judgement"]["non_attribution"] == metrics.NON_ATTRIBUTION, path
    # The other two surfaces import this module and assert OBJECT identity from their own
    # suites — the collector runs in its own pytest process and cannot see them from here
    # (INT-STUDIUM-011: one suite, one process).
