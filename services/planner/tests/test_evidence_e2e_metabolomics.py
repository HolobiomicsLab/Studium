"""Integration E2E : pipeline /plan sur fixture demo-metabolomics avec enrichment."""
import sys
import os

_PLANNER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PLANNER_DIR not in sys.path:
    sys.path.insert(0, _PLANNER_DIR)

import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from planner_app import app


FIXTURE_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "fixtures" / "m3" / "demo-metabolomics"


def test_e2e_plan_with_evidence_on_metabolomics_fixture(monkeypatch):
    """Pipeline /plan sur fixture métabolomique avec STUDIUM_EVIDENCE_ENRICH=on."""
    monkeypatch.setenv("STUDIUM_EVIDENCE_ENRICH", "on")

    fake_response = {
        "status": "ok",
        "docs": [
            {
                "id": "p-msms-1",
                "doi": "10.1234/msms.fixture",
                "title": "MS/MS annotation strategies for E. coli metabolome",
                "authors": ["Nothias, L.-F.", "Wang, M."],
                "year": 2025,
                "excerpt": "Annotation of m/z 286.1 as N-acetyl-L-glutamate in stress response.",
                "relevance_score": 0.92,
            }
        ],
    }
    fake_abs_capsule = MagicMock()
    fake_abs_capsule.rocrate_uri = "urn:abs:rocrate:demo-metabolomics"
    fake_abs_capsule.assets_by_task = {
        "task-msms-001": {
            "spectrum.svg": "<svg><text>mockup</text></svg>"
        }
    }

    with patch("planner_app._get_perspicacite_client") as mp, \
         patch("planner_app._get_abs_reader") as ma:
        mp.return_value = MagicMock(search=MagicMock(return_value=fake_response))
        ma.return_value = MagicMock(get_capsule=MagicMock(return_value=fake_abs_capsule))

        client = TestClient(app)
        response = client.post("/plan", json={
            "manifest_id": "demo-metabolomics",
            "target": "L3",
            "duration_minutes": 45,
            "language": "fr",
            "corpus_refs": [],
        })

    assert response.status_code == 200
    plan = response.json()["lesson_plan"]
    eligible_with_evidence = [
        s for s in plan["scene_outlines"]
        if s["type"] in ("intro", "concept", "simulation", "reproduction")
        and s.get("evidence") is not None
    ]
    assert len(eligible_with_evidence) >= 1, "Au moins une scène éligible doit être enrichie"
    has_biblio = any(
        s.get("evidence", {}).get("bibliographic_refs") for s in eligible_with_evidence
    )
    assert has_biblio, "Au moins une scène doit avoir une bibliographic_ref"
