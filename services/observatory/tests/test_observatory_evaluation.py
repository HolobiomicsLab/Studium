"""The evaluation reader over a run built by the real auditor (INT-STUDIUM-008)."""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from conftest import FREE_TEXT, PSEUDONYMS, RUN_ID
from observatory_discovery import RunRef, SuiteRef
from observatory_evaluation import (
    FORBIDDEN_KEYS,
    PERSONA_SIGNAL_KEYS,
    run_detail,
    scalars_of,
    summarize_run,
    summarize_suite,
)


def _ref(eval_root: Path) -> RunRef:
    return RunRef(RUN_ID, eval_root / RUN_ID)


def _audit(eval_root: Path) -> dict:
    return json.loads((eval_root / RUN_ID / "audit.json").read_text(encoding="utf-8"))


def test_run_summary_from_audit_json(eval_root: Path) -> None:
    audit = _audit(eval_root)
    summary = summarize_run(_ref(eval_root))

    assert summary.id == RUN_ID
    assert summary.corpus_id == audit["corpus_id"]
    assert summary.author_mode == audit["author_mode"]
    assert summary.auditor == audit["auditor"]
    assert summary.overall_score == audit["overall_score"]
    assert summary.n_findings == len(audit["findings"])
    assert summary.timestamp == "20260615-120000"
    assert summary.parsed_from == "audit.json"
    assert summary.unreadable == {}


def test_persona_turns_and_cap_hit(eval_root: Path) -> None:
    personas = {p.name: p for p in summarize_run(_ref(eval_root)).personas}
    assert list(personas) == ["proficient", "struggling"]

    proficient = personas["proficient"]
    assert proficient.turns == 2
    assert proficient.completed is True
    assert proficient.cap_hit is False
    assert proficient.transition_kinds == {"next": 1, "complete": 1}
    assert proficient.event_types["critique_submitted"] == 1
    assert proficient.event_types["lesson_started"] == 1
    assert proficient.first_at == "2026-06-15T12:00:00Z"
    assert proficient.last_at == "2026-06-15T12:05:00Z"

    struggling = personas["struggling"]
    assert struggling.turns == 60
    assert struggling.cap_hit is True
    assert struggling.first_at is None

    raised = {p.name: p for p in summarize_run(_ref(eval_root), max_turns=100).personas}
    assert raised["struggling"].cap_hit is False


def test_detail_has_scores_findings_report_and_flags(eval_root: Path) -> None:
    audit = _audit(eval_root)
    detail = run_detail(_ref(eval_root))

    assert set(detail["dimension_scores"]) == set(audit["dimension_scores"])
    assert detail["findings"] == audit["findings"]
    assert detail["harness_signals"] == audit["harness_signals"]
    assert detail["report_md"] == (eval_root / RUN_ID / "report.md").read_text(encoding="utf-8")
    assert detail["has_author_provenance"] is True
    assert detail["has_refinement_feedback"] is True
    # The allow-list bounds the STRUCTURED persona signals, and that is all this asserts.
    # `final_concept_mastery` is excluded from them, yet `write_report` puts the same
    # number in `report.md` and `run.html` renders that verbatim, so it is on this page
    # by another route. It is a synthetic persona's score, not learner data, and it is on
    # the page by design; crediting the allow-list with hiding it would be false
    # (INT-STUDIUM-018, resolved in favour of the report as the operator sees it).
    assert set(detail["persona_signals"]["proficient"]) <= set(PERSONA_SIGNAL_KEYS)
    assert "final_concept_mastery" not in detail["persona_signals"]["proficient"]
    assert "final concept mastery" in detail["report_md"], "the report no longer states it"


def _keys(value: object):
    """Every mapping key at every depth of a view."""
    if isinstance(value, dict):
        for key, sub in value.items():
            yield key
            yield from _keys(sub)
    elif isinstance(value, (list, tuple)):
        for sub in value:
            yield from _keys(sub)


