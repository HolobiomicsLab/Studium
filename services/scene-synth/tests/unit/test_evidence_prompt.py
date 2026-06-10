from evidence_prompt import render_evidence_block

EV = {"bibliographic_refs": [
        {"perspicacite_doc_id": "x2024", "title": "Paper X", "doi": "10.1/x",
         "excerpt": "n=3 small sample shows effect", "relevance_score": 0.9},
        {"perspicacite_doc_id": "y2023", "title": "Paper Y", "excerpt": "control group absent"}],
      "enrichment_metadata": {"perspicacite_mode_used": "passages", "degraded": False}}

def test_renders_numbered_sources_with_excerpts_and_cite_instruction():
    block = render_evidence_block(EV)
    assert "[1]" in block and "[2]" in block
    assert "Paper X" in block and "n=3 small sample" in block
    assert "10.1/x" in block            # doi surfaced
    assert "[n]" in block               # citation instruction marker

def test_empty_when_no_evidence():
    assert render_evidence_block(None) == ""
    assert render_evidence_block({}) == ""
    assert render_evidence_block({"bibliographic_refs": []}) == ""
    assert render_evidence_block({"bibliographic_refs": None}) == ""
