from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import typing
from copy import deepcopy
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import self_study_passages
from experience_packet import (
    SCENE_KEY_CLASS,
    SELF_STUDY_VALIDATED_BY,
    PacketError,
    build_lesson_bundle,
    check_response,
    key_classes_line,
    main,
    placeholder_paths,
    prepare_packet,
)
from lesson_bundle_schema import LessonBundle  # noqa: E402 - importable once experience_packet set the path
from lesson_bundle_schema import SceneType as BundleSceneType  # noqa: E402
from self_study_passages import FetchedReference  # noqa: E402


PASSAGES = {
    "success": True,
    "passages": [
        {
            "text": "Treatment A reduced the signal by 31% relative to control.",
            "source_doi": "10.1000/study",
            "source_url": "https://example.test/study",
            "license_id": "CC-BY-4.0",
            "score": 0.91,
            "kb_name": "demo-kb",
            "title": "Treatment response study",
            "authors": ["A. Researcher"],
            "year": 2025,
        }
    ],
    "attempts": [{"query": "treatment signal"}],
    "refined_query": "Treatment A signal control",
}

DEFAULT_REPLAY_RULE = {
    "id": "rule_2err_replay_concept",
    "when": {"consecutive_errors_same_concept": ">=2"},
    "action": {"kind": "replay_current_scene", "reason": "errors_threshold"},
    "modulator": "M1",
    "explanation_short": "Two errors on this concept: replay the scene with support.",
}


