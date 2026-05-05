import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

FIXTURE_BIB = os.path.join(
    os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.bib"
)


# --- bibtex_parser ---

def test_parse_bibtex_returns_list():
    from bibtex_parser import parse_bibtex
    entries = parse_bibtex(FIXTURE_BIB)
    assert isinstance(entries, list)
    assert len(entries) >= 1


def test_parse_bibtex_entries_have_doi():
    from bibtex_parser import parse_bibtex
    entries = parse_bibtex(FIXTURE_BIB)
    for e in entries:
        assert "doi" in e
        assert "title" in e
        assert "ref_id" in e


def test_parse_bibtex_missing_file_raises():
    from bibtex_parser import parse_bibtex
    with pytest.raises(FileNotFoundError):
        parse_bibtex("/nonexistent/file.bib")


# --- doi_resolver (mode offline/mock) ---

def test_resolve_doi_returns_dict():
    from doi_resolver import resolve_doi
    result = resolve_doi("10.1073/pnas.1319030111", mode="offline")
    assert isinstance(result, dict)
    assert result["doi"] == "10.1073/pnas.1319030111"
    assert result["status"] in ("ok", "offline")


def test_resolve_doi_offline_status():
    from doi_resolver import resolve_doi
    result = resolve_doi("10.9999/fake.doi", mode="offline")
    assert result["status"] == "offline"
