from agentic.telemetry import InMemoryTelemetrySink, JsonlTelemetrySink
from agentic.decision import make_decision, make_insight, make_evidence, ASTRA_SCHEMA_VERSION


def test_in_memory_sink_collects_records():
    sink = InMemoryTelemetrySink()
    sink.emit({"event": "x"})
    assert sink.records == [{"event": "x"}]


def test_jsonl_sink_appends(tmp_path):
    p = tmp_path / "logs" / "agentic.jsonl"
    sink = JsonlTelemetrySink(str(p))
    sink.emit({"a": 1})
    sink.emit({"b": 2})
    lines = p.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2 and '"a": 1' in lines[0]


def test_make_decision_shape():
    d = make_decision(
        decision_id="edge-fft-fourier",
        label="Is FFT a prerequisite of Fourier basics?",
        rationale="curriculum sequencing",
        options=[{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
        default="yes",
    )
    assert d["id"] == "edge-fft-fourier" and d["default"] == "yes"
    assert set(d["options"].keys()) == {"yes", "no"}


def test_make_evidence_requires_exactly_one_source():
    ev = make_evidence(artifact="teacher-doc:lecture2.pdf#sec.2", page=4, confidence=0.72)
    assert ev["artifact"] and "doi" not in ev
    import pytest
    with pytest.raises(ValueError):
        make_evidence(doi="10.1/x", artifact="a")  # both → error
    with pytest.raises(ValueError):
        make_evidence()  # neither → error


def test_make_insight_shape():
    ev = make_evidence(doi="10.48550/arXiv.1706.03762", confidence=0.9)
    i = make_insight(insight_id="edge-fft-fourier", claim="FFT requires Fourier basics",
                     created_at="2026-06-10T00:00:00+00:00", evidence=[ev])
    assert i["claim"].startswith("FFT requires") and i["evidence"][0]["doi"]
    assert i["id"] == "edge-fft-fourier"
    assert ASTRA_SCHEMA_VERSION == "0.0.10"