def write_json(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def prepare_basic(tmp_path: Path) -> tuple[Path, str]:
    source = write_json(tmp_path / "passages.json", PASSAGES)
    packet = tmp_path / "packet"
    prepare_packet(
        passages_path=source,
        output_dir=packet,
        title="Interpreting intervention evidence",
        target="M1",
    )
    evidence_id = json.loads((packet / "evidence.json").read_text())["sources"][0][
        "evidence_id"
    ]
    return packet, evidence_id


def valid_response(evidence_id: str) -> dict:
    return {
        "lesson_plan": {
            "schema_version": "1.0",
            "id": "lesson-intervention",
            "title": "Interpreting intervention evidence",
            "language": "en",
            "target": "M1",
            "duration_minutes": 20,
            "learning_objectives": [
                {
                    "id": "objective-1",
                    "description": "Judge whether a conclusion follows from a result.",
                    "bloom_level": "evaluate",
                }
            ],
            "scene_outlines": [
                {
                    "id": "scene-1",
                    "type": "discussion",
                    "title": "Inspect the result",
                    "objective_refs": ["objective-1"],
                    "prov_derived_from": [evidence_id],
                }
            ],
            "corpus_refs": [{"ref_id": evidence_id, "ref_type": "url"}],
            "status": "draft",
            "validated_by": None,
        },
        "source_links": [
            {
                "scene_id": "scene-1",
                "evidence_id": evidence_id,
                "quote": "reduced the signal by 31%",
            }
        ],
        "viewers": [
            {
                "id": "viewer-1",
                "scene_id": "scene-1",
                "source_ids": [evidence_id],
                "goal": "Compare the treatment and control result.",
                "interactions": ["Toggle treatment and control"],
            }
        ],
    }


def test_prepare_captures_live_sources_and_is_deterministic(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    first = tmp_path / "packet-a"
    second = tmp_path / "packet-b"

    prepare_packet(passages_path=source, output_dir=first, title="A title", target="L3")
    prepare_packet(passages_path=source, output_dir=second, title="A title", target="L3")

    for name in ("evidence.json", "author-task.md", "response.schema.json"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
    evidence = json.loads((first / "evidence.json").read_text())
    assert evidence["retrieval"]["refined_query"] == PASSAGES["refined_query"]
    assert evidence["sources"][0]["text"] == PASSAGES["passages"][0]["text"]
    assert len(evidence["sources"][0]["sha256"]) == 64
    assert evidence["capture"]["input_sha256"]


def test_prepare_preserves_selected_asb_card_but_redacts_environment(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    capsule = tmp_path / "capsule"
    card_dir = capsule / "capsules" / "task-1"
    card_dir.mkdir(parents=True)
    write_json(
        card_dir / "task_card.json",
        {
            "task_id": "task-1",
            "title": "Recalculate the treatment effect",
            "research_question": "Does treatment reduce the signal?",
            "finding": "The reported reduction is 31%.",
            "evidence_snippets": [{"text": "reduced the signal by 31%"}],
            "evaluation_strategy": {"checks": ["output exists"]},
            "data_in": [{"description": "Synthetic measurements"}],
            "data_out": [{"description": "Effect estimate"}],
            "reproducibility_tier": "type-checked",
            "executable": {
                "cmd": ["python", "run.py"],
                "timeout_s": 30,
                "env": {"API_TOKEN": "must-not-leak", "MODE": "test"},
            },
        },
    )

    output = tmp_path / "packet"
    prepare_packet(
        passages_path=source,
        output_dir=output,
        title="A title",
        target=None,
        capsule_path=capsule,
        task_id="task-1",
    )

    task = json.loads((output / "evidence.json").read_text())["asb_task"]
    assert task["card"]["finding"] == "The reported reduction is 31%."
    assert task["card"]["executable"]["env_keys"] == ["API_TOKEN", "MODE"]
    assert "env" not in task["card"]["executable"]
    assert "must-not-leak" not in (output / "evidence.json").read_text()
    assert task["card_sha256"]


def test_prepare_rejects_mismatched_capsule_task_without_output(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    capsule = tmp_path / "capsule"
    capsule.mkdir()
    write_json(capsule / "task_card.json", {"task_id": "actual-task", "title": "Task"})
    output = tmp_path / "packet"

    with pytest.raises(PacketError, match="requested ASB task"):
        prepare_packet(
            passages_path=source,
            output_dir=output,
            title="A title",
            target=None,
            capsule_path=capsule,
            task_id="other-task",
        )

    assert not output.exists()


def test_prepare_never_overwrites_an_output_directory(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    output = tmp_path / "packet"
    output.mkdir()
    (output / "mine.txt").write_text("keep me", encoding="utf-8")

    with pytest.raises(PacketError, match="already exists and is not empty"):
        prepare_packet(passages_path=source, output_dir=output, title="A title", target=None)

    assert sorted(path.name for path in output.iterdir()) == ["mine.txt"]


def test_prepare_never_replaces_a_file_with_a_packet(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    output = tmp_path / "packet"
    output.write_text("not a directory", encoding="utf-8")

    with pytest.raises(PacketError, match="already exists"):
        prepare_packet(passages_path=source, output_dir=output, title="A title", target=None)


def test_prepare_fills_an_existing_empty_output_directory(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    output = tmp_path / "packet"
    output.mkdir()

    prepare_packet(passages_path=source, output_dir=output, title="A title", target=None)

    assert sorted(path.name for path in output.iterdir()) == [
        "author-task.md",
        "evidence.json",
        "response.schema.json",
    ]


def test_check_emits_review_artifacts_without_approval_or_bundle(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    output = tmp_path / "checked"

    check_response(packet_dir=packet, response_path=response, output_dir=output)

    assert sorted(path.name for path in output.iterdir()) == [
        "evidence.json",
        "plan.json",
        "review.md",
        "source_links.json",
        "viewers.json",
    ]
    plan = json.loads((output / "plan.json").read_text())
    assert plan["status"] == "draft"
    assert plan["validated_by"] is None
    review = (output / "review.md").read_text()
    assert review.startswith("# Teacher review handoff")
    assert "technical checks only" in review
    assert "A teacher must assess" in review
    links = json.loads((output / "source_links.json").read_text())
    assert links["schema_version"] == "1.0"
    assert links["source_links"][0]["evidence_id"] == evidence_id
    assert not (output / "bundle.json").exists()


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda value: value["lesson_plan"].update(status="approved"), "status must be draft"),
        (
            lambda value: value["lesson_plan"].update(validated_by="Professor Example"),
            "validated_by must be null",
        ),
        (
            lambda value: value["lesson_plan"]["scene_outlines"][0]["objective_refs"].append(
                "objective-invented"
            ),
            "unknown objective",
        ),
        (
            lambda value: value["source_links"][0].update(scene_id="scene-invented"),
            "unknown scene",
        ),
        (
            lambda value: value["source_links"][0].update(evidence_id="evidence-invented"),
            "unknown evidence",
        ),
        (
            lambda value: value["source_links"][0].update(quote="a fabricated quotation"),
            "exact substring",
        ),
        (
            lambda value: value["viewers"][0]["source_ids"].append("evidence-invented"),
            "unknown source",
        ),
        (
            lambda value: value["lesson_plan"]["scene_outlines"][0].update(
                reference_result={"status": "passed"}
            ),
            "execution result",
        ),
    ],
)
def test_check_rejects_unverifiable_claims_before_writing(tmp_path, mutate, message):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    mutate(response_value)
    response = write_json(tmp_path / "response.json", response_value)
    output = tmp_path / "checked"

    with pytest.raises(PacketError, match=message):
        check_response(packet_dir=packet, response_path=response, output_dir=output)

    assert not output.exists()


def test_check_rejects_unknown_plan_corpus_reference(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["corpus_refs"].append(
        {"ref_id": "invented-source", "ref_type": "offline"}
    )
    response = write_json(tmp_path / "response.json", response_value)

    with pytest.raises(PacketError, match="unknown corpus reference"):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda plan: plan["scene_outlines"][0].update(concept_refs=["missing"]),
            "unknown concept",
        ),
        (
            lambda plan: plan["concepts"][0].update(prerequisites=["missing"]),
            "unknown prerequisite",
        ),
    ],
)
def test_check_rejects_unknown_concept_ids(tmp_path, mutate, message):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["concepts"] = [
        {
            "id": "known",
            "title": "Known concept",
            "description": "A declared concept.",
            "bloom_level_target": "understand",
        }
    ]
    mutate(response_value["lesson_plan"])
    response = write_json(tmp_path / "response.json", response_value)

    with pytest.raises(PacketError, match=message):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


def test_check_rejects_asb_task_mismatch(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["scene_outlines"][0]["abs_task_card_id"] = "invented-task"
    response = write_json(tmp_path / "response.json", response_value)

    with pytest.raises(PacketError, match="ASB task"):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


def test_check_never_overwrites_an_output_directory(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    output = tmp_path / "checked"
    output.mkdir()

    with pytest.raises(PacketError, match="--force"):
        check_response(packet_dir=packet, response_path=response, output_dir=output)


def test_check_force_replaces_an_existing_output_directory(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    output = tmp_path / "checked"
    output.mkdir()
    stale = output / "stale.txt"
    stale.write_text("old", encoding="utf-8")

    status = main(
        [
            "check",
            "--packet",
            str(packet),
            "--response",
            str(response),
            "--out",
            str(output),
            "--force",
            "--quiet",
        ]
    )

    assert status == 0
    assert (output / "plan.json").is_file()
    assert not stale.exists()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_doi", "10.1000/forged"),
        ("source_url", "https://attacker.invalid/paper"),
        ("license_id", "proprietary"),
        ("title", "Invented title"),
    ],
)
def test_check_rejects_tampered_source_identity(tmp_path, field, value):
    packet, evidence_id = prepare_basic(tmp_path)
    evidence_path = packet / "evidence.json"
    evidence = json.loads(evidence_path.read_text())
    evidence["sources"][0][field] = value
    write_json(evidence_path, evidence)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))

    with pytest.raises(PacketError, match="source ledger does not match"):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


def test_check_rejects_unrecognized_packet_schema(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    evidence_path = packet / "evidence.json"
    evidence = json.loads(evidence_path.read_text())
    evidence["schema_version"] = "999"
    write_json(evidence_path, evidence)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))

    with pytest.raises(PacketError, match="unsupported packet schema"):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


def embedded_reference(evidence_id: str) -> dict:
    return {
        "perspicacite_doc_id": evidence_id,
        "doi": "10.1000/study",
        "title": "Treatment response study",
        "authors": ["A. Researcher"],
        "year": 2025,
        "excerpt": "reduced the signal by 31%",
        "relevance_score": 0.91,
        "prov_derived_from": evidence_id,
    }


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("doi", "10.1000/forged", "DOI contradicts"),
        ("title", "Invented title", "title contradicts"),
        ("prov_derived_from", "invented-source", "provenance contradicts"),
        ("authors", ["Invented Author"], "authors contradict"),
        ("year", 1999, "year contradicts"),
        ("relevance_score", 0.1, "score contradicts"),
    ],
)
def test_check_rejects_contradictory_embedded_bibliography(
    tmp_path, field, value, message
):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    reference = embedded_reference(evidence_id)
    reference[field] = value
    response_value["lesson_plan"]["scene_outlines"][0]["evidence"] = {
        "bibliographic_refs": [reference],
        "enrichment_metadata": {
            "enricher_version": "experience-packet-1",
            "perspicacite_mode_used": "passages",
            "timestamp": "2026-09-10T00:00:00Z",
            "degraded": False,
        },
    }
    response = write_json(tmp_path / "response.json", response_value)

    with pytest.raises(PacketError, match=message):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"ref_type": "doi", "doi": "10.1000/forged"}, "DOI contradicts"),
        ({"file_path": "/tmp/unrelated.pdf"}, "file path"),
        ({"dct_source": "https://attacker.invalid/paper"}, "source locator contradicts"),
    ],
)
def test_check_rejects_unbound_corpus_locator(tmp_path, changes, message):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["corpus_refs"][0].update(changes)
    response = write_json(tmp_path / "response.json", response_value)

    with pytest.raises(PacketError, match=message):
        check_response(
            packet_dir=packet,
            response_path=response,
            output_dir=tmp_path / "checked",
        )


def test_check_cli_reports_course_summary_and_warnings(tmp_path, capsys):
    passages = deepcopy(PASSAGES)
    passages["passages"][0]["license_id"] = "CC-BY-NC-SA-4.0"
    uncited = deepcopy(passages["passages"][0])
    uncited.update(
        text="An uncited passage.",
        source_doi=None,
        source_url="https://example.test/uncited",
        license_id=None,
        title="Unlicensed source",
    )
    passages["passages"].append(uncited)
    source = write_json(tmp_path / "passages.json", passages)
    packet = tmp_path / "packet"
    prepare_packet(passages_path=source, output_dir=packet, title="A title", target="L1")
    evidence = json.loads((packet / "evidence.json").read_text())
    response_value = valid_response(evidence["sources"][0]["evidence_id"])
    response_value["lesson_plan"]["scene_outlines"][0]["type"] = "simulation"
    response = write_json(tmp_path / "response.json", response_value)
    output = tmp_path / "course"

    status = main(
        ["check", "--packet", str(packet), "--response", str(response), "--out", str(output)]
    )

    stdout = capsys.readouterr().out
    assert status == 0
    assert "Scenes: 1 (simulation: 1)" in stdout
    assert "Concepts: 0" in stdout
    assert "Source links: 1" in stdout
    assert "Passages: 1 cited, 1 uncited" in stdout
    assert evidence["sources"][0]["evidence_id"] in stdout
    assert evidence["sources"][1]["evidence_id"] in stdout
    assert "CC-BY-NC-SA-4.0" in stdout
    assert "WARN: licence contains NC" in stdout
    assert "WARN: licence is unknown or missing" in stdout
    assert "WARN: scene type 'simulation' is not playable" in stdout


