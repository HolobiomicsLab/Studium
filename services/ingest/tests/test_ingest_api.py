import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

FIXTURE_PDF = os.path.join(
    os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.pdf"
)
FIXTURE_BIB = os.path.join(
    os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.bib"
)


@pytest.fixture
def client():
    from app import app
    return TestClient(app)


def test_ingest_corpus_with_pdf_and_bib(client):
    with open(FIXTURE_PDF, "rb") as pdf_f, open(FIXTURE_BIB, "rb") as bib_f:
        resp = client.post(
            "/ingest/corpus",
            files={
                "pdf": ("sample.pdf", pdf_f, "application/pdf"),
                "bib": ("sample.bib", bib_f, "text/plain"),
            },
            data={"target": "L3", "keywords": "metabolomics"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "manifest_id" in body
    assert "pages_extracted" in body
    assert "references" in body
    assert isinstance(body["references"], list)


def test_ingest_corpus_pdf_only(client):
    with open(FIXTURE_PDF, "rb") as pdf_f:
        resp = client.post(
            "/ingest/corpus",
            files={"pdf": ("sample.pdf", pdf_f, "application/pdf")},
            data={"target": "L3"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "manifest_id" in body


def test_ingest_corpus_missing_pdf_returns_422(client):
    resp = client.post("/ingest/corpus", data={"target": "L3"})
    assert resp.status_code == 422
