from agentic.decision import make_decision, make_insight, make_evidence
from provenance.astra_contract import ASTRA_SCHEMA_VERSION
from provenance.astra_emit import (
    SOURCE_ID_FIELD, emit_astra, baseline_universe, write_astra_yaml, write_universe_yaml,
)


def _decisions():
    return [
        make_decision(decision_id="e1", label="FFT prereq?", rationale="seq",
                      options=[{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}], default="yes"),
        make_decision(decision_id="difficulty", label="Difficulty", rationale="M1",
                      options=[{"id": "standard", "label": "Standard"}, {"id": "remedial", "label": "Remedial"}],
                      default="standard"),
    ]


def test_emit_astra_shape():
    findings = [make_insight(insight_id="e1", claim="FFT requires Fourier basics",
                             created_at="2026-06-10T00:00:00+00:00",
                             evidence=[make_evidence(artifact="doc#sec.2", confidence=0.72)])]
    analysis = emit_astra(analysis_id="course-analysis", name="Signal Processing 101",
                          decisions=_decisions(), prior_insights=[], findings=findings,
                          outputs=[{"id": "lwg", "type": "data"}])
    # The version is the vendored contract's, never a literal re-declared here.
    assert analysis["version"] == ASTRA_SCHEMA_VERSION
    assert analysis["id"] == "course_analysis"  # "course-analysis" is not a valid ASTRA id
    assert "e1" in analysis["decisions"] and "difficulty" in analysis["decisions"]
    assert analysis["findings"]["e1"]["claim"].startswith("FFT requires")
    assert analysis["findings"]["e1"][SOURCE_ID_FIELD] == "e1"


def test_baseline_universe_picks_defaults():
    u = baseline_universe(_decisions())
    assert u["id"] == "baseline"
    assert u["decisions"] == {"e1": "yes", "difficulty": "standard"}


def test_write_astra_and_universe_yaml(tmp_path):
    analysis = emit_astra(analysis_id="a", name="n", decisions=_decisions(),
                          prior_insights=[], findings=[], outputs=[])
    write_astra_yaml(analysis, str(tmp_path))
    write_universe_yaml(baseline_universe(_decisions()), str(tmp_path))
    assert (tmp_path / "astra.yaml").exists()
    assert (tmp_path / "universes" / "baseline.yaml").exists()
    import yaml
    loaded = yaml.safe_load((tmp_path / "astra.yaml").read_text())
    assert loaded["version"] == ASTRA_SCHEMA_VERSION
    loaded_u = yaml.safe_load((tmp_path / "universes" / "baseline.yaml").read_text())
    assert loaded_u["decisions"] == {"e1": "yes", "difficulty": "standard"}
