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


def test_re_emitting_an_entry_that_already_has_the_tag_does_not_append_a_second_one():
    """INT-STUDIUM-010 nit 5. `source_edge_id` returns the FIRST matching tag, so a duplicate
    never changed the value read back — it only grew the file, which is the kind of defect
    that stays invisible until someone diffs two emissions of one document and finds them
    unequal. The kept tag is the EXISTING one, carrying the true raw id: on a re-emission the
    entry is keyed by its slug, so appending would have recorded the slug as the raw id."""
    already_tagged = dict(_edge_decision(), id="prereq_obj_fft_obj_fourier",
                          tags=[f"{SOURCE_ID_FIELD}:{_RAW}"])
    _, body = analysis_body(_emit(decisions=[already_tagged]))
    (slug,) = body["decisions"]
    tags = body["decisions"][slug]["tags"]
    assert [t for t in tags if t.startswith(f"{SOURCE_ID_FIELD}:")] == [f"{SOURCE_ID_FIELD}:{_RAW}"]
    assert source_edge_id(body["decisions"][slug], slug) == _RAW


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


# ---------------------------------------------------------------- Task 3: universes + set

import yaml  # noqa: E402

from provenance.astra_emit import baseline_universe, nest_universe, write_astra_set  # noqa: E402
from provenance.universes import pedagogical_decisions, remedial_universe  # noqa: E402


def test_nested_universe_assigns_every_emitted_decision():
    ped = pedagogical_decisions()
    slug, body = analysis_body(_emit(decisions=[_edge_decision(), *ped]))
    u = nest_universe(remedial_universe(ped), slug, body["decisions"])
    selected = u["analyses"][slug]["decisions"]
    assert set(selected) == set(body["decisions"])  # complete: no [MISSING_DECISION]
    assert selected["scaffolding"] == "heavy"  # the universe's own choice wins
    (edge_slug,) = [s for s, d in body["decisions"].items() if source_edge_id(d, s) == _RAW]
    assert selected[edge_slug] == body["decisions"][edge_slug]["default"]
    # A universe keyed by the RAW edge id resolves to the emitted slug.
    raw_keyed = {"id": "u", "description": "d", "decisions": {_RAW: "no"}}
    nested = nest_universe(raw_keyed, slug, body["decisions"])
    assert nested["analyses"][slug]["decisions"][edge_slug] == "no"
    # Two-argument calls are unchanged: the flat selection is wrapped as-is.
    assert nest_universe(raw_keyed, slug)["analyses"][slug]["decisions"] == {_RAW: "no"}


def test_write_astra_set_writes_the_whole_set(tmp_path):
    ped = pedagogical_decisions()
    doc = _emit(decisions=[_edge_decision(), *ped])
    paths = write_astra_set(doc, [baseline_universe(ped), remedial_universe(ped)], tmp_path)
    rel = [p.relative_to(tmp_path).as_posix() for p in paths]
    assert rel == ["astra.yaml", "universes/baseline.yaml", "universes/remedial.yaml",
                   "trace/exploration_tree.yaml"]
    assert all(p.is_file() for p in paths)
    slug, body = analysis_body(doc)
    remedial = yaml.safe_load((tmp_path / "universes" / "remedial.yaml").read_text())
    assert set(remedial["analyses"][slug]["decisions"]) == set(body["decisions"])
    assert remedial["analyses"][slug]["decisions"]["scaffolding"] == "heavy"
