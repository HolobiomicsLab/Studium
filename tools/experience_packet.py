#!/usr/bin/env python
"""Prepare and check provider-free literature experience authoring packets."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

ROOT = Path(__file__).resolve().parents[1]
for package_path in (
    ROOT / "packages" / "perspicacite-client" / "python",
    ROOT / "packages" / "lesson-plan-schema" / "python",
):
    if str(package_path) not in sys.path:
        sys.path.insert(0, str(package_path))

from lesson_plan_schema import LessonPlan, PlanStatus, RefType  # noqa: E402
from perspicacite_mcp.passages import (  # noqa: E402
    PassageEnvelopeError,
    normalize_passage_envelope,
)

PACKET_SCHEMA_VERSION = "1.0"
ASB_SOURCE_PREFIX = "asb:"
EXECUTION_CLAIM_KEYS = {
    "capsule_result",
    "execution_result",
    "reference_result",
    "run_result",
}


class PacketError(ValueError):
    """Raised when packet preparation or response checking cannot proceed."""


class SourceLink(BaseModel):
    """Bind one lesson scene to an exact quote in captured evidence."""

    model_config = ConfigDict(extra="forbid")
    scene_id: str = Field(min_length=1)
    evidence_id: str = Field(min_length=1)
    quote: str = Field(min_length=1)


class ViewerBrief(BaseModel):
    """Describe a viewer for an external harness without embedding executable code."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    scene_id: str = Field(min_length=1)
    source_ids: list[str] = Field(min_length=1)
    goal: str = Field(min_length=1)
    interactions: list[str] = Field(min_length=1)


class AuthorResponse(BaseModel):
    """External harness response around Studium's canonical LessonPlan."""

    model_config = ConfigDict(extra="forbid")
    lesson_plan: LessonPlan
    source_links: list[SourceLink] = Field(min_length=1)
    viewers: list[ViewerBrief] = Field(default_factory=list)


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_json(path: Path, label: str) -> tuple[Any, bytes]:
    try:
        raw = path.read_bytes()
        return json.loads(raw), raw
    except (OSError, json.JSONDecodeError) as exc:
        raise PacketError(f"cannot read {label} JSON: {exc}") from exc


def _require_new_directory(path: Path) -> None:
    if path.exists():
        raise PacketError(f"output directory already exists: {path}")


def _source_record(passage: dict[str, Any]) -> dict[str, Any]:
    record_sha = passage["sha256"]
    text_sha = _sha256(passage["text"].encode("utf-8"))
    return {
        "evidence_id": f"perspicacite:{record_sha[:24]}",
        "text": passage["text"],
        "sha256": text_sha,
        "text_sha256": text_sha,
        "record_sha256": record_sha,
        "source_id": passage["id"],
        "source_doi": passage["doi"],
        "source_url": passage["url"],
        "license_id": passage["license_id"],
        "kb_name": passage["kb_name"],
        "title": passage["title"],
        "authors": passage["authors"],
        "year": passage["year"],
        "score": passage["score"],
    }


