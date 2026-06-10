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


from agentic.step import run_agentic_step, AgenticStepResult


def _heuristic_ok(_c): return (0.9, [])
def _heuristic_weak(_c): return (0.3, ["weakly grounded"])


def test_step_admits_and_emits_decision_and_telemetry():
    sink = InMemoryTelemetrySink()
    res = run_agentic_step(
        step_id="edge-fft-fourier",
        label="Is FFT a prerequisite of Fourier basics?",
        rationale="sequencing",
        options=[{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
        chosen_option_id="yes",
        candidate={"relation": "prerequisite_for"},
        heuristic=_heuristic_ok,
        telemetry=sink,
        created_at="2026-06-10T00:00:00+00:00",
    )
    assert isinstance(res, AgenticStepResult)
    assert res.admission.admitted is True and res.quality_flags == []
    assert res.decision["id"] == "edge-fft-fourier" and res.decision["default"] == "yes"
    assert len(sink.records) == 1 and sink.records[0]["event"] == "agentic_step"
    assert sink.records[0]["admitted"] is True
    assert sink.records[0]["chosen_option_id"] == "yes"


def test_step_weak_candidate_kept_with_quality_flags():
    sink = InMemoryTelemetrySink()
    res = run_agentic_step(
        step_id="edge-x", label="x?", rationale="r",
        options=[{"id": "yes", "label": "Yes"}], chosen_option_id="yes",
        candidate={}, heuristic=_heuristic_weak, telemetry=sink,
        created_at="2026-06-10T00:00:00+00:00",
    )
    assert res.admission.flagged_for_review is True
    assert res.quality_flags == ["weakly grounded"]
    assert sink.records[0]["quality_flags"] == ["weakly grounded"]
