import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))

from fastapi.testclient import TestClient

FIXTURE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../fixtures/m2/abs_capsule_minimal")
)


def test_abs_capsule_endpoint_returns_manifest():
    from ingest_app import app
    client = TestClient(app)
    resp = client.post("/ingest/abs-capsule", json={"capsule_path": FIXTURE_PATH})
    assert resp.status_code == 200
    data = resp.json()
    assert "manifest_id" in data
    assert "corpus_refs" in data
    assert any(r["ref_type"] == "abs_capsule" for r in data["corpus_refs"])


def test_abs_capsule_endpoint_doi_in_refs():
    from ingest_app import app
    client = TestClient(app)
    resp = client.post("/ingest/abs-capsule", json={"capsule_path": FIXTURE_PATH})
    assert resp.status_code == 200
    data = resp.json()
    dois = [r.get("doi") for r in data["corpus_refs"]]
    assert "10.1021/acs.analchem.0c04490" in dois