def _source_records(passages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = [_source_record(passage) for passage in passages]
    ids = [record["evidence_id"] for record in records]
    if len(ids) != len(set(ids)):
        raise PacketError("captured passages contain duplicate evidence identities")
    return records


def _card_candidates(capsule: Path) -> list[Path]:
    candidates = [capsule / "task_card.json", capsule / "card.json"]
    candidates.extend(sorted(capsule.glob("task_card_*.json")))
    candidates.extend(sorted(capsule.glob("capsules/*/task_card.json")))
    candidates.extend(sorted(capsule.glob("capsules/*/card.json")))
    return [candidate for candidate in candidates if candidate.is_file()]


def _load_cards(capsule: Path) -> list[tuple[Path, dict[str, Any], bytes]]:
    if not capsule.is_dir():
        raise PacketError(f"ASB capsule is not a directory: {capsule}")
    loaded: list[tuple[Path, dict[str, Any], bytes]] = []
    for candidate in _card_candidates(capsule):
        if candidate.is_symlink():
            raise PacketError(f"ASB task card may not be a symlink: {candidate}")
        resolved_candidate = candidate.resolve()
        if not resolved_candidate.is_relative_to(capsule):
            raise PacketError(f"ASB task card escapes the capsule: {candidate}")
        value, raw = _load_json(resolved_candidate, "ASB task card")
        if not isinstance(value, dict) or not isinstance(value.get("task_id"), str):
            raise PacketError(f"invalid ASB task card: {candidate}")
        if not value["task_id"]:
            raise PacketError(f"ASB task card has an empty task_id: {candidate}")
        loaded.append((resolved_candidate, value, raw))
    if not loaded:
        raise PacketError(f"no ASB task card found in capsule: {capsule}")
    return loaded


def _select_card(
    capsule: Path, task_id: str | None
) -> tuple[Path, dict[str, Any], bytes]:
    cards = _load_cards(capsule)
    if task_id is not None:
        matches = [card for card in cards if card[1]["task_id"] == task_id]
        if len(matches) != 1:
            raise PacketError(f"requested ASB task {task_id!r} was not found exactly once")
        return matches[0]
    if len(cards) != 1:
        raise PacketError("--task-id is required when a capsule contains multiple task cards")
    return cards[0]


def _redact_card(card: dict[str, Any]) -> dict[str, Any]:
    safe_card = deepcopy(card)
    executable = safe_card.get("executable")
    if executable is None:
        return safe_card
    if not isinstance(executable, dict):
        raise PacketError("ASB executable must be an object or null")
    environment = executable.pop("env", {})
    if not isinstance(environment, dict) or not all(isinstance(key, str) for key in environment):
        raise PacketError("ASB executable.env must be an object with string keys")
    executable["env_keys"] = sorted(environment)
    return safe_card


def _asb_record(capsule_path: Path, task_id: str | None) -> dict[str, Any]:
    capsule = capsule_path.resolve()
    card_path, card, raw = _select_card(capsule, task_id)
    selected_id = card["task_id"]
    return {
        "source_id": f"{ASB_SOURCE_PREFIX}{selected_id}",
        "task_id": selected_id,
        "capsule_path": str(capsule),
        "card_path": str(card_path.relative_to(capsule)),
        "card_sha256": _sha256(raw),
        "execution": "not_run",
        "card": _redact_card(card),
    }


def _render_author_task(evidence: dict[str, Any]) -> str:
    template_path = ROOT / "tools" / "prompts" / "experience_author.md"
    try:
        template = template_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PacketError(f"cannot read author prompt template: {exc}") from exc
    replacements = {
        "{{TITLE}}": json.dumps(evidence["title"], ensure_ascii=False),
        "{{TARGET}}": json.dumps(evidence["target"], ensure_ascii=False),
        "{{SOURCE_IDS}}": json.dumps(
            [source["evidence_id"] for source in evidence["sources"]], ensure_ascii=False
        ),
        "{{ASB_SOURCE_ID}}": json.dumps(
            evidence["asb_task"]["source_id"] if evidence.get("asb_task") else None
        ),
    }
    for marker, value in replacements.items():
        template = template.replace(marker, value)
    return template


def prepare_packet(
    *,
    passages_path: Path,
    output_dir: Path,
    title: str,
    target: str | None,
    capsule_path: Path | None = None,
    task_id: str | None = None,
) -> Path:
    """Create a deterministic authoring packet from captured source JSON.

    Inputs are read as inert JSON. No model, capsule command, or source code is
    executed. ``output_dir`` must not exist.
    """
    output_dir = output_dir.resolve()
    _require_new_directory(output_dir)
    if not title.strip():
        raise PacketError("title must not be empty")
    if task_id is not None and capsule_path is None:
        raise PacketError("--task-id requires --capsule")
    payload, raw = _load_json(passages_path, "captured passages")
    try:
        normalized = normalize_passage_envelope(payload)
    except PassageEnvelopeError as exc:
        raise PacketError(f"invalid captured passages: {exc}") from exc
    if normalized["status"] != "ok" or not normalized["passages"]:
        raise PacketError("captured retrieval is not successful and non-empty")
    evidence: dict[str, Any] = {
        "schema_version": PACKET_SCHEMA_VERSION,
        "packet_type": "studium-literature-experience-evidence",
        "title": title.strip(),
        "target": target.strip() if target and target.strip() else None,
        "capture": {
            "input_sha256": _sha256(raw),
            "canonical_response_sha256": _sha256(_json_bytes(payload)),
            "source": "captured-json",
        },
        "captured_response": payload,
        "retrieval": {
            "status": normalized["status"],
            "origin": normalized["origin"],
            "attempts": normalized["attempts"],
            "refined_query": normalized["refined_query"],
        },
        "sources": _source_records(normalized["passages"]),
        "asb_task": _asb_record(capsule_path, task_id) if capsule_path else None,
    }
    author_task = _render_author_task(evidence)
    response_schema = AuthorResponse.model_json_schema()
    output_dir.mkdir(parents=True)
    (output_dir / "evidence.json").write_bytes(_json_bytes(evidence))
    (output_dir / "author-task.md").write_text(author_task, encoding="utf-8")
    (output_dir / "response.schema.json").write_bytes(_json_bytes(response_schema))
    return output_dir


def _reject_execution_claims(value: Any, path: str = "lesson_plan") -> None:
    if isinstance(value, dict):
        forbidden = EXECUTION_CLAIM_KEYS.intersection(value)
        if forbidden:
            key = sorted(forbidden)[0]
            raise PacketError(f"unverified execution result {path}.{key} is not allowed")
        for key, child in value.items():
            _reject_execution_claims(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_execution_claims(child, f"{path}[{index}]")


def _unique_ids(values: list[str], label: str) -> set[str]:
    result = set(values)
    if len(result) != len(values):
        raise PacketError(f"duplicate {label} ID")
    return result


def _validate_packet(evidence: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(evidence, dict):
        raise PacketError("packet evidence must be an object")
    if (
        evidence.get("schema_version") != PACKET_SCHEMA_VERSION
        or evidence.get("packet_type") != "studium-literature-experience-evidence"
    ):
        raise PacketError("unsupported packet schema or packet type")
    captured = evidence.get("captured_response")
    capture = evidence.get("capture")
    if not isinstance(captured, dict) or not isinstance(capture, dict):
        raise PacketError("packet is missing its captured response")
    canonical_hash = _sha256(_json_bytes(captured))
    if capture.get("canonical_response_sha256") != canonical_hash:
        raise PacketError("captured response hash mismatch")
    try:
        normalized = normalize_passage_envelope(captured)
    except PassageEnvelopeError as exc:
        raise PacketError(f"captured response no longer normalizes: {exc}") from exc
    expected_sources = _source_records(normalized["passages"])
    if evidence.get("sources") != expected_sources:
        raise PacketError("source ledger does not match the captured response")
    expected_retrieval = {
        "status": normalized["status"],
        "origin": normalized["origin"],
        "attempts": normalized["attempts"],
        "refined_query": normalized["refined_query"],
    }
    if normalized["status"] != "ok" or not expected_sources:
        raise PacketError("captured response is not successful and non-empty")
    if evidence.get("retrieval") != expected_retrieval:
        raise PacketError("retrieval metadata does not match the captured response")
    return {source["evidence_id"]: source for source in expected_sources}


def _validate_plan_graph(plan: LessonPlan, allowed_sources: set[str]) -> tuple[set[str], set[str]]:
    objective_ids = _unique_ids([item.id for item in plan.learning_objectives], "objective")
    scene_ids = _unique_ids([item.id for item in plan.scene_outlines], "scene")
    for scene in plan.scene_outlines:
        unknown = set(scene.objective_refs) - objective_ids
        if unknown:
            raise PacketError(f"scene {scene.id!r} references unknown objective {sorted(unknown)[0]!r}")
        provenance = (scene.prov_derived_from or []) + (scene.dct_references or [])
        unknown_sources = set(provenance) - allowed_sources
        if unknown_sources:
            raise PacketError(f"scene {scene.id!r} references unknown evidence {sorted(unknown_sources)[0]!r}")
    unknown_plan_sources = set(plan.prov_derived_from or []) - allowed_sources
    if unknown_plan_sources:
        raise PacketError(f"plan references unknown evidence {sorted(unknown_plan_sources)[0]!r}")
    return objective_ids, scene_ids


def _validate_literature_corpus(reference: Any, source: dict[str, Any]) -> None:
    if reference.file_path is not None:
        raise PacketError(f"corpus reference {reference.ref_id!r} has an unbound file path")
    if reference.doi is not None and reference.doi != source["source_doi"]:
        raise PacketError(f"corpus reference {reference.ref_id!r} DOI contradicts its source")
    if reference.ref_type == RefType.doi:
        if not source["source_doi"] or reference.doi != source["source_doi"]:
            raise PacketError(f"corpus reference {reference.ref_id!r} DOI contradicts its source")
    elif reference.ref_type == RefType.url:
        if not source["source_url"]:
            raise PacketError(f"corpus reference {reference.ref_id!r} has no captured URL")
    elif reference.ref_type == RefType.offline:
        if source["source_doi"] or source["source_url"]:
            raise PacketError(f"corpus reference {reference.ref_id!r} hides a captured locator")
    else:
        raise PacketError(f"corpus reference {reference.ref_id!r} has an incompatible ref_type")
    known_locators = {
        locator for locator in (source["source_doi"], source["source_url"]) if locator
    }
    if reference.dct_source and reference.dct_source not in known_locators:
        raise PacketError(f"corpus reference {reference.ref_id!r} source locator contradicts capture")
    allowed_references = known_locators | {reference.ref_id}
    if set(reference.dct_references or []) - allowed_references:
        raise PacketError(f"corpus reference {reference.ref_id!r} has an unknown dct reference")


def _validate_asb_corpus(reference: Any, asb_task: dict[str, Any]) -> None:
    if reference.ref_type != RefType.abs_capsule:
        raise PacketError(f"ASB corpus reference {reference.ref_id!r} has the wrong ref_type")
    if reference.abs_capsule_path != asb_task["capsule_path"]:
        raise PacketError(f"ASB corpus reference {reference.ref_id!r} has the wrong capsule path")
    if reference.abs_task_card_ids != [asb_task["task_id"]]:
        raise PacketError(f"ASB corpus reference {reference.ref_id!r} has the wrong task selection")
    if reference.doi is not None or reference.file_path is not None:
        raise PacketError(f"ASB corpus reference {reference.ref_id!r} has an unrelated locator")


def _validate_corpus(
    plan: LessonPlan,
    sources: dict[str, dict[str, Any]],
    asb_task: dict[str, Any] | None,
) -> None:
    for reference in plan.corpus_refs:
        source = sources.get(reference.ref_id)
        if source is not None:
            _validate_literature_corpus(reference, source)
        elif asb_task and reference.ref_id == asb_task["source_id"]:
            _validate_asb_corpus(reference, asb_task)
        else:
            raise PacketError(f"unknown corpus reference {reference.ref_id!r}")


def _validate_asb(plan: LessonPlan, evidence: dict[str, Any]) -> None:
    selected = evidence.get("asb_task")
    selected_id = selected.get("task_id") if isinstance(selected, dict) else None
    for scene in plan.scene_outlines:
        if scene.abs_task_card_id and scene.abs_task_card_id != selected_id:
            raise PacketError(f"scene {scene.id!r} references an unavailable ASB task")
        asset = scene.evidence.abs_asset if scene.evidence else None
        if asset and asset.abs_task_card_id and asset.abs_task_card_id != selected_id:
            raise PacketError(f"scene {scene.id!r} references an unavailable ASB task")
    for reference in plan.corpus_refs:
        for referenced_id in reference.abs_task_card_ids or []:
            if referenced_id != selected_id:
                raise PacketError(f"corpus references an unavailable ASB task {referenced_id!r}")


def _validate_embedded_evidence(plan: LessonPlan, sources: dict[str, dict[str, Any]]) -> None:
    for scene in plan.scene_outlines:
        refs = scene.evidence.bibliographic_refs if scene.evidence else None
        for reference in refs or []:
            source = sources.get(reference.perspicacite_doc_id)
            if source is None:
                raise PacketError(f"scene {scene.id!r} embeds unknown evidence")
            if reference.doi is not None and reference.doi != source["source_doi"]:
                raise PacketError(f"scene {scene.id!r} bibliography DOI contradicts capture")
            expected_title = source["title"] or "(untitled)"
            if reference.title != expected_title:
                raise PacketError(f"scene {scene.id!r} bibliography title contradicts capture")
            if reference.authors != source["authors"]:
                raise PacketError(f"scene {scene.id!r} bibliography authors contradict capture")
            if reference.year != source["year"]:
                raise PacketError(f"scene {scene.id!r} bibliography year contradicts capture")
            if source["score"] is None or reference.relevance_score != source["score"]:
                raise PacketError(f"scene {scene.id!r} bibliography score contradicts capture")
            if reference.prov_derived_from != reference.perspicacite_doc_id:
                raise PacketError(f"scene {scene.id!r} bibliography provenance contradicts capture")
            if not reference.excerpt or reference.excerpt not in source["text"]:
                raise PacketError(f"scene {scene.id!r} embeds a non-exact evidence excerpt")


def _validate_links(
    links: list[SourceLink], sources: dict[str, dict[str, Any]], scene_ids: set[str]
) -> None:
    seen: set[tuple[str, str, str]] = set()
    for link in links:
        if link.scene_id not in scene_ids:
            raise PacketError(f"source link references unknown scene {link.scene_id!r}")
        source = sources.get(link.evidence_id)
        if source is None:
            raise PacketError(f"source link references unknown evidence {link.evidence_id!r}")
        if link.quote not in source["text"]:
            raise PacketError(f"source link quote is not an exact substring of {link.evidence_id!r}")
        identity = (link.scene_id, link.evidence_id, link.quote)
        if identity in seen:
            raise PacketError("duplicate source link")
        seen.add(identity)


def _validate_viewers(
    viewers: list[ViewerBrief], scene_ids: set[str], allowed_sources: set[str]
) -> None:
    _unique_ids([viewer.id for viewer in viewers], "viewer")
    for viewer in viewers:
        if viewer.scene_id not in scene_ids:
            raise PacketError(f"viewer {viewer.id!r} references unknown scene")
        unknown = set(viewer.source_ids) - allowed_sources
        if unknown:
            raise PacketError(f"viewer {viewer.id!r} references unknown source {sorted(unknown)[0]!r}")


def _review_markdown(response: AuthorResponse, evidence: dict[str, Any]) -> str:
    linked_scenes = {link.scene_id for link in response.source_links}
    all_scenes = {scene.id for scene in response.lesson_plan.scene_outlines}
    unlinked = sorted(all_scenes - linked_scenes)
    lines = [
        "# Teacher review handoff",
        "",
        "Status: technical checks only; this LessonPlan remains a draft.",
        "",
        "## Checked",
        "",
        f"- {len(response.source_links)} source link(s) use known evidence IDs and exact quotes.",
        f"- {len(response.viewers)} viewer brief(s) reference known scenes and sources.",
        "- Objective, scene, corpus, and optional ASB task references resolve.",
        "- No teacher approval or structured capsule execution result is claimed.",
        "",
        "## Source links",
        "",
    ]
    for link in response.source_links:
        quote = link.quote.replace("\n", " ")
        lines.append(f"- `{link.scene_id}` → `{link.evidence_id}`: “{quote}”")
    lines.extend(["", "## Review attention", ""])
    lines.append(f"- Scenes without an explicit source link: {', '.join(unlinked) or 'none' }.")
    asb_task = evidence.get("asb_task")
    if asb_task:
        lines.append(
            f"- ASB task `{asb_task['task_id']}` was captured but not executed by this tool."
        )
    lines.extend(
        [
            "- Exact quotation checks do not establish that paraphrases or conclusions are scientifically valid.",
            "- Viewer briefs have not been implemented, run, or inspected.",
            "- A teacher must assess scientific accuracy, pedagogy, licensing, and learner release.",
            "",
        ]
    )
    return "\n".join(lines)


def _validated_response(value: Any) -> AuthorResponse:
    if not isinstance(value, dict) or not isinstance(value.get("lesson_plan"), dict):
        raise PacketError("response must contain a lesson_plan object")
    _reject_execution_claims(value["lesson_plan"])
    try:
        return AuthorResponse.model_validate(value)
    except ValidationError as exc:
        raise PacketError(f"response does not match response.schema.json: {exc}") from exc


def check_response(*, packet_dir: Path, response_path: Path, output_dir: Path) -> Path:
    """Validate an external author response and emit teacher-review artifacts."""
    output_dir = output_dir.resolve()
    _require_new_directory(output_dir)
    evidence, evidence_raw = _load_json(packet_dir / "evidence.json", "packet evidence")
    response_value, _ = _load_json(response_path, "author response")
    sources = _validate_packet(evidence)
    response = _validated_response(response_value)
    plan = response.lesson_plan
    if plan.status != PlanStatus.draft:
        raise PacketError("lesson plan status must be draft")
    if plan.validated_by is not None:
        raise PacketError("lesson plan validated_by must be null")
    asb_task = evidence.get("asb_task")
    asb_source = {asb_task["source_id"]} if isinstance(asb_task, dict) else set()
    allowed_sources = set(sources) | asb_source
    _, scene_ids = _validate_plan_graph(plan, allowed_sources)
    _validate_corpus(plan, sources, asb_task if isinstance(asb_task, dict) else None)
    _validate_asb(plan, evidence)
    _validate_embedded_evidence(plan, sources)
    _validate_links(response.source_links, sources, scene_ids)
    _validate_viewers(response.viewers, scene_ids, allowed_sources)
    output_dir.mkdir(parents=True)
    (output_dir / "plan.json").write_bytes(_json_bytes(plan.model_dump(mode="json")))
    (output_dir / "evidence.json").write_bytes(evidence_raw)
    (output_dir / "source_links.json").write_bytes(
        _json_bytes(
            {
                "schema_version": PACKET_SCHEMA_VERSION,
                "source_links": [link.model_dump(mode="json") for link in response.source_links],
            }
        )
    )
    (output_dir / "viewers.json").write_bytes(
        _json_bytes([viewer.model_dump(mode="json") for viewer in response.viewers])
    )
    (output_dir / "review.md").write_text(
        _review_markdown(response, evidence), encoding="utf-8"
    )
    return output_dir


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="prepare an offline authoring packet")
    prepare.add_argument("--passages", type=Path, required=True)
    prepare.add_argument("--out", type=Path, required=True)
    prepare.add_argument("--title", required=True)
    prepare.add_argument("--target")
    prepare.add_argument("--capsule", type=Path)
    prepare.add_argument("--task-id")
    check = commands.add_parser("check", help="check an external author response")
    check.add_argument("--packet", type=Path, required=True)
    check.add_argument("--response", type=Path, required=True)
    check.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the ``prepare`` or ``check`` command and return a process status."""
    args = _parser().parse_args(argv)
    try:
        if args.command == "prepare":
            output = prepare_packet(
                passages_path=args.passages,
                output_dir=args.out,
                title=args.title,
                target=args.target,
                capsule_path=args.capsule,
                task_id=args.task_id,
            )
        else:
            output = check_response(
                packet_dir=args.packet,
                response_path=args.response,
                output_dir=args.out,
            )
    except PacketError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
