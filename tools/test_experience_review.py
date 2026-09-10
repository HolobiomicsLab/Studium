"""The source-linked draft opens through the existing ASTRA/MySTRA reader."""
import json
from pathlib import Path

from experience_packet import check_response, prepare_packet
from experience_review import write_experience_provenance

ROOT = Path(__file__).resolve().parents[1]


def test_review_records_exact_links_without_approval(tmp_path):
    """An actual source capture and draft retain their evidence on the reviewer page."""
    packet = tmp_path / "packet"
    prepare_packet(passages_path=ROOT / "examples/literature-experience/passages.json",
                   output_dir=packet, title="Spectral evidence", target=None)
    review = tmp_path / "review"
    check_response(packet_dir=packet,
                   response_path=ROOT / "examples/literature-experience/author-response.json",
                   output_dir=review)
    write_experience_provenance(review)
    from provenance.astra_read import load_course
    document = load_course(review)
    analysis = next(iter(document.astra["analyses"].values()))
    assert len(analysis["findings"]) == 3
    assert analysis["decisions"]["publication"]["default"] == "draft"
    page = (review / "course_provenance.myst.md").read_text()
    assert "precursor mass" in page
    assert "10.1093/bioinformatics/btaf081" in page
    assert "not scientific or pedagogical approval" in page
    assert json.loads((review / "plan.json").read_text())["validated_by"] is None
