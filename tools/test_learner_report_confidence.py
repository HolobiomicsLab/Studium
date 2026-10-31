"""Regression: optional confidence must not become an invented report value."""
import pytest

from learner_report import export_learner_report, verify_learner_report
from test_learner_report import activity, write_json


@pytest.mark.parametrize("confidence", [None, 0])
def test_optional_confidence_rendering_preserves_missing_and_zero(tmp_path, confidence):
    """A missing rating stays absent; an explicit zero remains visible."""
    trace = activity()
    trace["events"][1]["data"]["confidence"] = confidence
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", trace), out)
    page = (out / "index.html").read_text()
    assert "None/4" not in page
    assert "null/4" not in page
    assert ("confidence 0/4" in page) is (confidence == 0)
    assert verify_learner_report(out)["ok"] is True
