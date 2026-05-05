import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

FIXTURE_PDF = os.path.join(
    os.path.dirname(__file__), "../../../fixtures/m1/sample-corpus/sample.pdf"
)


def test_extract_pdf_returns_expected_keys():
    from pdf_extractor import extract_pdf
    result = extract_pdf(FIXTURE_PDF)
    assert isinstance(result, dict)
    assert "markdown" in result
    assert "metadata" in result
    assert "figures" in result


def test_extract_pdf_markdown_not_empty():
    from pdf_extractor import extract_pdf
    result = extract_pdf(FIXTURE_PDF)
    assert len(result["markdown"]) > 0


def test_extract_pdf_metadata_has_pages():
    from pdf_extractor import extract_pdf
    result = extract_pdf(FIXTURE_PDF)
    assert result["metadata"].get("pages", 0) >= 1


def test_extract_pdf_figures_is_list():
    from pdf_extractor import extract_pdf
    result = extract_pdf(FIXTURE_PDF)
    assert isinstance(result["figures"], list)


def test_extract_pdf_missing_file_raises():
    from pdf_extractor import extract_pdf
    with pytest.raises(FileNotFoundError):
        extract_pdf("/nonexistent/file.pdf")
