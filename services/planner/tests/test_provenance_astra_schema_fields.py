"""INT-STUDIUM-010: the emitted ASTRA entries are in-schema for astra-spec 0.0.14.

Unit tests for the vendored contract and the emitter. The proof of conformance
is the real validator (test_provenance_astra_validate_cli.py); these tests pin
the shape the emitter must produce so a regression is named, not just red.
"""

from provenance.astra_contract import ASTRA_SCHEMA_VERSION, is_valid_astra_format


def test_contract_pins_0_0_14_and_validates_format_tokens():
    assert ASTRA_SCHEMA_VERSION == "0.0.14"
    assert is_valid_astra_format("json") and is_valid_astra_format("jsonld")
    assert not is_valid_astra_format("application/json") and not is_valid_astra_format("")


# ---------------------------------------------------------------- Task 2: entries

import pytest  # noqa: E402

from agentic.decision import make_decision, make_evidence, make_insight  # noqa: E402
from provenance.astra_emit import (  # noqa: E402
    SOURCE_ID_FIELD, analysis_body, emit_astra, source_edge_id,
)

_RAW = "prereq:obj-fft->obj-fourier"  # a hostile id: colon, hyphens, arrow
_AT = "2026-06-11T00:00:00+00:00"


def _edge_decision(raw: str = _RAW) -> dict:
    return make_decision(decision_id=raw, label="FFT prereq?", rationale="seq",
                         options=[{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}],
                         default="yes")


def _finding(raw: str = _RAW) -> dict:
    return make_insight(insight_id=raw, claim="FFT requires Fourier", created_at=_AT,
                        evidence=[make_evidence(artifact="plan:p1#objectives", quote="q",
                                                confidence=0.4)])


def _emit(**overrides) -> dict:
    kwargs = dict(analysis_id="course-analysis", name="Course", decisions=[_edge_decision()],
                  prior_insights=[], findings=[_finding()],
                  outputs=[{"id": "lwg", "type": "data", "format": "json"}])
    kwargs.update(overrides)
    return emit_astra(**kwargs)


def test_entries_carry_the_raw_id_as_a_tag_and_the_accessor_reads_tag_then_legacy_then_key():
    _, body = analysis_body(_emit())
    (dslug,) = body["decisions"]
    (fslug,) = body["findings"]
    for slug, container in ((dslug, body["decisions"]), (fslug, body["findings"])):
        entry = container[slug]
        assert f"{SOURCE_ID_FIELD}:{_RAW}" in entry["tags"]
        assert SOURCE_ID_FIELD not in entry  # the extension key is gone (extra=forbid)
        assert source_edge_id(entry, slug) == _RAW
    # Back-compatibility: files written with the extension key, then files keyed
    # by the raw id itself (pre-slug).
    assert source_edge_id({"source_edge_id": "legacy:x"}, "k") == "legacy:x"
    assert source_edge_id({}, "k") == "k"


def test_evidence_is_normalised_and_artifacts_become_declared_outputs():
    _, body = analysis_body(_emit())
    (slug,) = body["findings"]
    finding = body["findings"][slug]
    (ev,) = finding["evidence"]
    assert ev["id"] == f"{slug}_ev0"
    assert ev["quote"] == {"exact": "q"}
    assert "confidence" not in ev
    assert finding["notes"] == f"{slug}_ev0: confidence=0.4"
    outputs = {o["id"]: o for o in body["outputs"]}
    assert list(outputs)[0] == "lwg"  # the given outputs stay first, grounding after
    assert ev["artifact"] == "artifact_plan_p1_objectives"
    assert outputs["artifact_plan_p1_objectives"]["format"] == "json"
    assert all(is_valid_astra_format(o["format"]) for o in body["outputs"])
    with pytest.raises(ValueError):
        _emit(outputs=[{"id": "lwg", "type": "data", "format": "application/json"}])


def test_sub_analysis_declares_inputs():
    _, body = analysis_body(_emit())
    assert body["inputs"][0]["id"] == "course_manifest"
    custom = [{"id": "lesson_bundle", "type": "data", "description": "x"}]
    _, body = analysis_body(_emit(inputs=custom))
    assert body["inputs"] == custom