def test_never_copies_forbidden_fields(eval_root: Path) -> None:
    """The pseudonym and the free text never leave the disk, and no forbidden name is
    ever a key of a view. The forbidden names are checked as keys and not as substrings
    because the auditor legitimately writes `driver_result.json:final_state.concept_states`
    as a finding's evidence path, which points at a file without carrying its content."""
    ref = _ref(eval_root)
    views = [dataclasses.asdict(summarize_run(ref)), run_detail(ref)]
    for view in views:
        assert FORBIDDEN_KEYS.isdisjoint(set(_keys(view)))

    blob = json.dumps(views)
    for secret in (*PSEUDONYMS, *FREE_TEXT):
        assert secret not in blob, secret


def test_scrub_drops_a_forbidden_key_added_upstream(eval_root: Path) -> None:
    """A forbidden key appearing in a future audit.json is dropped, not rendered."""
    audit_path = eval_root / RUN_ID / "audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit["harness_signals"]["learner_id"] = "leak-2b7c"
    audit["findings"][0]["payload"] = {"text": "leak-3f19"}
    audit_path.write_text(json.dumps(audit), encoding="utf-8")

    detail = run_detail(_ref(eval_root))
    assert "learner_id" not in detail["harness_signals"]
    assert "payload" not in detail["findings"][0]
    assert "leak-2b7c" not in json.dumps(detail)
    assert "leak-3f19" not in json.dumps(detail)


def test_unreadable_audit_falls_back_to_dirname(tmp_path: Path) -> None:
    run = tmp_path / "02-claude-20260101-000000"
    (run / "sessions").mkdir(parents=True)
    (run / "audit.json").write_text("{not json", encoding="utf-8")

    summary = summarize_run(RunRef(run.name, run))
    assert summary.parsed_from == "dirname"
    assert summary.corpus_id == "02"
    assert summary.author_mode == "claude"
    assert summary.timestamp == "20260101-000000"
    assert summary.unreadable["audit.json"].startswith("unreadable:")
    assert summary.overall_score is None
    assert summary.personas == ()

    detail = run_detail(RunRef(run.name, run))
    assert detail["findings"] == []
    assert detail["report_md"] is None
    assert detail["has_author_provenance"] is False


def test_suite_summaries(validity_root: Path) -> None:
    with_result = summarize_suite(SuiteRef("suite_with_result", validity_root / "suite_with_result"))
    assert with_result["title"] == "EV-1 — Suite with result"
    assert [r["file"] for r in with_result["results"]] == ["external_result.json", "reports/2026.json"]
    assert with_result["results"][0]["scalars"] == {
        "n": 12, "qwk": 0.71, "ok": True, "nested": "<dict, 1 keys>"}
    assert with_result["results"][0]["mtime"]
    assert "reason" not in with_result

    empty = summarize_suite(SuiteRef("suite_empty", validity_root / "suite_empty"))
    assert empty["title"] == "EV-2 — Suite without result"
    assert empty["results"] == []
    assert empty["reason"] == "no result file"


def test_scalars_of_reduces_containers() -> None:
    assert scalars_of({"a": 1, "b": "x", "c": None, "d": [1, 2, 3], "e": {"k": 1}}) == {
        "a": 1, "b": "x", "c": None, "d": "<list, 3 items>", "e": "<dict, 1 keys>"}


def test_scalars_of_drops_forbidden_keys() -> None:
    """A validity result is the one artifact the Observatory does not author.

    `scalars_of` copies every top-level key of it onto `/eval/validity` and, through
    the index view, onto the front page. The module says `FORBIDDEN_KEYS` is stripped
    from every blob copied out of an artifact; this is the blob that was exempt
    (INT-STUDIUM-018).
    """
    view = scalars_of({"n": 12, "text": "SECRET-VALIDITY-NOTE", "learner_pseudonym": "p-1",
                       "nested": {"payload": {"a": 1}, "kept": 2}})

    assert view == {"n": 12, "nested": "<dict, 1 keys>"}
    # The count describes what a view would carry, not what the file holds: the nested
    # `payload` is gone before the container is described.
    assert "SECRET-VALIDITY-NOTE" not in json.dumps(view)
