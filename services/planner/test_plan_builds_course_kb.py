"""Tests: planner calls ensure_course_kb before evidence enrichment (Task 4 — Phase C).

Contract:
  - When STUDIUM_EVIDENCE_ENRICH=on and a non-None perspicacite client is returned,
    planner_app.plan() calls ensure_course_kb(course_id=request.manifest_id, ...)
    before constructing EvidenceEnricher.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from unittest.mock import patch
from fastapi.testclient import TestClient
import planner_app


class _KbSpyClient:
    """Spy client that records ensure_course_kb calls and returns minimal search results."""

    def __init__(self):
        self.ensured = []

    def ensure_course_kb(self, *, course_id, corpus_refs, keywords):
        self.ensured.append(course_id)
        return {"kb_name": f"studium-course-{course_id}", "status": "ready", "added": 1}

    def search(self, *, query, mode, max_results, kb_names=None):
        return {
            "status": "ok",
            "docs": [
                {"id": "d", "title": "T", "authors": [], "relevance_score": 0.5}
            ],
        }


def test_plan_calls_ensure_course_kb_when_enabled(monkeypatch):
    monkeypatch.setenv("STUDIUM_EVIDENCE_ENRICH", "on")
    spy = _KbSpyClient()
    with patch("planner_app._get_perspicacite_client", return_value=spy), \
         patch("planner_app._get_abs_reader", return_value=None):
        client = TestClient(planner_app.app)
        r = client.post(
            "/plan",
            json={
                "manifest_id": "course-42",
                "target": "L3",
                "corpus_refs": [
                    {"ref_id": "r1", "ref_type": "doi", "doi": "10.1/x"}
                ],
            },
        )
    assert r.status_code == 200, r.text
    assert "course-42" in spy.ensured


def test_plan_does_not_call_ensure_course_kb_when_enrich_off(monkeypatch):
    monkeypatch.setenv("STUDIUM_EVIDENCE_ENRICH", "off")
    spy = _KbSpyClient()
    with patch("planner_app._get_perspicacite_client", return_value=spy), \
         patch("planner_app._get_abs_reader", return_value=None):
        client = TestClient(planner_app.app)
        r = client.post(
            "/plan",
            json={"manifest_id": "course-99", "target": "L3", "corpus_refs": []},
        )
    assert r.status_code == 200, r.text
    assert spy.ensured == []


def test_plan_does_not_call_ensure_course_kb_when_client_is_none(monkeypatch):
    monkeypatch.setenv("STUDIUM_EVIDENCE_ENRICH", "on")
    with patch("planner_app._get_perspicacite_client", return_value=None), \
         patch("planner_app._get_abs_reader", return_value=None):
        client = TestClient(planner_app.app)
        r = client.post(
            "/plan",
            json={"manifest_id": "course-99", "target": "L3", "corpus_refs": []},
        )
    assert r.status_code == 200, r.text
