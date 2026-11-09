"""Concept-map report: export, page, ASTRA/ARA conformance and verification (synthetic records)."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path

import pytest
import yaml

import concept_map_report as cmr
from learner_report import ReportError

QUOTE = "Une bonne réponse au rattrapage n'était pas créditée."
HIDDEN_QUOTE = "Le budget de détours vaut trois par prérequis."


def scene(scene_id: str, concept: str, kind: str, *, served: bool, released: bool, sources: list[dict] | None = None,
          title: str | None = None) -> dict:
    return {"scene_id": scene_id, "title": title or f"Scène {scene_id}", "type": kind, "concept_ids": [concept],
            "key_class": {"quiz": "author_keyed", "concept": "ungraded", "explain_back": "production"}[kind],
            "served": served, "passages_released": released, "sources": sources or []}


def step(number: int, scene_id: str, concept: str, *, correct: bool | None = None, answered: bool = False,
         assessed_by: str | None = None, kind: str = "advance", rule: str | None = None, returns_to: str | None = None) -> dict:
    navigation = {"kind": kind, "rule_id": rule, **({"returns_to": returns_to} if returns_to else {})}
    return {"step": number, "scene_id": scene_id, "concept_id": concept, "answered": answered, "correct": correct,
            "assessed_by": assessed_by, "navigation": navigation}


def record() -> dict:
    """A three-concept session: a wrong answer, a detour, a right answer; one concept not reached."""
    conversation = {"title": "Conversation avec un assistant IA (tours 1–9)", "origin": "conversation", "license": "private"}
    return {
        "schema": cmr.RECORD_SCHEMA, "generated_at": "2026-11-06T09:30:00.000Z",
        "lesson": {"bundle_id": "self-study-demo", "title": "La porte de prérequis", "language": "fr",
                   "lesson_sha256": "a" * 64},
        "authoring": {"mode": "self_study", "drafted_by": "agent", "validated": False, "judge": False,
                      "approval": {"recorded": False, "matches": False}, "from_conversation": True},
        "session": {"completed": False, "steps": 4},
        "map": {
            "schema": "studium/concept-map/v1", "moment": "on_request", "show": "map", "step": 5,
            "nodes": [
                {"id": "c-porte", "title": "La porte de prérequis", "state": "acquired",
                 "questions": [{"step": 2, "scene_id": "s2", "result": "wrong"}, {"step": 3, "scene_id": "s2", "result": "correct"}],
                 "requires": []},
                {"id": "c-credit", "title": "Créditer un rattrapage", "state": "current", "questions": [], "requires": []},
                {"id": "c-budget", "title": "Limiter les répétitions", "state": "upcoming", "questions": [], "requires": []},
            ],
            "edges": [{"from": "c-porte", "to": "c-credit", "travelled": True},
                      {"from": "c-porte", "to": "c-budget", "travelled": False}],
            "position": {"from": "c-porte", "at": "c-credit", "next": "c-budget"},
            "position_line": "Tu viens de « La porte de prérequis »", "mermaid": "flowchart TD", "display_markdown": "**Carte**",
        },
        "scenes": [
            scene("s1", "c-porte", "concept", served=True, released=True),
            scene("s2", "c-porte", "quiz", served=True, released=True, sources=[{**conversation, "quote": QUOTE}]),
            scene("s3", "c-credit", "concept", served=True, released=True,
                  sources=[{"title": "Guide du routage", "origin": "web", "url": "https://example.org/guide", "quote": "Un détour revient."}]),
            scene("s4", "c-credit", "explain_back", served=False, released=False, sources=[conversation]),
            scene("s5", "c-budget", "quiz", served=False, released=False, sources=[conversation]),
        ],
        "path": [
            step(1, "s1", "c-porte"),
            step(2, "s2", "c-porte", answered=True, correct=False, assessed_by="key", kind="remediate",
                 rule="graph_prereq_gate", returns_to="s3"),
            step(3, "s2", "c-porte", answered=True, correct=True, assessed_by="key", kind="gate_passed",
                 rule="graph_prereq_gate_passed"),
            step(4, "s3", "c-credit"),
        ],
    }


def write(tmp_path: Path, value: dict, name: str = "record.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def class_report(bundle_id: str = "self-study-demo") -> dict:
    def figures(accuracy: float | None, attempts: int) -> dict:
        return {"cohort_band": "10-19" if accuracy is not None else "<5", "n_attempts": attempts, "n_measured": attempts,
                "accuracy": accuracy, "hint_reliance": 0.25, "calibration_gap": 0.2 if accuracy is not None else None,
                "mean_time_s": 61.4}
    return {
        "status": "ok", "course_id": "demo", "bundle_id": bundle_id, "min_learners": 5, "cohort_band": "10-19",
        "data_folder": {"label": "synthetic", "fingerprint": "00000000"}, "completion_rate": 0.7,
        "concepts": [{"concept": "c-porte", "title": "La porte de prérequis", **figures(0.48, 14)},
                     {"concept": "c-credit", "title": "Créditer un rattrapage", **figures(None, 3)}],
        "scenes": [{"scene_id": "s2", "title": "Scène s2", "type": "quiz", "concept": "c-porte", **figures(0.5, 14)}],
        "withheld_below_floor": True, "reteach_priority": ["c-porte"], "not_included": [], "non_attribution": "synthetic",
    }


def test_export_writes_a_verified_package_around_the_exact_record(tmp_path) -> None:
    source = write(tmp_path, record())
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    out = cmr.export_concept_map_report(source, tmp_path / "map", expect_sha256=digest)
    assert (out / cmr.RECORD_PATH).read_bytes() == source.read_bytes()
    assert cmr.verify_concept_map_report(out) == {"ok": True, "astra_validator": "astra-tools", "artifacts": 6, "record_sha256": digest}
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert report["sources"] == [{"id": "concept_map_record", "path": cmr.RECORD_PATH, "sha256": digest,
                                  "origin": "server_export_selected_for_this_report"}]
    assert report["states"] == {"acquired": 1, "to_review": 0, "current": 1, "seen": 0, "upcoming": 1}
    assert report["counts"] == {"concepts": 3, "scenes": 5, "steps": 4, "assessed_answers": 2, "detours": 1,
                                "scenes_with_sources": 4, "passages_quoted": 2}
    assert (report["learning_certification"], report["source_verification"]) == ("not_performed", "not_performed")
    assert report["class_aggregates"] == "not_included" and report["language"] == "fr"


def test_astra_declares_the_record_and_the_choices_and_stays_in_schema(tmp_path) -> None:
    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map")
    document = yaml.safe_load((out / "astra.yaml").read_text(encoding="utf-8"))
    analysis = document["analyses"]["learner_concept_map"]
    assert set(analysis["decisions"]) == {"concept_state_rule", "passage_release", "class_lens"}
    assert analysis["decisions"]["concept_state_rule"]["default"] == "session_facts"
    assert analysis["decisions"]["concept_state_rule"]["options"]["posterior_mastery"]["excluded"] is True
    assert analysis["decisions"]["class_lens"]["default"] == "not_included"
    outputs = {item["id"]: item for item in analysis["outputs"]}
    assert {"concept_map_record", "map_report", "ara_trace", "mystra_report", "browser_map", "report_checks"} <= set(outputs)
    assert hashlib.sha256((out / cmr.RECORD_PATH).read_bytes()).hexdigest() in outputs["concept_map_record"]["description"]
    claims = " ".join(finding["claim"] for finding in analysis["findings"].values())
    assert "certify no learning" in claims and "conversation with an AI assistant" in claims
    # Learner results stay in the declared record: no step, state or answer field inside ASTRA.
    assert not {"path", "states", "correct", "steps"} & set(analysis)
    checks = json.loads((out / "checks.json").read_text(encoding="utf-8"))
    assert checks["astra"] == {"validator": "astra-tools", "astra_spec": "0.0.14", "evidence_resolution": "skipped", "status": "passed"}


def test_trace_holds_one_experiment_per_step_and_a_pivot_per_detour(tmp_path) -> None:
    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map")
    tree = yaml.safe_load((out / "trace/exploration_tree.yaml").read_text(encoding="utf-8"))
    branch = tree["nodes"][0]["children"][-1]
    assert branch["type"] == "question" and branch["source_refs"] == [f"{cmr.RECORD_PATH}#/path"]
    assert [node["type"] for node in branch["children"]] == ["experiment", "experiment", "pivot", "experiment", "experiment"]
    wrong, pivot = branch["children"][1], branch["children"][2]
    assert "concept «La porte de prérequis» (c-porte)" in wrong["title"] and "scene s2 (quiz)" in wrong["title"]
    assert wrong["result"].startswith("answer wrong, assessed by key; then: remediate")
    assert wrong["evidence"] == [f"{cmr.RECORD_PATH}#/path/1"]
    assert (pivot["from"], pivot["to"], pivot["trigger"]) == ("s2", "s2", "graph_prereq_gate; returns to s3")
    page = (out / "index.html").read_text(encoding="utf-8")
    assert f"<code>{wrong['id']}</code>, <code>{pivot['id']}</code>" in page   # the concept links to its trace nodes


def test_page_is_self_contained_and_quotes_only_released_passages(tmp_path) -> None:
    value = record()
    value["scenes"][1]["title"] = 'Quiz <img src=x onerror="alert(1)">'
    out = cmr.export_concept_map_report(write(tmp_path, value), tmp_path / "map")
    page = (out / "index.html").read_text(encoding="utf-8")
    assert "<img" not in page and "Quiz &lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in page
    assert page.count("<script") == 1 and not re.search(r"<(script|link|iframe|object|embed)\b[^>]*\b(src|href|data)=", page)
    script = page.split("<script>", 1)[1].split("</script>", 1)[0]
    digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    assert f"script-src 'sha256-{digest}'" in page and "default-src 'none'" in page
    assert page.count('class="concept-detail"') == 3 and page.count('data-concept="') == 3
    assert 'data-initial="c-credit"' in page
    assert f"<blockquote>{QUOTE.replace(chr(39), '&#x27;')}</blockquote>" in page
    assert page.count("Passage affiché une fois la question quittée.") == 2      # s4 and s5, not yet left
    assert '<a href="https://example.org/guide" rel="noopener noreferrer">Guide du routage</a>' in page
    assert "conversation avec un assistant" in page and "ce que l&#x27;assistant y affirme n&#x27;a pas été vérifié" in page
    assert "Leçon rédigée par l&#x27;IA à partir des sources fournies\u00a0; non relue par un enseignant" in page
    assert 'data-step-button="2" data-goto="c-porte" data-step="2"' in page and "détour par un prérequis" in page
    assert "Aucun rapport de classe n&#x27;est joint" in page
    myst = (out / "course_provenance.myst.md").read_text(encoding="utf-8")
    assert "## Carte des notions" in myst and 'c0["La porte de prérequis · acquise"]' in myst and "c0 -.-> c2" in myst


def test_class_report_feeds_the_teacher_viewpoint_and_withheld_figures_stay_hidden(tmp_path) -> None:
    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map",
                                        class_report_path=write(tmp_path, class_report(), "class.json"))
    assert cmr.verify_concept_map_report(out)["artifacts"] == 7
    kept = json.loads((out / cmr.CLASS_PATH).read_text(encoding="utf-8"))
    assert "data_folder" not in kept and "non_attribution" not in kept           # only the figures shown are copied
    page = (out / "index.html").read_text(encoding="utf-8")
    assert "réussite\u00a0: 48 % · 14 rép." in page and "réussite\u00a0: non affiché · 3 rép." in page
    assert 'class="node state-acquired reteach"' in page and "à reprendre en priorité" in page
    assert "<td>10-19</td><td>14</td><td>48 %</td><td>25 %</td><td>+0.20</td><td>61 s</td>" in page
    assert "plancher de 5 apprenants" in page
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert report["class_aggregates"] == "included_above_floor" and [s["id"] for s in report["sources"]] == ["concept_map_record", "class_report"]
    document = yaml.safe_load((out / "astra.yaml").read_text(encoding="utf-8"))
    assert document["analyses"]["learner_concept_map"]["decisions"]["class_lens"]["default"] == "included_above_floor"


@pytest.mark.parametrize("mutate, message", [
    (lambda r: r.update(learner_id="someone"), "learner_id"),
    (lambda r: r["path"][0].update(scene_id="unknown"), "names a scene"),
    (lambda r: r["map"]["edges"][0].update(to="c-missing"), "edge names a concept"),
    (lambda r: r["session"].update(steps=9), "session.steps"),
    (lambda r: r["scenes"][2]["sources"][0].update(url="javascript:alert(1)"), "url"),
    (lambda r: r["path"][1].update(step=5), "numbered"),
])
def test_a_record_with_an_unknown_field_or_a_broken_reference_is_refused(tmp_path, mutate, message) -> None:
    value = record()
    mutate(value)
    with pytest.raises(ReportError, match=message):
        cmr.export_concept_map_report(write(tmp_path, value), tmp_path / "map")
    assert not (tmp_path / "map").exists()


def test_expected_digest_and_class_report_binding_are_enforced(tmp_path) -> None:
    source = write(tmp_path, record())
    with pytest.raises(ReportError, match="not the file the server wrote"):
        cmr.export_concept_map_report(source, tmp_path / "a", expect_sha256="0" * 64)
    with pytest.raises(ReportError, match="another lesson"):
        cmr.export_concept_map_report(source, tmp_path / "b", class_report_path=write(tmp_path, class_report("other"), "c.json"))
    suppressed = write(tmp_path, {"status": "suppressed", "min_learners": 5, "has_data": True, "reason": "floor"}, "s.json")
    with pytest.raises(ReportError, match="no publishable figure"):
        cmr.export_concept_map_report(source, tmp_path / "c", class_report_path=suppressed)
    cmr.export_concept_map_report(source, tmp_path / "d")
    with pytest.raises(ReportError, match="already exists"):
        cmr.export_concept_map_report(source, tmp_path / "d")


def test_verification_detects_tampering_even_after_a_coherent_rehash(tmp_path) -> None:
    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map")
    page = out / "index.html"
    page.write_text(page.read_text(encoding="utf-8").replace("acquise", "certifiée"), encoding="utf-8")
    with pytest.raises(ReportError, match="artifact hash mismatch: index.html"):
        cmr.verify_concept_map_report(out)

    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map2")
    changed = json.loads((out / cmr.RECORD_PATH).read_text(encoding="utf-8"))
    changed["path"][1]["correct"] = True                     # rewrite the session, then rehash everything
    (out / cmr.RECORD_PATH).write_text(json.dumps(changed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    checks = json.loads((out / "checks.json").read_text(encoding="utf-8"))
    checks["artifacts"][cmr.RECORD_PATH] = hashlib.sha256((out / cmr.RECORD_PATH).read_bytes()).hexdigest()
    (out / "checks.json").write_text(json.dumps(checks), encoding="utf-8")
    with pytest.raises(ReportError, match="report summary does not match"):
        cmr.verify_concept_map_report(out)

    out = cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "map3")
    (out / "sources" / "extra.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ReportError, match="exact report artifacts"):
        cmr.verify_concept_map_report(out)


def test_layout_puts_a_concept_below_its_prerequisites_and_wraps_a_wide_layer() -> None:
    parsed = cmr.ConceptMapRecord.model_validate(record())
    positions, width, height = cmr._layout(parsed)
    assert positions["c-porte"][1] < positions["c-credit"][1] == positions["c-budget"][1]
    assert all(0 <= x and x + cmr.NODE_W <= width and y + cmr.NODE_H <= height for x, y in positions.values())
    flat = record()
    flat["map"]["nodes"] = [{"id": f"c{i}", "title": f"Notion {i}", "state": "upcoming", "questions": [], "requires": []}
                            for i in range(6)]
    flat["map"]["edges"] = []
    flat["map"]["position"] = {"from": None, "at": None, "next": "c0"}
    flat["scenes"], flat["path"], flat["session"] = [], [], {"completed": False, "steps": 0}
    positions, width, _ = cmr._layout(cmr.ConceptMapRecord.model_validate(flat))
    assert len({y for _, y in positions.values()}) == 2 and width == 2 * cmr.PAD + 4 * cmr.NODE_W + 3 * cmr.GAP_X


def test_a_long_edge_goes_round_a_concept_in_between() -> None:
    positions = {"a": (100.0, 40.0), "between": (100.0, 158.0), "b": (100.0, 276.0)}
    lanes = {"left": 0, "right": 0}
    path = cmr._edge_path(positions["a"], positions["b"], positions, 600.0, lanes)
    assert path.startswith("M207 104") and "L10 236" in path          # down the left lane: the source sits on the left half
    assert lanes == {"left": 1, "right": 0}
    assert "L582 236" in cmr._edge_path((300.0, 40.0), (300.0, 276.0), {"x": (300.0, 158.0)}, 600.0, {"left": 0, "right": 1})
    clear = {"a": (100.0, 40.0), "b": (100.0, 158.0)}
    assert "L" not in cmr._edge_path(clear["a"], clear["b"], clear, 414.0, {"left": 0, "right": 0})


def test_english_page_and_cli(tmp_path, capsys) -> None:
    value = record()
    value["lesson"]["language"] = "en"
    source = write(tmp_path, value)
    assert cmr.main(["export", str(source), str(tmp_path / "map")]) == 0
    assert str(tmp_path / "map" / "index.html") in capsys.readouterr().out
    page = (tmp_path / "map" / "index.html").read_text(encoding="utf-8")
    assert '<html lang="en">' in page and "Concept map — La porte de prérequis" in page and "detour through a prerequisite" in page
    assert cmr.main(["verify", str(tmp_path / "map")]) == 0
    assert json.loads(capsys.readouterr().out.splitlines()[0])["ok"] is True
    assert cmr.main(["export", str(source), str(tmp_path / "map")]) == 1
    assert "already exists" in capsys.readouterr().err
    assert cmr.main(["export", str(source), str(tmp_path / "fr"), "--language", "fr"]) == 0
    assert "Carte des notions" in (tmp_path / "fr" / "index.html").read_text(encoding="utf-8")


def test_existing_observatory_serves_the_package_as_mystra_html(tmp_path) -> None:
    """The ASTRA/ARA set opens through the Observatory's MySTRA route, session path included."""
    cmr.export_concept_map_report(write(tmp_path, record()), tmp_path / "concept-map")
    observatory = Path(__file__).resolve().parents[1] / "services/observatory"
    sys.path.insert(0, str(observatory))
    try:
        from fastapi.testclient import TestClient
        from observatory_app import create_app
        from observatory_config import ObservatoryConfig
        cfg = ObservatoryConfig(course_root=tmp_path, courses=(), eval_root=tmp_path / "missing-eval",
                                validity_root=tmp_path / "missing-validity", harness_refresh=0)
        response = TestClient(create_app(cfg)).get("/courses/concept-map/mystra")
    finally:
        sys.path.remove(str(observatory))
    assert response.status_code == 200
    assert "Concept map — La porte de prérequis" in response.text
    assert "Session path: the steps served, in order" in response.text and "Concept state shown on the map" in response.text