def test_check_reports_quote_language_concept_gaps_and_human_review(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    plan = response_value["lesson_plan"]
    plan["language"] = "fr"
    plan["concepts"] = [
        {
            "id": concept_id,
            "title": concept_id,
            "description": concept_id,
            "bloom_level_target": "understand",
        }
        for concept_id in ("explicit", "objective", "skos")
    ]
    plan["learning_objectives"][0]["concept_uris"] = ["objective"]
    plan["scene_outlines"] = [
        {
            **plan["scene_outlines"][0],
            "concept_refs": ["explicit"],
            "notes": "TODO review: confirm the reported 31%.",
        },
        {
            "id": "scene-objective",
            "type": "concept",
            "title": "Objective mapping",
            "objective_refs": ["objective-1"],
            "evidence_override": "skip",
        },
        {
            "id": "scene-skos",
            "type": "concept",
            "title": "SKOS mapping",
            "objective_refs": [],
            "skos_concept_uris": ["concept:skos"],
        },
        {
            "id": "scene-unmapped",
            "type": "discussion",
            "title": "Unmapped scene",
            "objective_refs": [],
        },
        {
            "id": "scene-meta",
            "type": "meta_checkpoint",
            "title": "Checkpoint without a concept, by design",
            "objective_refs": [],
        },
    ]
    response = write_json(tmp_path / "response.json", response_value)
    output = tmp_path / "course"

    status = main(
        ["check", "--packet", str(packet), "--response", str(response), "--out", str(output)]
    )

    stdout = capsys.readouterr().out
    assert status == 0
    assert "Plan language: fr; 1 source quotes verified verbatim in en" in stdout
    assert "WARN: scene 'scene-unmapped' reaches no concept" in stdout
    assert "scene-objective' reaches no concept" not in stdout
    assert "scene-skos' reaches no concept" not in stdout
    assert "scene-meta' reaches no concept" not in stdout  # intro / meta_checkpoint carry none by design
    assert "Not verifiable by quote:" in stdout
    assert "scene-1: TODO review: confirm the reported 31%." in stdout
    assert "scene-objective: evidence_override=skip" in stdout


def test_check_cli_quiet_keeps_single_output_line(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    output = tmp_path / "course"

    status = main(
        [
            "check",
            "--packet",
            str(packet),
            "--response",
            str(response),
            "--out",
            str(output),
            "--quiet",
        ]
    )

    assert status == 0
    assert capsys.readouterr().out == f"{output.resolve()}\n"


def test_check_cli_bad_quote_is_authoring_error_exit_one(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["source_links"][0]["quote"] = "fabricated quote"
    response = write_json(tmp_path / "response.json", response_value)
    output = tmp_path / "course"

    status = main(
        ["check", "--packet", str(packet), "--response", str(response), "--out", str(output)]
    )

    assert status == 1
    output_text = capsys.readouterr().out
    assert "ERROR" in output_text
    assert "scene 'scene-1', link 1" in output_text
    assert 'quote "fabricated quote"' in output_text
    assert "Nearest passage" in output_text
    assert not output.exists()


PLAYABLE_PLAN_SCENES = [
    "intro",
    "concept",
    "quiz",
    "reproduction",
    "discussion",
    "meta_checkpoint",
    "ai_critique",
    "spot_the_flaw",
    "explain_back",
    "comparison",
    "summary_audit",
    "prompt_practice",
    "communication_sim",
    "simulation",
]


@pytest.mark.parametrize("scene_type", PLAYABLE_PLAN_SCENES)
def test_bundle_builds_schema_complete_placeholder_for_each_plan_scene(tmp_path, scene_type):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["concepts"] = [
        {
            "id": "concept-1",
            "title": "Evidence judgment",
            "description": "Judge a claim from evidence.",
            "bloom_level_target": "evaluate",
        }
    ]
    response_value["lesson_plan"]["scene_outlines"][0]["type"] = scene_type
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)

    output = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")

    bundle = json.loads(output.read_text())
    scene = bundle["scenes"][0]
    expected_type = "concept" if scene_type == "simulation" else scene_type
    assert bundle["schema_version"] == "1.4"
    assert scene["type"] == expected_type
    assert scene["objective_refs"] == ["objective-1"]
    assert bundle["rules"] == [DEFAULT_REPLAY_RULE]
    assert bundle["validated_by"] == "DRAFT — not validated"
    assert bundle["validated_at"].endswith("Z")
    assert sum(choice["correct"] for choice in scene.get("choices", [])) <= 1
    if scene_type in {"explain_back", "comparison", "prompt_practice", "communication_sim"}:
        assert scene["key_points"][0]["text"] == response_value["lesson_plan"][
            "learning_objectives"
        ][0]["description"]
    if scene_type == "simulation":
        assert "TODO:" in scene["markdown"]


def test_bundle_preserves_dependent_to_prerequisite_edge_direction(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["concepts"] = [
        {"id": "prereq", "title": "First", "description": "First", "bloom_level_target": "remember"},
        {"id": "dependent", "title": "Second", "description": "Second", "bloom_level_target": "apply"},
    ]
    response_value["lesson_plan"]["learning_workflow_graph"] = {
        "schema_version": "1.0",
        "course_id": "course",
        "nodes": [
            {"id": "concept:prereq", "node_kind": "concept", "title": "First", "bloom_level": "remember"},
            {"id": "concept:dependent", "node_kind": "concept", "title": "Second", "bloom_level": "apply"},
        ],
        "edges": [
            {
                "id": "edge-1",
                "relation": "prerequisite_for",
                "source": "concept:dependent",
                "target": "concept:prereq",
            }
        ],
    }
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)

    output = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")

    edge = json.loads(output.read_text())["learning_workflow_graph"]["edges"][0]
    assert edge["source"] == "concept:dependent"
    assert edge["target"] == "concept:prereq"


def test_bundle_completes_an_existing_graph_from_plan_prerequisites(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["concepts"] = [
        {
            "id": "prereq",
            "title": "First",
            "description": "First",
            "bloom_level_target": "remember",
        },
        {
            "id": "dependent",
            "title": "Second",
            "description": "Second",
            "bloom_level_target": "apply",
            "prerequisites": ["prereq"],
        },
    ]
    response_value["lesson_plan"]["learning_workflow_graph"] = {
        "schema_version": "1.0",
        "course_id": "course",
        "nodes": [
            {
                "id": "concept:prereq",
                "node_kind": "concept",
                "title": "First",
                "bloom_level": "remember",
            }
        ],
        "edges": [],
    }
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)

    output = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")
    graph = json.loads(output.read_text())["learning_workflow_graph"]

    assert {node["id"] for node in graph["nodes"]} == {
        "concept:prereq",
        "concept:dependent",
    }
    assert graph["edges"][0]["source"] == "concept:dependent"
    assert graph["edges"][0]["target"] == "concept:prereq"


def assert_fails_only_on_unfilled_placeholder(lint):
    """A skeleton still holds its TODO fields: the lint must refuse it, and for that reason alone.

    `unfilled_placeholder` is an ERROR (plan W1 step 5), so a generated bundle exits 1 until the
    author fills the fields. Any other ERROR code would be a real defect the skeleton must not carry.
    """
    assert lint.returncode == 1, lint.stdout + lint.stderr
    errors = [line.split() for line in lint.stdout.splitlines() if line.startswith("ERROR  ")]
    assert errors, lint.stdout + lint.stderr
    assert {fields[2] for fields in errors} == {"unfilled_placeholder"}, lint.stdout + lint.stderr


def test_bundle_generates_concept_graph_copies_quiz_notes_and_lints(tmp_path):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    plan = response_value["lesson_plan"]
    plan["concepts"] = [
        {
            "id": "prerequisite",
            "title": "Prerequisite",
            "description": "Learn this first.",
            "bloom_level_target": "remember",
        },
        {
            "id": "dependent",
            "title": "Dependent",
            "description": "Build on the prerequisite.",
            "bloom_level_target": "apply",
            "prerequisites": ["prerequisite"],
        },
    ]
    plan["scene_outlines"] = [
        {
            **plan["scene_outlines"][0],
            "type": "quiz",
            "title": "Prerequisite quiz",
            "concept_refs": ["prerequisite"],
            "notes": "Which result establishes the prerequisite?",
        },
        {
            "id": "scene-2",
            "type": "summary_audit",
            "title": "Dependent audit",
            "objective_refs": ["objective-1"],
            "concept_refs": ["dependent"],
        },
    ]
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)

    output = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")
    bundle = json.loads(output.read_text())

    assert [scene["concept_refs"] for scene in bundle["scenes"]] == [
        ["prerequisite"],
        ["dependent"],
    ]
    assert bundle["scenes"][0]["question"] == "Which result establishes the prerequisite?"
    assert {node["id"] for node in bundle["learning_workflow_graph"]["nodes"]} == {
        "concept:prerequisite",
        "concept:dependent",
    }
    assert bundle["learning_workflow_graph"]["edges"] == [
        {
            "id": "prerequisite:dependent:prerequisite",
            "relation": "prerequisite_for",
            "source": "concept:dependent",
            "target": "concept:prerequisite",
        }
    ]
    lint = subprocess.run(
        ["node", str(TOOLS / "bundle_lint.mjs"), str(output)],
        cwd=TOOLS.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    assert_fails_only_on_unfilled_placeholder(lint)


def test_bundle_no_default_rules_opt_out(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)
    output = tmp_path / "lesson.json"

    status = main(
        [
            "bundle",
            "--course",
            str(course),
            "--out",
            str(output),
            "--no-default-rules",
        ]
    )

    assert status == 0
    assert json.loads(output.read_text())["rules"] == []
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("Remaining placeholders: ")
    assert lines[1] == str(output.resolve())


def test_bundle_force_replaces_existing_output_file(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)
    output = write_json(tmp_path / "lesson.json", {"old": True})

    refused = main(["bundle", "--course", str(course), "--out", str(output)])
    refused_output = capsys.readouterr()
    assert refused == 2
    assert "--force" in refused_output.err
    assert json.loads(output.read_text()) == {"old": True}

    forced = main(
        ["bundle", "--course", str(course), "--out", str(output), "--force"]
    )

    assert forced == 0
    assert json.loads(output.read_text())["schema_version"] == "1.4"


def test_bundle_cli_refuses_validator_name_while_placeholders_remain(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["scene_outlines"][0]["type"] = "concept"
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)
    output = tmp_path / "lesson.json"

    status = main(
        [
            "bundle",
            "--course",
            str(course),
            "--out",
            str(output),
            "--validated-by",
            "Prof. Example",
        ]
    )

    captured = capsys.readouterr()
    assert status == 2
    assert "remaining placeholder" in captured.err
    assert "use approve after filling" in captured.err
    assert not output.exists()


def test_bundle_cli_reports_output_write_failure_without_traceback(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)
    blocked_parent = tmp_path / "blocked"
    blocked_parent.write_text("not a directory")

    status = main(
        ["bundle", "--course", str(course), "--out", str(blocked_parent / "lesson.json")]
    )

    captured = capsys.readouterr()
    assert status == 2
    assert "cannot write LessonBundle" in captured.err
    assert "Traceback" not in captured.err


SELF_STUDY_URL = "https://example.test/rules-of-method"
# Saved 2026-10-30 from fr.wikisource.org (Durkheim 1895, public domain); inert test data.
DURKHEIM_PAGE = TOOLS / "fixtures" / "self-study" / "durkheim-ch1.html"
SELF_STUDY_PARAGRAPHS = [
    "Social facts are ways of acting, thinking and feeling that exist outside the individual "
    "consciousness and are endowed with a power of coercion by which they impose themselves upon "
    "the individual, whether or not the individual consents to them.",
    "The first and most fundamental rule is to consider social facts as things, which means that "
    "the sociologist must approach them from the outside, through their observable manifestations, "
    "and not through the ideas that people already hold of them.",
    "A rule of evidence follows: every preconception must be systematically discarded, because the "
    "notions formed in everyday life were made for practical ends and not for science, so they stand "
    "between the observer and the facts that must be described.",
]
EXPECTED_KEY_CLASSES = {
    "intro": "ungraded",
    "concept": "ungraded",
    "meta_checkpoint": "ungraded",
    "quiz": "author_keyed",
    "spot_the_flaw": "author_keyed",
    "explain_back": "production",
    "comparison": "production",
    "summary_audit": "production",
    "prompt_practice": "production",
    "communication_sim": "production",
    "discussion": "production",
    "ai_critique": "production",
    "reproduction": "externally_grounded",
}


def self_study_page() -> bytes:
    body = "".join(f"<p>{paragraph}</p>" for paragraph in SELF_STUDY_PARAGRAPHS)
    return (
        "<html><head><title>Ignored tab title</title></head><body><nav>Menu</nav>"
        f"<main>{body}</main><footer>Footer</footer></body></html>"
    ).encode("utf-8")


def self_study_response(evidence_ids: list[str]) -> dict:
    first, second = evidence_ids[:2]
    return {
        "lesson_plan": {
            "schema_version": "1.0",
            "id": "self-study-rules",
            "title": "Rules of method",
            "language": "en",
            "target": "L1",
            "duration_minutes": 15,
            "learning_objectives": [
                {
                    "id": "objective-1",
                    "description": "Explain why social facts are treated as things.",
                    "bloom_level": "understand",
                }
            ],
            "concepts": [
                {
                    "id": "social-fact",
                    "title": "Social fact",
                    "description": "A way of acting that constrains the individual.",
                    "bloom_level_target": "understand",
                }
            ],
            "scene_outlines": [
                {
                    "id": "scene-intro",
                    "type": "intro",
                    "title": "What a social fact is",
                    "objective_refs": ["objective-1"],
                    "prov_derived_from": [first],
                },
                {
                    "id": "scene-quiz",
                    "type": "quiz",
                    "title": "Recognise a social fact",
                    "objective_refs": ["objective-1"],
                    "concept_refs": ["social-fact"],
                    "prov_derived_from": [first],
                },
                {
                    "id": "scene-explain",
                    "type": "explain_back",
                    "title": "Explain the first rule",
                    "objective_refs": ["objective-1"],
                    "concept_refs": ["social-fact"],
                    "prov_derived_from": [second],
                },
            ],
            "corpus_refs": [{"ref_id": ref, "ref_type": "offline"} for ref in (first, second)],
            "status": "draft",
            "validated_by": None,
        },
        "source_links": [
            {"scene_id": "scene-intro", "evidence_id": first, "quote": "ways of acting, thinking and feeling"},
            {"scene_id": "scene-quiz", "evidence_id": first, "quote": "endowed with a power of coercion"},
            {"scene_id": "scene-explain", "evidence_id": second, "quote": "consider social facts as things"},
        ],
    }


def checked_course(tmp_path: Path) -> Path:
    packet, evidence_id = prepare_basic(tmp_path)
    response = write_json(tmp_path / "response.json", valid_response(evidence_id))
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)
    return course


@pytest.mark.parametrize("sources", [[], ["--text", "notes.txt", "--html", "page.html"]])
def test_passages_cli_takes_exactly_one_source(tmp_path, sources):
    output = tmp_path / "passages.json"

    with pytest.raises(SystemExit) as exit_info:
        main(["passages", *sources, "--title", "T", "--out", str(output)])

    assert exit_info.value.code == 2
    assert not output.exists()


def test_passages_cli_requires_a_title(tmp_path):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")

    with pytest.raises(SystemExit) as exit_info:
        main(["passages", "--text", str(reference), "--out", str(tmp_path / "passages.json")])

    assert exit_info.value.code == 2


def test_passages_from_a_url_reach_prepare_with_their_url_and_licence(tmp_path, monkeypatch, capsys):
    fetched = FetchedReference(media_type="text/html", body=self_study_page(), encoding="utf-8")
    monkeypatch.setattr(self_study_passages, "_fetch", lambda url: fetched)
    passages = tmp_path / "passages.json"

    status = main(
        [
            "passages",
            "--url",
            SELF_STUDY_URL,
            "--title",
            "Rules of method",
            "--license",
            "CC-BY-SA-4.0",
            "--out",
            str(passages),
        ]
    )

    assert status == 0
    assert capsys.readouterr().out == f"{passages.resolve()}\n"
    packet = tmp_path / "packet"
    prepare_packet(passages_path=passages, output_dir=packet, title="Rules of method", target="L1")
    evidence = json.loads((packet / "evidence.json").read_text())
    assert evidence["retrieval"]["origin"] == "self-study-passages/1.0"
    assert [source["text"] for source in evidence["sources"]] == SELF_STUDY_PARAGRAPHS
    assert [source["source_id"] for source in evidence["sources"]] == ["rules-of-method"] * 3
    assert [result["chunk_id"] for result in evidence["captured_response"]["results"]] == [
        "rules-of-method-1",
        "rules-of-method-2",
        "rules-of-method-3",
    ]
    assert {
        (source["source_url"], source["license_id"], source["title"]) for source in evidence["sources"]
    } == {(SELF_STUDY_URL, "CC-BY-SA-4.0", "Rules of method")}


def test_passages_from_a_local_file_keep_their_path_beside_the_sources(tmp_path):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = tmp_path / "passages.json"

    assert main(["passages", "--text", str(reference), "--title", "Notes", "--out", str(passages)]) == 0

    packet = tmp_path / "packet"
    prepare_packet(passages_path=passages, output_dir=packet, title="Notes", target=None)
    evidence = json.loads((packet / "evidence.json").read_text())
    # The normalizer ignores origin_path; the packet keeps it as part of the captured response.
    assert evidence["captured_response"]["origin_path"] == str(reference.resolve())
    assert [source["text"] for source in evidence["sources"]] == SELF_STUDY_PARAGRAPHS
    assert {(source["source_url"], source["license_id"]) for source in evidence["sources"]} == {
        (None, "unknown")
    }


@pytest.mark.parametrize("kind", ["--html", "--text", "--pdf"])
def test_passages_cli_reads_each_local_kind(tmp_path, kind):
    reference = tmp_path / f"reference{kind.replace('--', '.')}"
    if kind == "--pdf":
        fitz = pytest.importorskip("fitz")
        document = fitz.open()
        document.new_page().insert_textbox(fitz.Rect(72, 72, 540, 400), SELF_STUDY_PARAGRAPHS[0], fontsize=10)
        reference.write_bytes(document.tobytes())
    elif kind == "--html":
        reference.write_bytes(self_study_page())
    else:
        reference.write_text(SELF_STUDY_PARAGRAPHS[0], encoding="utf-8")
    passages = tmp_path / "passages.json"

    assert main(["passages", kind, str(reference), "--title", "T", "--out", str(passages)]) == 0

    texts = [result["text"] for result in json.loads(passages.read_text())["results"]]
    assert texts[0] == SELF_STUDY_PARAGRAPHS[0]


def test_passages_never_overwrite_an_output_without_force(tmp_path, capsys):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = write_json(tmp_path / "passages.json", {"old": True})
    command = ["passages", "--text", str(reference), "--title", "Notes", "--out", str(passages)]

    refused = main(command)

    assert refused == 2
    assert "--force" in capsys.readouterr().err
    assert json.loads(passages.read_text()) == {"old": True}
    assert main([*command, "--force"]) == 0
    assert json.loads(passages.read_text())["origin"] == "self-study-passages/1.0"


def test_passages_without_a_usable_passage_write_nothing(tmp_path, capsys):
    reference = tmp_path / "short.txt"
    reference.write_text("Too short to teach anything.", encoding="utf-8")
    passages = tmp_path / "passages.json"

    status = main(["passages", "--text", str(reference), "--title", "T", "--out", str(passages)])

    assert status == 2
    assert "no passage of at least 200 characters" in capsys.readouterr().err
    assert not passages.exists()


def test_evidence_ids_say_where_the_passages_came_from(tmp_path):
    _, perspicacite_id = prepare_basic(tmp_path)
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = tmp_path / "self-study.json"
    assert main(["passages", "--text", str(reference), "--title", "Notes", "--out", str(passages)]) == 0
    packet = tmp_path / "self-study-packet"

    prepare_packet(passages_path=passages, output_dir=packet, title="Notes", target=None)

    ids = [source["evidence_id"] for source in json.loads((packet / "evidence.json").read_text())["sources"]]
    assert perspicacite_id.startswith("perspicacite:")
    assert len(ids) == 3
    assert all(evidence_id.startswith("passage:") and len(evidence_id) == 32 for evidence_id in ids)


def test_prepare_writes_the_self_study_brief_for_self_study_passages(tmp_path):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = tmp_path / "self-study.json"
    assert main(["passages", "--text", str(reference), "--title", "Notes", "--out", str(passages)]) == 0
    packet = tmp_path / "self-study-packet"

    prepare_packet(passages_path=passages, output_dir=packet, title="Notes", target=None)

    task = (packet / "author-task.md").read_text()
    teacher_packet, _ = prepare_basic(tmp_path)
    assert task.startswith("# Studium self-study author task")
    assert (teacher_packet / "author-task.md").read_text().startswith("# Studium literature-experience author task")
    assert "{{" not in task
    sources = json.loads((packet / "evidence.json").read_text())["sources"]
    assert all(source["evidence_id"] in task for source in sources)


def test_prepare_self_study_flag_picks_the_self_study_brief_for_any_envelope(tmp_path):
    source = write_json(tmp_path / "passages.json", PASSAGES)
    packet = tmp_path / "packet"

    status = main(
        ["prepare", "--passages", str(source), "--out", str(packet), "--title", "T", "--self-study"]
    )

    assert status == 0
    assert (packet / "author-task.md").read_text().startswith("# Studium self-study author task")
    evidence = json.loads((packet / "evidence.json").read_text())
    assert evidence["sources"][0]["evidence_id"].startswith("perspicacite:")


def test_self_study_brief_steers_the_learners_agent():
    brief = (TOOLS / "prompts" / "experience_author_self_study.md").read_text(encoding="utf-8")

    for placeholder in ("{{TITLE}}", "{{TARGET}}", "{{SOURCE_IDS}}", "{{ASB_SOURCE_ID}}"):
        assert placeholder in brief
    for production_type in [name for name, key in SCENE_KEY_CLASS.items() if key == "production"]:
        assert production_type in brief
    for phrase in (
        "untrusted",
        "character-for-character",
        "No teacher",
        "at most one or two",
        "2 to 4 short cues",
        "never a whole sentence",
        '"draft"',
        "`null`",
    ):
        assert phrase in brief, phrase


def test_scene_key_class_names_every_bundle_scene_type():
    assert set(SCENE_KEY_CLASS) == set(typing.get_args(BundleSceneType))
    assert SCENE_KEY_CLASS == EXPECTED_KEY_CLASSES
    assert len(SCENE_KEY_CLASS) == 13


def test_check_prints_key_classes_with_their_scene_ids(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    template = response_value["lesson_plan"]["scene_outlines"][0]
    response_value["lesson_plan"]["scene_outlines"] = [
        {**template, "id": f"s-{scene_type}", "type": scene_type} for scene_type in PLAYABLE_PLAN_SCENES
    ]
    response_value["source_links"][0]["scene_id"] = "s-discussion"
    response_value["viewers"][0]["scene_id"] = "s-discussion"
    response = write_json(tmp_path / "response.json", response_value)

    status = main(
        ["check", "--packet", str(packet), "--response", str(response), "--out", str(tmp_path / "course")]
    )

    lines = capsys.readouterr().out.splitlines()
    assert status == 0
    # The legacy simulation scene becomes a concept placeholder, hence ungraded=4.
    assert (
        "Key classes: author_keyed=2 (s-quiz, s-spot_the_flaw) "
        "production=7 (s-discussion, s-ai_critique, s-explain_back, s-comparison, s-summary_audit, "
        "s-prompt_practice, s-communication_sim) externally_grounded=1 (s-reproduction) ungraded=4"
    ) in lines


def test_key_classes_line_puts_unrecognised_types_in_an_unknown_bucket():
    line = key_classes_line([("s-quiz", "quiz"), ("s-new", "hologram"), ("s-intro", "intro")])

    assert line == (
        "Key classes: author_keyed=1 (s-quiz) production=0 (none) externally_grounded=0 (none) "
        "ungraded=1 unknown=1 (s-new)"
    )


@pytest.mark.parametrize(
    ("note_args", "expected_authoring"),
    [
        ([], {"mode": "self_study", "author_is_learner": True}),
        (
            ["--note", "  Durkheim, chapter 1  "],
            {"mode": "self_study", "author_is_learner": True, "note": "Durkheim, chapter 1"},
        ),
    ],
)
def test_bundle_self_study_records_who_wrote_it(tmp_path, note_args, expected_authoring):
    course = checked_course(tmp_path)
    output = tmp_path / "lesson.json"

    status = main(["bundle", "--course", str(course), "--out", str(output), "--self-study", *note_args])

    bundle = json.loads(output.read_text())
    assert status == 0
    assert bundle["metadata"]["authoring"] == expected_authoring
    assert bundle["validated_by"] == SELF_STUDY_VALIDATED_BY == "SELF-STUDY — not teacher-validated"
    LessonBundle.model_validate(bundle)


def test_bundle_self_study_refuses_an_explicit_validator_while_placeholders_remain(
    tmp_path, capsys
):
    course = checked_course(tmp_path)
    output = tmp_path / "lesson.json"

    status = main(
        [
            "bundle",
            "--course",
            str(course),
            "--out",
            str(output),
            "--self-study",
            "--validated-by",
            "Prof. Example",
        ]
    )

    assert status == 2
    assert "remaining placeholder" in capsys.readouterr().err
    assert not output.exists()


def test_bundle_without_self_study_has_no_authoring_and_nothing_else_differs(tmp_path):
    course = checked_course(tmp_path)
    plain = json.loads(build_lesson_bundle(course_dir=course, output_path=tmp_path / "plain.json").read_text())
    assert main(["bundle", "--course", str(course), "--out", str(tmp_path / "self.json"), "--self-study"]) == 0
    self_study = json.loads((tmp_path / "self.json").read_text())

    assert sorted(plain["metadata"]) == ["discipline", "duration_minutes", "language", "target", "title"]
    assert plain["validated_by"] == "DRAFT — not validated"
    del self_study["metadata"]["authoring"]
    for bundle in (plain, self_study):
        del bundle["validated_by"], bundle["validated_at"]
    assert self_study == plain


def test_bundle_note_requires_self_study(tmp_path, capsys):
    course = checked_course(tmp_path)
    output = tmp_path / "lesson.json"

    status = main(["bundle", "--course", str(course), "--out", str(output), "--note", "orphan note"])

    assert status == 2
    assert "--note requires --self-study" in capsys.readouterr().err
    assert not output.exists()


def evidence_quoting(sources: list[dict], quote: str) -> str:
    matches = [source["evidence_id"] for source in sources if quote in source["text"]]
    assert len(matches) == 1, quote
    return matches[0]


def durkheim_response(sources: list[dict]) -> dict:
    quotes = {
        "scene-intro": "ils consistent en des manières d’agir, de penser et de sentir, extérieures",
        "scene-quiz": "doués d’une puissance impérative et coercitive",
        "scene-explain": "existent en dehors des consciences individuelles",
    }
    evidence = {scene_id: evidence_quoting(sources, quote) for scene_id, quote in quotes.items()}
    scene_types = {"scene-intro": "intro", "scene-quiz": "quiz", "scene-explain": "explain_back"}
    return {
        "lesson_plan": {
            "schema_version": "1.0",
            "id": "fait-social-self-study",
            "title": "Le fait social",
            "language": "fr",
            "target": "L1",
            "duration_minutes": 15,
            "learning_objectives": [
                {
                    "id": "objective-1",
                    "description": "Expliquer ce qui distingue un fait social.",
                    "bloom_level": "understand",
                }
            ],
            "concepts": [
                {
                    "id": "fait-social",
                    "title": "Fait social",
                    "description": "Manière d’agir extérieure à l’individu et contraignante.",
                    "bloom_level_target": "understand",
                }
            ],
            "scene_outlines": [
                {
                    "id": scene_id,
                    "type": scene_type,
                    "title": f"Scène {scene_type}",
                    "objective_refs": ["objective-1"],
                    "concept_refs": [] if scene_type == "intro" else ["fait-social"],
                    "prov_derived_from": [evidence[scene_id]],
                }
                for scene_id, scene_type in scene_types.items()
            ],
            "corpus_refs": [
                {"ref_id": ref, "ref_type": "offline"} for ref in dict.fromkeys(evidence.values())
            ],
            "status": "draft",
            "validated_by": None,
        },
        "source_links": [
            {"scene_id": scene_id, "evidence_id": evidence[scene_id], "quote": quote}
            for scene_id, quote in quotes.items()
        ],
    }


def test_self_study_chain_on_the_saved_durkheim_page(tmp_path, capsys):
    passages = tmp_path / "passages.json"
    capture = ["passages", "--html", str(DURKHEIM_PAGE), "--title", "Les Règles — Chapitre I"]
    assert main([*capture, "--license", "public-domain", "--out", str(passages)]) == 0
    packet = tmp_path / "packet"
    assert main(["prepare", "--passages", str(passages), "--out", str(packet), "--title", "Le fait social"]) == 0
    sources = json.loads((packet / "evidence.json").read_text())["sources"]
    assert all(source["evidence_id"].startswith("passage:") for source in sources)
    assert (packet / "author-task.md").read_text().startswith("# Studium self-study author task")
    response = write_json(tmp_path / "response.json", durkheim_response(sources))
    course = tmp_path / "course"
    capsys.readouterr()

    assert main(["check", "--packet", str(packet), "--response", str(response), "--out", str(course)]) == 0
    stdout = capsys.readouterr().out
    assert (
        "Key classes: author_keyed=1 (scene-quiz) production=1 (scene-explain) "
        "externally_grounded=0 (none) ungraded=1"
    ) in stdout.splitlines()
    assert "WARN: licence" not in stdout
    review = (course / "review.md").read_text()
    assert "- `scene-quiz` → `passage:" in review
    assert review.startswith("# Relais de relecture pour l’auto-apprentissage")
    assert "Aucun enseignant ne valide cette leçon" in review
    assert "A teacher must assess" not in review

    lesson = tmp_path / "lesson.json"
    bundle_command = ["bundle", "--course", str(course), "--out", str(lesson), "--self-study"]
    assert main([*bundle_command, "--note", "my reading"]) == 0
    bundle = json.loads(lesson.read_text())
    LessonBundle.model_validate(bundle)
    assert bundle["metadata"]["authoring"] == {
        "mode": "self_study",
        "author_is_learner": True,
        "note": "my reading",
    }

    lint = subprocess.run(
        ["node", str(TOOLS / "bundle_lint.mjs"), str(lesson)],
        cwd=TOOLS.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    assert_fails_only_on_unfilled_placeholder(lint)
    open_book = [line for line in lint.stdout.splitlines() if "  self_study_open_book  " in line]
    assert len(open_book) == 1 and open_book[0].startswith("WARN  ") and "scene-quiz" in open_book[0]
    assert "  self_study_authoring  " in lint.stdout
    assert "self_study_no_external_key" not in lint.stdout


def test_check_names_a_local_reference_and_its_licence_once(tmp_path, capsys):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = tmp_path / "passages.json"
    assert main(["passages", "--text", str(reference), "--title", "Rules of method", "--out", str(passages)]) == 0
    packet = tmp_path / "packet"
    prepare_packet(passages_path=passages, output_dir=packet, title="Rules of method", target="L1")
    sources = json.loads((packet / "evidence.json").read_text())["sources"]
    response = write_json(
        tmp_path / "response.json", self_study_response([source["evidence_id"] for source in sources])
    )
    capsys.readouterr()

    course = tmp_path / "course"
    assert main(["check", "--packet", str(packet), "--response", str(response), "--out", str(course)]) == 0

    lines = capsys.readouterr().out.splitlines()
    licences = lines[lines.index("Licences:") + 1 :]
    assert [line for line in licences if line.startswith("- ")] == ["- Rules of method: unknown"]
    assert sum(line.startswith("WARN: licence is unknown") for line in lines) == 1
    assert {source["source_id"] for source in sources} == {"rules-of-method"}


def test_cli_finds_its_sibling_modules_in_isolated_mode(tmp_path):
    reference = tmp_path / "notes.txt"
    reference.write_text("\n\n".join(SELF_STUDY_PARAGRAPHS), encoding="utf-8")
    passages = tmp_path / "passages.json"

    # `python -I` drops the script directory from sys.path; agents use it on downloaded data.
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            str(TOOLS / "experience_packet.py"),
            "passages",
            "--text",
            str(reference),
            "--title",
            "Notes",
            "--out",
            str(passages),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(passages.read_text())["origin"] == "self-study-passages/1.0"


def _typographic_response(tmp_path: Path) -> tuple[Path, dict]:
    passages_value = deepcopy(PASSAGES)
    passages_value["passages"][0]["text"] = (
        "Le fait social s’impose\u00a0à l’individu. Une seconde phrase demeure observable."
    )
    passages = write_json(tmp_path / "passages.json", passages_value)
    packet = tmp_path / "packet"
    prepare_packet(passages_path=passages, output_dir=packet, title="Le fait social", target="L1")
    evidence_id = json.loads((packet / "evidence.json").read_text())["sources"][0]["evidence_id"]
    return packet, valid_response(evidence_id)


def test_check_json_collects_all_errors_with_typographic_nearest_passages(tmp_path, capsys):
    packet, response_value = _typographic_response(tmp_path)
    response_value["lesson_plan"]["scene_outlines"][0]["concept_refs"] = ["unknown-concept"]
    response_value["source_links"] = [
        {
            "scene_id": "scene-1",
            "evidence_id": response_value["source_links"][0]["evidence_id"],
            "quote": "Le fait social s'impose à l'individu.",
        },
        {
            "scene_id": "scene-1",
            "evidence_id": response_value["source_links"][0]["evidence_id"],
            "quote": "Une seconde phrase inventée.",
        },
    ]
    response = write_json(tmp_path / "response.json", response_value)
    output = tmp_path / "course"

    status = main(
        [
            "check",
            "--packet",
            str(packet),
            "--response",
            str(response),
            "--out",
            str(output),
            "--json",
        ]
    )

    report = json.loads(capsys.readouterr().out)
    errors = [finding for finding in report["findings"] if finding["level"] == "ERROR"]
    assert status == 1
    assert report["ok"] is False
    assert {finding["code"] for finding in errors} == {"unknown_concept", "quote_not_exact"}
    assert [finding["link_index"] for finding in errors if "link_index" in finding] == [1, 2]
    assert all(finding.get("scene_id") == "scene-1" for finding in errors)
    first_quote = next(finding for finding in errors if finding.get("link_index") == 1)
    assert first_quote["quote"] == "Le fait social s'impose à l'individu."
    assert "curly apostrophe" in first_quote["hint"]
    assert "NBSP" in first_quote["hint"]
    assert "Nearest passage" in first_quote["hint"]
    assert not output.exists()


def test_check_warns_when_an_exact_quote_starts_mid_word(tmp_path, capsys):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["source_links"][0]["quote"] = "educed the signal by 31%"
    response = write_json(tmp_path / "response.json", response_value)

    status = main(
        [
            "check",
            "--packet",
            str(packet),
            "--response",
            str(response),
            "--out",
            str(tmp_path / "course"),
            "--json",
        ]
    )

    report = json.loads(capsys.readouterr().out)
    warning = next(finding for finding in report["findings"] if finding["code"] == "quote_mid_word")
    assert status == 0
    assert report["ok"] is True
    assert warning["level"] == "WARN"
    assert warning["scene_id"] == "scene-1"
    assert warning["link_index"] == 1
    assert warning["quote"] == "educed the signal by 31%"


@pytest.mark.parametrize(
    ("language", "heading", "topic", "replay"),
    [
        (
            "en",
            "# Teacher review handoff",
            "TODO: discussion topic",
            "Two errors on this concept: replay the scene with support.",
        ),
        (
            "fr",
            "# Relais de relecture enseignant",
            "TODO: sujet de discussion",
            "Deux erreurs sur ce concept : on reprend la scène avec un appui.",
        ),
    ],
)
def test_generated_authoring_strings_follow_plan_language(
    tmp_path, language, heading, topic, replay
):
    packet, evidence_id = prepare_basic(tmp_path)
    response_value = valid_response(evidence_id)
    response_value["lesson_plan"]["language"] = language
    response = write_json(tmp_path / "response.json", response_value)
    course = tmp_path / "course"
    check_response(packet_dir=packet, response_path=response, output_dir=course)

    lesson = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")
    bundle = json.loads(lesson.read_text())

    assert (course / "review.md").read_text().startswith(heading)
    assert bundle["scenes"][0]["topic"].startswith(topic)
    assert bundle["rules"][0]["explanation_short"] == replay


def test_bundle_prints_placeholder_count_and_documents_approval_flow(tmp_path, capsys):
    course = checked_course(tmp_path)
    lesson = tmp_path / "lesson.json"

    status = main(["bundle", "--course", str(course), "--out", str(lesson)])

    lines = capsys.readouterr().out.splitlines()
    assert status == 0
    assert int(lines[0].removeprefix("Remaining placeholders: ")) > 0
    assert lines[1] == str(lesson.resolve())

    with pytest.raises(SystemExit) as exit_info:
        main(["bundle", "--help"])
    assert exit_info.value.code == 0
    help_text = capsys.readouterr().out
    assert "fill the placeholders" in help_text
    assert "approve --bundle" in help_text


def _replace_placeholders(value: object) -> object:
    if isinstance(value, dict):
        return {key: _replace_placeholders(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_placeholders(item) for item in value]
    if isinstance(value, str) and (value.lstrip().startswith("TODO") or "TODO:" in value):
        return "Finished authored content grounded in the cited passage."
    return value


def _finished_teacher_bundle(tmp_path: Path) -> Path:
    course = checked_course(tmp_path)
    bundle_dir = tmp_path / "bundle"
    bundle_dir.mkdir()
    lesson = build_lesson_bundle(course_dir=course, output_path=bundle_dir / "lesson.json")
    finished = _replace_placeholders(json.loads(lesson.read_text()))
    lesson.write_text(json.dumps(finished, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    LessonBundle.model_validate(finished)
    return lesson


def test_placeholder_detection_catches_todo_prefix_but_allows_todo_ids():
    value = {
        "id": "todo-scene",
        "choices": [{"id": "todo-choice", "text": "TODO finish this answer"}],
        "feedback": "Embedded TODO: finish this feedback",
    }

    assert placeholder_paths(value) == ["$.choices[0].text", "$.feedback"]


def test_placeholder_detection_skips_quoted_source_text_in_evidence():
    """Same rule as tools/bundle_lint.mjs: a verbatim excerpt that says "TODO:" is not an unfilled field."""
    value = {
        "evidence": {"bibliographic_refs": [{"excerpt": "// TODO: handle the empty list"}]},
        "question": "TODO: write the question",
    }

    assert placeholder_paths(value) == ["$.question"]


def test_approve_preserves_bundle_content_and_writes_hash_bound_record(tmp_path, capsys):
    lesson = _finished_teacher_bundle(tmp_path)
    before = json.loads(lesson.read_text())

    status = main(
        [
            "approve",
            "--bundle",
            str(lesson),
            "--validated-by",
            "Professor Example",
            "--checklist",
            "scientific_accuracy=yes",
            "licence=checked",
        ]
    )

    captured = capsys.readouterr()
    after = json.loads(lesson.read_text())
    approval = json.loads((lesson.parent / "approval.json").read_text())
    comparable_before = {key: value for key, value in before.items() if key not in {"validated_by", "validated_at"}}
    comparable_after = {key: value for key, value in after.items() if key not in {"validated_by", "validated_at"}}
    assert status == 0
    assert captured.err == ""
    # RT-7: a short summary for the teacher, then the record's path as the last line (as `bundle` does).
    lines = captured.out.splitlines()
    assert lines[-1] == str((lesson.parent / "approval.json").resolve())
    summary = "\n".join(lines[:-1])
    assert "Approved by Professor Example" in summary
    assert hashlib.sha256(lesson.read_bytes()).hexdigest() in summary
    assert "lint: 0 error(s), 0 warning(s)" in summary
    assert "any edit to lesson.json makes this approval stale" in summary
    assert comparable_after == comparable_before
    assert after["validated_by"] == "Professor Example"
    assert after["validated_at"] == approval["reviewed_at"]
    assert approval == {
        "schema": "studium-approval/1",
        "bundle_sha256": hashlib.sha256(lesson.read_bytes()).hexdigest(),
        "reviewer": "Professor Example",
        "reviewed_at": after["validated_at"],
        "checklist": {"scientific_accuracy": "yes", "licence": "checked"},
        "lint": {"errors": 0, "warnings": 0},
        "tool": "experience_packet.py approve 1.0",
    }


def test_approve_refuses_placeholders_without_mutating_bundle(tmp_path, capsys):
    course = checked_course(tmp_path)
    lesson = build_lesson_bundle(course_dir=course, output_path=tmp_path / "lesson.json")
    before = lesson.read_bytes()

    status = main(["approve", "--bundle", str(lesson), "--validated-by", "Professor Example"])

    assert status == 2
    assert "placeholder" in capsys.readouterr().err
    assert lesson.read_bytes() == before
    assert not (lesson.parent / "approval.json").exists()


def test_approve_refuses_lint_errors_without_mutating_bundle(tmp_path, capsys):
    lesson = _finished_teacher_bundle(tmp_path)
    broken = json.loads(lesson.read_text())
    broken["rules"] = {"not": "an array"}
    lesson.write_text(json.dumps(broken, ensure_ascii=False) + "\n", encoding="utf-8")
    before = lesson.read_bytes()

    status = main(["approve", "--bundle", str(lesson), "--validated-by", "Professor Example"])

    assert status == 2
    assert "lint reported" in capsys.readouterr().err
    assert lesson.read_bytes() == before
    assert not (lesson.parent / "approval.json").exists()


def test_approve_refuses_self_study_even_when_finished(tmp_path, capsys):
    lesson = _finished_teacher_bundle(tmp_path)
    bundle = json.loads(lesson.read_text())
    bundle["metadata"]["authoring"] = {"mode": "self_study", "author_is_learner": True}
    lesson.write_text(json.dumps(bundle, ensure_ascii=False) + "\n", encoding="utf-8")

    status = main(["approve", "--bundle", str(lesson), "--validated-by", "Professor Example"])

    assert status == 2
    err = capsys.readouterr().err
    assert "self-study" in err
    # RT-7: the refusal names the next step.
    assert "prepare, check and bundle" in err and "teacher route" in err
    assert not (lesson.parent / "approval.json").exists()


def test_approve_help_lists_checklist_keys_and_says_what_it_rewrites(capsys):
    """RT-7: a teacher who is not a developer reads --help, not the source."""
    with pytest.raises(SystemExit) as exit_info:
        main(["approve", "--help"])
    assert exit_info.value.code == 0
    help_text = " ".join(capsys.readouterr().out.split())
    assert "sources=read" in help_text and "keys=checked" in help_text
    assert "validated_by and validated_at are rewritten" in help_text
    assert "normalized" in help_text
    assert "Preserve an edited teacher bundle" not in help_text
