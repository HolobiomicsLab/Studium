import pytest


@pytest.fixture
def fixture_dir():
    from pathlib import Path
    return Path(__file__).parent.parent.parent.parent / "fixtures"


@pytest.fixture(autouse=True)
def _floor_off_by_default(monkeypatch):
    """Lower the k-anonymity floor to 1 for the suites that measure FORMULAS (INT-STUDIUM-005).

    Every aggregate endpoint now refuses to serve a class-level number over a cohort below
    `metrics.MIN_LEARNERS` (5). The tests in this tree seed one or two learners because they
    are checking arithmetic — completion rates, calibration bands, trust denominators — and
    reseeding them with five would change what they assert without measuring anything more.

    So the floor is lowered HERE and nowhere else, and it is measured on its own in
    `integration/test_k_floor_endpoints.py`, which sets it explicitly rather than relying on
    a default. If you are adding an endpoint, note that suite's
    `test_every_class_level_endpoint_applies_the_floor`: it enumerates the app's routes, so a
    new aggregate endpoint fails there until it is floored or exempted with a reason.
    """
    monkeypatch.setenv("ANALYTICS_MIN_LEARNERS", "1")
