from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from experience_packet import PacketError, check_response, prepare_packet


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

    with pytest.raises(PacketError, match="already exists"):
        prepare_packet(passages_path=source, output_dir=output, title="A title", target=None)


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
    assert "technical checks only" in (output / "review.md").read_text()
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

    with pytest.raises(PacketError, match="already exists"):
        check_response(packet_dir=packet, response_path=response, output_dir=output)


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
