#!/usr/bin/env python
"""Prepare and check provider-free literature experience authoring packets."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

ROOT = Path(__file__).resolve().parents[1]
for package_path in (
    ROOT / "packages" / "perspicacite-client" / "python",
    ROOT / "packages" / "lesson-plan-schema" / "python",
    ROOT / "packages" / "lesson-bundle-schema" / "python",
):
    if str(package_path) not in sys.path:
        sys.path.insert(0, str(package_path))

from lesson_bundle_schema import LessonBundle  # noqa: E402
from lesson_plan_schema import (  # noqa: E402
    LearningObjective,
    LessonPlan,
    PlanStatus,
    RefType,
    SceneOutline,
)
from perspicacite_mcp.passages import (  # noqa: E402
    PassageEnvelopeError,
    normalize_passage_envelope,
)

PACKET_SCHEMA_VERSION = "1.0"
ASB_SOURCE_PREFIX = "asb:"
DEFAULT_VALIDATED_BY = "DRAFT — not validated"
LEGACY_SIMULATION_TYPE = "simulation"
PLACEHOLDER_RUBRIC = {
    "completeness": 0.6,
    "evidence_quality": 0.3,
    "tone": 0.1,
}
EXECUTION_CLAIM_KEYS = {
    "capsule_result",
    "execution_result",
    "reference_result",
    "run_result",
}
DEFAULT_REPLAY_RULE = {
    "id": "rule_2err_replay_concept",
    "when": {"consecutive_errors_same_concept": ">=2"},
    "action": {"kind": "replay_current_scene", "reason": "errors_threshold"},
    "modulator": "M1",
    "explanation_short": "Deux erreurs sur ce concept : on reprend la scène avec un appui.",
}
ENGLISH_FUNCTION_WORDS = frozenset(
    {
        "and",
        "are",
        "as",
        "by",
        "for",
        "from",
        "is",
        "of",
        "that",
        "the",
        "this",
        "to",
        "was",
        "were",
        "which",
        "with",
    }
)
ACCENTED_CHARACTER = re.compile(r"[À-ÖØ-öø-ÿ]")


class PacketError(ValueError):
    """Raised when packet preparation or response checking cannot proceed."""


class SourceQuoteError(PacketError):
    """Raised when a source link does not quote its passage exactly."""


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


def _output_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _require_output_permission(path: Path, force: bool, label: str) -> None:
    if _output_exists(path) and not force:
        raise PacketError(f"{label} already exists: {path}; use --force to overwrite it")


def _remove_output(path: Path, label: str) -> None:
    if not _output_exists(path):
        return
    try:
        if path.is_symlink() or not path.is_dir():
            path.unlink()
        else:
            shutil.rmtree(path)
    except OSError as exc:
        raise PacketError(f"cannot replace {label}: {exc}") from exc


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
    concept_ids = _unique_ids([item.id for item in plan.concepts], "concept")
    for concept in plan.concepts:
        unknown = set(concept.prerequisites) - concept_ids
        if unknown:
            raise PacketError(
                f"concept {concept.id!r} references unknown prerequisite {sorted(unknown)[0]!r}"
            )
    for scene in plan.scene_outlines:
        unknown = set(scene.objective_refs) - objective_ids
        if unknown:
            raise PacketError(f"scene {scene.id!r} references unknown objective {sorted(unknown)[0]!r}")
        unknown_concepts = set(scene.concept_refs) - concept_ids
        if unknown_concepts:
            raise PacketError(
                f"scene {scene.id!r} references unknown concept {sorted(unknown_concepts)[0]!r}"
            )
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
            raise SourceQuoteError(
                f"source link quote is not an exact substring of {link.evidence_id!r}"
            )
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


def check_response(
    *, packet_dir: Path, response_path: Path, output_dir: Path, force: bool = False
) -> Path:
    """Validate an external author response and emit teacher-review artifacts."""
    output_dir = output_dir.absolute()
    _require_output_permission(output_dir, force, "output directory")
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
    _remove_output(output_dir, "output directory")
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


@dataclass(frozen=True)
class _BundleContext:
    plan: LessonPlan
    objectives: dict[str, LearningObjective]
    links_by_scene: dict[str, list[SourceLink]]
    concept_ids: set[str]


def _load_checked_plan(course_dir: Path) -> LessonPlan:
    value, _ = _load_json(course_dir / "plan.json", "checked lesson plan")
    try:
        return LessonPlan.model_validate(value)
    except ValidationError as exc:
        raise PacketError(f"checked plan is invalid: {exc}") from exc


def _load_checked_links(course_dir: Path) -> list[SourceLink]:
    value, _ = _load_json(course_dir / "source_links.json", "checked source links")
    if not isinstance(value, dict) or value.get("schema_version") != PACKET_SCHEMA_VERSION:
        raise PacketError("unsupported checked source-link schema")
    if not isinstance(value.get("source_links"), list):
        raise PacketError("checked source links must contain a source_links list")
    try:
        return [SourceLink.model_validate(link) for link in value["source_links"]]
    except ValidationError as exc:
        raise PacketError(f"checked source link is invalid: {exc}") from exc


def _validate_checked_course(
    plan: LessonPlan,
    evidence: dict[str, Any],
    sources: dict[str, dict[str, Any]],
    links: list[SourceLink],
) -> None:
    asb_task = evidence.get("asb_task")
    selected_task = asb_task if isinstance(asb_task, dict) else None
    allowed_sources = set(sources)
    if selected_task:
        allowed_sources.add(selected_task["source_id"])
    _, scene_ids = _validate_plan_graph(plan, allowed_sources)
    _validate_corpus(plan, sources, selected_task)
    _validate_asb(plan, evidence)
    _validate_embedded_evidence(plan, sources)
    _validate_links(links, sources, scene_ids)


def _load_checked_course(
    course_dir: Path,
) -> tuple[LessonPlan, dict[str, Any], dict[str, dict[str, Any]], list[SourceLink]]:
    course_dir = course_dir.resolve()
    plan = _load_checked_plan(course_dir)
    evidence_value, _ = _load_json(course_dir / "evidence.json", "checked evidence")
    sources = _validate_packet(evidence_value)
    links = _load_checked_links(course_dir)
    _validate_checked_course(plan, evidence_value, sources, links)
    return plan, evidence_value, sources, links


def _source_label(source: dict[str, Any]) -> str:
    return source.get("title") or source.get("source_doi") or source.get("source_url") or source["evidence_id"]


def _unique_sources(sources: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for source in sources.values():
        locator = source.get("source_doi") or source.get("source_url") or source.get("source_id")
        key = (locator, source.get("title"), source.get("license_id"))
        unique.setdefault(key, source)
    return list(unique.values())


def _license_restrictions(license_id: str | None) -> list[str]:
    if not license_id:
        return []
    tokens = set(re.split(r"[^A-Z0-9]+", license_id.upper()))
    return sorted(tokens.intersection({"NC", "ND"}))


def _is_unknown_license(license_id: str | None) -> bool:
    if not license_id or not license_id.strip():
        return True
    normalized = license_id.strip().lower()
    return normalized in {"unknown", "unspecified", "n/a", "none", "noassertion"}


def _quote_language(quote: str, plan_language: str) -> str:
    language = plan_language.lower().split("-", maxsplit=1)[0]
    words = set(re.findall(r"[a-z]+", quote.lower()))
    is_likely_english = (
        language == "fr"
        and ACCENTED_CHARACTER.search(quote) is None
        and bool(words.intersection(ENGLISH_FUNCTION_WORDS))
    )
    return "en" if is_likely_english else "same as plan"


def _source_languages(links: list[SourceLink], plan_language: str) -> str:
    labels = dict.fromkeys(_quote_language(link.quote, plan_language) for link in links)
    return ", ".join(labels) or "same as plan"


def _human_review_lines(plan: LessonPlan) -> list[str]:
    lines: list[str] = []
    for scene in plan.scene_outlines:
        if scene.notes and "TODO review" in scene.notes:
            lines.append(f"- {scene.id}: {scene.notes}")
        if scene.evidence_override == "skip":
            lines.append(f"- {scene.id}: evidence_override=skip")
    return lines


def _warning_lines(plan: LessonPlan, sources: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for source in sources:
        license_id = source.get("license_id")
        label = _source_label(source)
        if _is_unknown_license(license_id):
            lines.append(f"WARN: licence is unknown or missing — {label}")
        for restriction in _license_restrictions(license_id):
            lines.append(f"WARN: licence contains {restriction} — {label}: {license_id}")
    if any(scene.type.value == LEGACY_SIMULATION_TYPE for scene in plan.scene_outlines):
        lines.append(
            "WARN: scene type 'simulation' is not playable by LessonBundle 1.4; "
            "bundle will emit a TODO concept placeholder"
        )
    context = _bundle_context(plan, [])
    # intro and meta_checkpoint scenes carry no concept by design (nothing to master there);
    # warning on them would train teachers to ignore the warning.
    for scene in plan.scene_outlines:
        if scene.type.value in ("intro", "meta_checkpoint"):
            continue
        if not _scene_concept_refs(scene, context):
            lines.append(
                f"WARN: scene {scene.id!r} reaches no concept; "
                "a scene without a concept moves no mastery"
            )
    return lines


def check_summary_lines(course_dir: Path) -> list[str]:
    """Return a human-readable summary for a technically checked course."""
    plan, _, sources, links = _load_checked_course(course_dir)
    counts = Counter(scene.type.value for scene in plan.scene_outlines)
    count_text = ", ".join(f"{kind}: {counts[kind]}" for kind in sorted(counts))
    cited = {link.evidence_id for link in links}
    cited_ids = [source_id for source_id in sources if source_id in cited]
    uncited_ids = [source_id for source_id in sources if source_id not in cited]
    unique_sources = _unique_sources(sources)
    lines = [
        "CHECK OK",
        (
            f"Plan language: {plan.language}; {len(links)} source quotes verified verbatim "
            f"in {_source_languages(links, plan.language)}"
        ),
        f"Scenes: {len(plan.scene_outlines)} ({count_text})",
        f"Concepts: {len(plan.concepts)}",
        f"Source links: {len(links)}",
        f"Passages: {len(cited_ids)} cited, {len(uncited_ids)} uncited",
        f"Cited evidence IDs: {', '.join(cited_ids) or 'none'}",
        f"Uncited evidence IDs: {', '.join(uncited_ids) or 'none'}",
        "Licences:",
    ]
    lines.extend(
        f"- {_source_label(source)}: {source.get('license_id') or 'unknown'}"
        for source in unique_sources
    )
    lines.extend(_warning_lines(plan, unique_sources))
    human_review = _human_review_lines(plan)
    if human_review:
        lines.append("Not verifiable by quote:")
        lines.extend(human_review)
    lines.append(f"Output: {course_dir.resolve()}")
    return lines


def _bundle_concepts(plan: LessonPlan) -> list[dict[str, Any]]:
    if plan.concepts:
        return [
            concept.model_dump(mode="json", exclude={"prerequisites"})
            for concept in plan.concepts
        ]
    return [
        {
            "id": objective.id,
            "title": objective.description,
            "description": objective.description,
            "bloom_level_target": objective.bloom_level.value,
        }
        for objective in plan.learning_objectives
    ]


def _links_by_scene(links: list[SourceLink]) -> dict[str, list[SourceLink]]:
    grouped: dict[str, list[SourceLink]] = {}
    for link in links:
        grouped.setdefault(link.scene_id, []).append(link)
    return grouped


def _bundle_context(plan: LessonPlan, links: list[SourceLink]) -> _BundleContext:
    concepts = _bundle_concepts(plan)
    return _BundleContext(
        plan=plan,
        objectives={objective.id: objective for objective in plan.learning_objectives},
        links_by_scene=_links_by_scene(links),
        concept_ids={concept["id"] for concept in concepts},
    )


def _known_concept_id(candidate: str, concept_ids: set[str]) -> str | None:
    if candidate in concept_ids:
        return candidate
    if candidate.startswith("concept:") and candidate.removeprefix("concept:") in concept_ids:
        return candidate.removeprefix("concept:")
    return None


def _graph_concept_candidates(scene: SceneOutline, plan: LessonPlan) -> list[str]:
    graph = plan.learning_workflow_graph
    if not isinstance(graph, dict) or not isinstance(graph.get("edges"), list):
        return []
    task_ids = {scene.id, f"task:{scene.id}"}
    return [
        edge["target"]
        for edge in graph["edges"]
        if isinstance(edge, dict)
        and edge.get("relation") == "assesses"
        and edge.get("source") in task_ids
        and isinstance(edge.get("target"), str)
    ]


def _scene_concept_refs(scene: SceneOutline, context: _BundleContext) -> list[str]:
    candidates = list(scene.concept_refs)
    candidates.extend(scene.skos_concept_uris or [])
    for objective_id in scene.objective_refs:
        objective = context.objectives[objective_id]
        candidates.extend(objective.concept_uris or [])
        if objective.skos_concept_uri:
            candidates.append(objective.skos_concept_uri)
    candidates.extend(_graph_concept_candidates(scene, context.plan))
    refs: list[str] = []
    for candidate in candidates:
        concept_id = _known_concept_id(candidate, context.concept_ids)
        if concept_id and concept_id not in refs:
            refs.append(concept_id)
    return refs


def _objective_texts(scene: SceneOutline, context: _BundleContext) -> list[str]:
    texts = [context.objectives[ref].description for ref in scene.objective_refs]
    return texts or ["TODO: préciser l'objectif d'apprentissage"]


def _placeholder_key_points(
    scene: SceneOutline, context: _BundleContext, maximum: int | None = None
) -> list[dict[str, Any]]:
    texts = _objective_texts(scene, context)
    if maximum is not None:
        texts = texts[:maximum]
    return [
        {
            "id": f"todo-key-point-{index}",
            "text": text,
            "cues": ["TODO: mot-clé ou expression d'évaluation"],
        }
        for index, text in enumerate(texts, start=1)
    ]


def _placeholder_claims(
    scene: SceneOutline, context: _BundleContext, maximum: int
) -> list[dict[str, Any]]:
    return [
        {
            "id": f"todo-claim-{index}",
            "text": f"TODO: affirmation à auditer — {text}",
            "flaws_expected": ["TODO: défaut attendu"],
        }
        for index, text in enumerate(_objective_texts(scene, context)[:maximum], start=1)
    ]


def _source_context(scene_id: str, context: _BundleContext) -> str:
    links = context.links_by_scene.get(scene_id, [])
    if not links:
        return "TODO: ajouter un extrait source vérifié"
    return "\n".join(f"- “{link.quote}” ({link.evidence_id})" for link in links)


def _base_scene(
    scene: SceneOutline, context: _BundleContext, runtime_type: str | None = None
) -> dict[str, Any]:
    return {
        "id": scene.id,
        "type": runtime_type or scene.type.value,
        "title": scene.title,
        "objective_refs": list(scene.objective_refs),
        "concept_refs": _scene_concept_refs(scene, context),
        "estimated_seconds": (scene.duration_minutes or 1) * 60,
        "adaptation_hooks": [],
    }


def _build_reading_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    markdown = (
        f"TODO: rédiger le contenu de la scène « {scene.title} ».\n\n"
        f"Extraits source vérifiés :\n{_source_context(scene.id, context)}"
    )
    return {**base, "markdown": markdown}


def _build_quiz_scene(
    base: dict[str, Any], scene: SceneOutline, _context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "question": scene.notes or f"TODO: rédiger la question — {scene.title}",
        "choices": [
            {"id": "todo-correct", "text": "TODO: réponse correcte", "correct": True},
            {"id": "todo-distractor", "text": "TODO: distracteur", "correct": False},
        ],
        "feedback_correct": "TODO: retour pour la réponse correcte",
        "feedback_incorrect": "TODO: retour pour la réponse incorrecte",
        "hints": [],
    }


def _build_checkpoint_scene(
    base: dict[str, Any], _scene: SceneOutline, _context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "pre_question": "TODO: question de confiance avant l'activité",
        "post_question": "TODO: question de confiance après l'activité",
        "scale_labels": [f"TODO: niveau {level}" for level in range(1, 6)],
    }


def _build_reproduction_scene(
    base: dict[str, Any], scene: SceneOutline, _context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "task_card_id": scene.abs_task_card_id or f"TODO:{scene.id}:task-card",
        "steps": [
            {
                "step_id": "todo-step-1",
                "instruction": "TODO: décrire l'étape de reproduction",
                "expected_input_schema": {"type": "object"},
                "expected_output": "TODO: décrire la sortie attendue",
            }
        ],
    }


def _build_ai_critique_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "claims": _placeholder_claims(scene, context, 3),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_discussion_scene(
    base: dict[str, Any], scene: SceneOutline, _context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "topic": f"TODO: sujet de discussion — {scene.title}",
        "seed_claim": "TODO: affirmation de départ à discuter",
        "target_signals": ["justification"],
        "max_turns": 4,
    }


def _build_spot_the_flaw_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "flawed_content": "TODO: contenu délibérément erroné à auditer",
        "claims": _placeholder_claims(scene, context, 5),
        # The reveal must NAME every expected flaw (tools/bundle_lint.mjs flaw_reveal_gap): a
        # skeleton that does not already satisfies that rule would fail the lint before the
        # teacher wrote a word, so the placeholder repeats the placeholder flaw.
        "model_correction": (
            "TODO: correction de référence — elle doit nommer chaque défaut attendu "
            "(ici : « TODO: défaut attendu »)."
        ),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_explain_back_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "prompt": f"TODO: demander à l'apprenant d'expliquer — {scene.title}",
        "key_points": _placeholder_key_points(scene, context, 6),
        "model_explanation": "TODO: explication de référence",
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_comparison_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "prompt": "TODO: consigne de comparaison",
        "artifact_a": "TODO: premier artefact à comparer",
        "artifact_b": "TODO: second artefact à comparer",
        "key_points": _placeholder_key_points(scene, context),
        "model_answer": "TODO: comparaison de référence",
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_summary_audit_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "source_content": _source_context(scene.id, context),
        "ai_summary": "TODO: résumé IA à auditer",
        "claims": _placeholder_claims(scene, context, 5),
        "model_correction": (
            "TODO: résumé corrigé de référence — il doit nommer chaque défaut attendu "
            "(ici : « TODO: défaut attendu »)."
        ),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_prompt_practice_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "task": f"TODO: tâche de prompting — {scene.title}",
        "starter_prompt": "TODO: prompt initial à améliorer",
        "key_points": _placeholder_key_points(scene, context),
        "model_prompt": "TODO: prompt de référence",
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_communication_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "scenario": f"TODO: situation professionnelle — {scene.title}",
        "prompt": "TODO: consigne de communication",
        "key_points": _placeholder_key_points(scene, context),
        "model_response": "TODO: réponse de référence",
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


_SCENE_BUILDERS = {
    "intro": _build_reading_scene,
    "concept": _build_reading_scene,
    "quiz": _build_quiz_scene,
    "meta_checkpoint": _build_checkpoint_scene,
    "reproduction": _build_reproduction_scene,
    "ai_critique": _build_ai_critique_scene,
    "discussion": _build_discussion_scene,
    "spot_the_flaw": _build_spot_the_flaw_scene,
    "explain_back": _build_explain_back_scene,
    "comparison": _build_comparison_scene,
    "summary_audit": _build_summary_audit_scene,
    "prompt_practice": _build_prompt_practice_scene,
    "communication_sim": _build_communication_scene,
}


def _build_bundle_scene(scene: SceneOutline, context: _BundleContext) -> dict[str, Any]:
    if scene.type.value == LEGACY_SIMULATION_TYPE:
        base = _base_scene(scene, context, runtime_type="concept")
        return {
            **base,
            "markdown": (
                "TODO: remplacer cette ancienne scène `simulation` par une scène jouable "
                "et ajouter son support interactif.\n\n"
                f"Extraits source vérifiés :\n{_source_context(scene.id, context)}"
            ),
        }
    base = _base_scene(scene, context)
    return _SCENE_BUILDERS[scene.type.value](base, scene, context)


def _bundle_id(plan_id: str) -> str:
    candidate = plan_id.removesuffix("-draft")
    return candidate or plan_id


def _bundle_metadata(plan: LessonPlan) -> dict[str, Any]:
    subject = plan.metadata.subject if plan.metadata else None
    return {
        "title": plan.title,
        "target": plan.target,
        "duration_minutes": plan.duration_minutes,
        "language": plan.language,
        "discipline": subject or plan.dct_subject or "TODO: discipline à préciser",
    }


def _concept_graph_nodes(concepts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"concept:{concept['id']}",
            "node_kind": "concept",
            "title": concept["title"],
            "bloom_level": concept["bloom_level_target"],
            "description": concept["description"],
        }
        for concept in concepts
    ]


def _prerequisite_graph_edges(plan: LessonPlan) -> list[dict[str, Any]]:
    return [
        {
            "id": f"prerequisite:{concept.id}:{prerequisite}",
            "relation": "prerequisite_for",
            # Engine convention: the dependent points to its prerequisite.
            "source": f"concept:{concept.id}",
            "target": f"concept:{prerequisite}",
        }
        for concept in plan.concepts
        for prerequisite in concept.prerequisites
    ]


def _merge_generated_graph_parts(
    graph: dict[str, Any], nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> None:
    existing_nodes = graph.get("nodes")
    existing_edges = graph.get("edges")
    if not isinstance(existing_nodes, list) or not isinstance(existing_edges, list):
        return
    node_ids = {node.get("id") for node in existing_nodes if isinstance(node, dict)}
    existing_nodes.extend(node for node in nodes if node["id"] not in node_ids)
    edge_pairs = {
        (edge.get("relation"), edge.get("source"), edge.get("target"))
        for edge in existing_edges
        if isinstance(edge, dict)
    }
    edge_ids = {edge.get("id") for edge in existing_edges if isinstance(edge, dict)}
    for edge in edges:
        pair = (edge["relation"], edge["source"], edge["target"])
        if pair in edge_pairs:
            continue
        base_id = edge["id"]
        suffix = 2
        while edge["id"] in edge_ids:
            edge["id"] = f"{base_id}:{suffix}"
            suffix += 1
        existing_edges.append(edge)
        edge_pairs.add(pair)
        edge_ids.add(edge["id"])


def _bundle_graph(plan: LessonPlan, concepts: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = _concept_graph_nodes(concepts)
    edges = _prerequisite_graph_edges(plan)
    if plan.learning_workflow_graph is not None:
        graph = deepcopy(plan.learning_workflow_graph)
        _merge_generated_graph_parts(graph, nodes, edges)
        return graph
    return {
        "schema_version": "1.0",
        "course_id": _bundle_id(plan.id),
        "nodes": nodes,
        "edges": edges,
    }


def _bundle_payload(
    plan: LessonPlan,
    links: list[SourceLink],
    validated_by: str | None,
    include_default_rules: bool,
) -> dict[str, Any]:
    concepts = _bundle_concepts(plan)
    context = _bundle_context(plan, links)
    payload: dict[str, Any] = {
        "schema_version": "1.4",
        "bundle_id": _bundle_id(plan.id),
        "source_plan_id": plan.id,
        "metadata": _bundle_metadata(plan),
        "concepts": concepts,
        "scenes": [_build_bundle_scene(scene, context) for scene in plan.scene_outlines],
        "rules": [deepcopy(DEFAULT_REPLAY_RULE)] if include_default_rules else [],
        "validated_by": (validated_by or DEFAULT_VALIDATED_BY).strip() or DEFAULT_VALIDATED_BY,
        "validated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "learning_workflow_graph": _bundle_graph(plan, concepts),
    }
    return payload


def _validated_bundle_payload(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        bundle = LessonBundle.model_validate(payload)
    except ValidationError as exc:
        raise PacketError(f"generated LessonBundle is invalid: {exc}") from exc
    return bundle.model_dump(mode="json", exclude_none=True)


def build_lesson_bundle(
    *,
    course_dir: Path,
    output_path: Path,
    validated_by: str | None = None,
    force: bool = False,
    include_default_rules: bool = True,
) -> Path:
    """Build a schema-valid LessonBundle 1.4 skeleton from a checked course."""
    output_path = output_path.absolute()
    _require_output_permission(output_path, force, "output file")
    plan, _, _, links = _load_checked_course(course_dir)
    bundle = _validated_bundle_payload(
        _bundle_payload(plan, links, validated_by, include_default_rules)
    )
    _remove_output(output_path, "output file")
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(_json_bytes(bundle))
    except OSError as exc:
        raise PacketError(f"cannot write LessonBundle: {exc}") from exc
    return output_path


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
    check.add_argument("--force", action="store_true", help="replace an existing output")
    check.add_argument("--quiet", action="store_true", help="print only the output path")
    bundle = commands.add_parser("bundle", help="build a playable LessonBundle skeleton")
    bundle.add_argument("--course", type=Path, required=True)
    bundle.add_argument("--out", type=Path, required=True)
    bundle.add_argument("--validated-by")
    bundle.add_argument("--force", action="store_true", help="replace an existing output")
    bundle.add_argument(
        "--no-default-rules",
        action="store_true",
        help="omit the default two-error replay rule",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run a packet command and return its process status."""
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
        elif args.command == "check":
            output = check_response(
                packet_dir=args.packet,
                response_path=args.response,
                output_dir=args.out,
                force=args.force,
            )
        else:
            output = build_lesson_bundle(
                course_dir=args.course,
                output_path=args.out,
                validated_by=args.validated_by,
                force=args.force,
                include_default_rules=not args.no_default_rules,
            )
    except SourceQuoteError as exc:
        print(f"ERROR: {exc}")
        return 1
    except PacketError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.command == "check" and not args.quiet:
        print("\n".join(check_summary_lines(output)))
        return 0
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
