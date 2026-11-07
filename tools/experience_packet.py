#!/usr/bin/env python
"""Prepare and check provider-free literature experience authoring packets.

Commands: ``passages`` captures a learner-chosen URL, HTML page, PDF or text file as a passage
envelope; ``prepare`` turns an envelope into an authoring packet; ``check`` validates an
external author response; ``bundle`` builds a playable LessonBundle skeleton; ``approve``
records teacher review of the filled bundle without rebuilding it.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import unicodedata
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
# Appended, not prepended: sibling modules resolve under `python -I` without shadowing anything.
if str(ROOT / "tools") not in sys.path:
    sys.path.append(str(ROOT / "tools"))

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
from self_study_passages import (  # noqa: E402
    DEFAULT_LICENSE_ID,
    DEFAULT_MAX_CHARS,
    DEFAULT_MIN_CHARS,
    REFERENCE_KINDS,
    PassageCapture,
    PassageCaptureError,
    build_passage_envelope,
    is_self_study_origin,
)

PACKET_SCHEMA_VERSION = "1.0"
TOOL_VERSION = "1.0"
APPROVAL_SCHEMA = "studium-approval/1"
ASB_SOURCE_PREFIX = "asb:"
PERSPICACITE_EVIDENCE_PREFIX = "perspicacite:"
SELF_STUDY_EVIDENCE_PREFIX = "passage:"
EVIDENCE_HASH_LENGTH = 24
TEACHER_AUTHOR_PROMPT = "experience_author.md"
SELF_STUDY_AUTHOR_PROMPT = "experience_author_self_study.md"
DEFAULT_VALIDATED_BY = "DRAFT — not validated"
SELF_STUDY_VALIDATED_BY = "SELF-STUDY — not teacher-validated"
SELF_STUDY_MODE = "self_study"
LEGACY_SIMULATION_TYPE = "simulation"
LEGACY_SIMULATION_RUNTIME_TYPE = "concept"
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
ENGLISH_REPLAY_EXPLANATION = (
    "Two errors on this concept: replay the scene with support."
)
PLACEHOLDER_PATTERN = re.compile(r"^TODO\b|TODO:")
TYPOGRAPHIC_APOSTROPHES = "‘’ʼ"
NON_BREAKING_SPACES = "\u00a0\u202f"
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
# Who wrote the key each LessonBundle 1.4 scene type is graded against. Source of truth: the spec
# studium_dev/docs/superpowers/specs/2026-10-30-lot-apprenant-autonome.md, « Classes de clé »;
# the same table lives in tools/bundle_lint.mjs and in the TypeScript runtime.
SCENE_KEY_CLASS = {
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
LISTED_KEY_CLASSES = ("author_keyed", "production", "externally_grounded")
UNGRADED_KEY_CLASS = "ungraded"
UNKNOWN_KEY_CLASS = "unknown"

AUTHORING_TEXT = {
    "en": {
        "objective": "TODO: specify the learning objective",
        "cue": "TODO: evaluation keyword or phrase",
        "claim": "TODO: claim to audit — {text}",
        "flaw": "TODO: expected flaw",
        "source": "TODO: add a verified source excerpt",
        "scene_content": "TODO: write the content for scene “{title}”.",
        "source_heading": "Verified source excerpts:",
        "quiz_question": "TODO: write the question — {title}",
        "correct_answer": "TODO: correct answer",
        "distractor": "TODO: distractor",
        "correct_feedback": "TODO: feedback for the correct answer",
        "incorrect_feedback": "TODO: feedback for the incorrect answer",
        "pre_question": "TODO: confidence question before the activity",
        "post_question": "TODO: confidence question after the activity",
        "scale_level": "TODO: level {level}",
        "reproduction_step": "TODO: describe the reproduction step",
        "expected_output": "TODO: describe the expected output",
        "discussion_topic": "TODO: discussion topic — {title}",
        "seed_claim": "TODO: opening claim to discuss",
        "flawed_content": "TODO: deliberately flawed content to audit",
        "model_correction": (
            "TODO: reference correction — it must name every expected flaw "
            "(here: “TODO: expected flaw”)."
        ),
        "explain_prompt": "TODO: ask the learner to explain — {title}",
        "model_explanation": "TODO: reference explanation",
        "comparison_prompt": "TODO: comparison instruction",
        "artifact_a": "TODO: first artifact to compare",
        "artifact_b": "TODO: second artifact to compare",
        "model_answer": "TODO: reference comparison",
        "ai_summary": "TODO: AI summary to audit",
        "corrected_summary": (
            "TODO: corrected reference summary — it must name every expected flaw "
            "(here: “TODO: expected flaw”)."
        ),
        "prompt_task": "TODO: prompting task — {title}",
        "starter_prompt": "TODO: initial prompt to improve",
        "model_prompt": "TODO: reference prompt",
        "communication_scenario": "TODO: professional situation — {title}",
        "communication_prompt": "TODO: communication instruction",
        "model_response": "TODO: reference response",
        "legacy_simulation": (
            "TODO: replace this legacy `simulation` scene with a playable scene "
            "and add its interactive support."
        ),
        "discipline": "TODO: specify the discipline",
    },
    "fr": {
        "objective": "TODO: préciser l’objectif d’apprentissage",
        "cue": "TODO: mot-clé ou expression d’évaluation",
        "claim": "TODO: affirmation à auditer — {text}",
        "flaw": "TODO: défaut attendu",
        "source": "TODO: ajouter un extrait source vérifié",
        "scene_content": "TODO: rédiger le contenu de la scène « {title} ».",
        "source_heading": "Extraits source vérifiés :",
        "quiz_question": "TODO: rédiger la question — {title}",
        "correct_answer": "TODO: réponse correcte",
        "distractor": "TODO: distracteur",
        "correct_feedback": "TODO: retour pour la réponse correcte",
        "incorrect_feedback": "TODO: retour pour la réponse incorrecte",
        "pre_question": "TODO: question de confiance avant l’activité",
        "post_question": "TODO: question de confiance après l’activité",
        "scale_level": "TODO: niveau {level}",
        "reproduction_step": "TODO: décrire l’étape de reproduction",
        "expected_output": "TODO: décrire la sortie attendue",
        "discussion_topic": "TODO: sujet de discussion — {title}",
        "seed_claim": "TODO: affirmation de départ à discuter",
        "flawed_content": "TODO: contenu délibérément erroné à auditer",
        "model_correction": (
            "TODO: correction de référence — elle doit nommer chaque défaut attendu "
            "(ici : « TODO: défaut attendu »)."
        ),
        "explain_prompt": "TODO: demander à l’apprenant d’expliquer — {title}",
        "model_explanation": "TODO: explication de référence",
        "comparison_prompt": "TODO: consigne de comparaison",
        "artifact_a": "TODO: premier artefact à comparer",
        "artifact_b": "TODO: second artefact à comparer",
        "model_answer": "TODO: comparaison de référence",
        "ai_summary": "TODO: résumé IA à auditer",
        "corrected_summary": (
            "TODO: résumé corrigé de référence — il doit nommer chaque défaut attendu "
            "(ici : « TODO: défaut attendu »)."
        ),
        "prompt_task": "TODO: tâche de prompting — {title}",
        "starter_prompt": "TODO: prompt initial à améliorer",
        "model_prompt": "TODO: prompt de référence",
        "communication_scenario": "TODO: situation professionnelle — {title}",
        "communication_prompt": "TODO: consigne de communication",
        "model_response": "TODO: réponse de référence",
        "legacy_simulation": (
            "TODO: remplacer cette ancienne scène `simulation` par une scène jouable "
            "et ajouter son support interactif."
        ),
        "discipline": "TODO: discipline à préciser",
    },
}

REVIEW_TEXT = {
    "en": {
        "teacher_heading": "# Teacher review handoff",
        "self_heading": "# Self-study review handoff",
        "status": "Status: technical checks only; this LessonPlan remains a draft.",
        "checked_heading": "## Checked",
        "links": "{count} source link(s) use known evidence IDs and exact quotes.",
        "viewers": "{count} viewer brief(s) reference known scenes and sources.",
        "references": "Objective, scene, corpus, and optional ASB task references resolve.",
        "no_approval": "No teacher approval or structured capsule execution result is claimed.",
        "source_heading": "## Source links",
        "attention_heading": "## Review attention",
        "unlinked": "Scenes without an explicit source link: {scenes}.",
        "asb": "ASB task `{task_id}` was captured but not executed by this tool.",
        "quote_limit": (
            "Exact quotation checks do not establish that paraphrases or conclusions are "
            "scientifically valid."
        ),
        "viewer_limit": "Viewer briefs have not been implemented, run, or inspected.",
        "self_limit": (
            "No teacher validates this lesson: the learner who wrote it answers for its accuracy, "
            "its pedagogy and its licences, and it stays a private self-study draft."
        ),
        "teacher_limit": (
            "A teacher must assess scientific accuracy, pedagogy, licensing, and learner release."
        ),
        "none": "none",
    },
    "fr": {
        "teacher_heading": "# Relais de relecture enseignant",
        "self_heading": "# Relais de relecture pour l’auto-apprentissage",
        "status": "Statut : vérifications techniques seulement ; ce LessonPlan reste un brouillon.",
        "checked_heading": "## Vérifications",
        "links": "{count} lien(s) source utilisent des identifiants connus et des citations exactes.",
        "viewers": "{count} brief(s) de visualisation référencent des scènes et sources connues.",
        "references": "Les références d’objectif, de scène, de corpus et de tâche ASB se résolvent.",
        "no_approval": "Aucune approbation enseignante ni exécution structurée de capsule n’est déclarée.",
        "source_heading": "## Liens vers les sources",
        "attention_heading": "## Points d’attention pour la relecture",
        "unlinked": "Scènes sans lien source explicite : {scenes}.",
        "asb": "La tâche ASB `{task_id}` a été capturée mais pas exécutée par cet outil.",
        "quote_limit": (
            "La vérification exacte des citations n’établit pas la validité scientifique des "
            "paraphrases ou conclusions."
        ),
        "viewer_limit": "Les briefs de visualisation n’ont été ni implémentés, ni exécutés, ni inspectés.",
        "self_limit": (
            "Aucun enseignant ne valide cette leçon : l’apprenant qui l’a écrite répond de son "
            "exactitude, de sa pédagogie et de ses licences ; elle reste un brouillon privé."
        ),
        "teacher_limit": (
            "Un enseignant doit évaluer l’exactitude scientifique, la pédagogie, les licences "
            "et la diffusion aux apprenants."
        ),
        "none": "aucune",
    },
}


def _locale(language: str) -> str:
    """Resolve the two supported authoring locales, defaulting safely to English."""
    return "fr" if language.lower().split("-", maxsplit=1)[0] == "fr" else "en"


def _authoring_text(language: str, key: str, **values: Any) -> str:
    """Render one generated authoring string in the lesson language."""
    return AUTHORING_TEXT[_locale(language)][key].format(**values)


class PacketError(ValueError):
    """Raised when packet preparation or response checking cannot proceed."""


class SourceQuoteError(PacketError):
    """Raised when a source link does not quote its passage exactly."""


@dataclass(frozen=True)
class CheckFinding:
    """One actionable authoring finding emitted by ``check``."""

    level: str
    code: str
    message: str
    scene_id: str | None = None
    link_index: int | None = None
    quote: str | None = None
    hint: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a compact JSON-ready representation, omitting absent location fields."""
        result: dict[str, Any] = {
            "level": self.level,
            "code": self.code,
            "message": self.message,
        }
        for name in ("scene_id", "link_index", "quote", "hint"):
            value = getattr(self, name)
            if value is not None:
                result[name] = value
        return result


class AuthoringFindingsError(PacketError):
    """Carry every authoring error found in a single ``check`` pass."""

    def __init__(self, findings: list[CheckFinding]) -> None:
        self.findings = findings
        super().__init__("; ".join(finding.message for finding in findings))


@dataclass(frozen=True)
class CheckReport:
    """Successful ``check`` output and its non-blocking warnings."""

    output_path: Path
    findings: list[CheckFinding]


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


# --- review receipts (INT-STUDIUM-058 § 2.9, task 6.2) ------------------------------------------
# review_lesson (packages/lesson-session-host/src/review-inbox.ts) marks each scene new / changed /
# unchanged by comparing its fingerprints with the last receipt's. The fingerprints written here must
# therefore be byte-for-byte the TypeScript ones; tools/test_review_receipt_parity.py holds that.

REVIEW_RECEIPT_SCHEMA = "studium/review-receipt/v1"
# Mirrors REDACTED_SCENE_FIELDS of packages/lesson-session-host/src/public-scene.ts.
KEY_HOLDING_SCENE_FIELDS = (
    "claims", "sound_claims", "key_points", "model_correction", "model_explanation", "model_answer",
    "model_prompt", "model_response", "feedback_correct", "feedback_incorrect", "hints",
)
# The evidence.abs_asset types sceneRenderAssets renders (ABS_KIND in lesson-bundle-schema/src/scene-assets.ts).
RENDERED_ABS_ASSET_TYPES = frozenset(
    {
        "spectrum_viewer_svg", "code_snippet", "script_snippet", "data_csv", "protocol_card_md",
        "plot_spec", "equation_latex", "orbital_viewer_3d", "molecule_3d", "spectrum_data",
    }
)
_PLACEHOLDER_SCENE_PATH = re.compile(r"^\$\.scenes\[(\d+)\]")


def _js_number(value: Any) -> str:
    """A JSON number as JavaScript's JSON.stringify writes it (ECMA-262 Number::toString).

    Python writes ``1.0``, ``1e-07`` and ``1e+16``; JavaScript writes ``1``, ``1e-7`` and
    ``10000000000000000``. ``repr`` already gives the shortest round-trip digits, as JavaScript does;
    only the layout differs.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        if abs(value) < 2**53:
            return str(value)
        value = float(value)  # JavaScript holds every number as a double
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{value!r} is not a JSON number")
    if value == 0:
        return "0"  # -0 included
    sign = "-" if value < 0 else ""
    mantissa, _, exponent = repr(abs(value)).partition("e")
    integral, _, fraction = mantissa.partition(".")
    digits = integral + fraction
    # value = 0.<digits> x 10^n
    n = len(integral) + (int(exponent) if exponent else 0)
    stripped = digits.lstrip("0")
    n -= len(digits) - len(stripped)
    s = stripped.rstrip("0")
    k = len(s)
    if k <= n <= 21:
        text = s + "0" * (n - k)
    elif 0 < n <= 21:
        text = s[:n] + "." + s[n:]
    elif -6 < n <= 0:
        text = "0." + "0" * (-n) + s
    else:
        e = n - 1
        text = (s if k == 1 else s[0] + "." + s[1:]) + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + text


def _canonical_json(value: Any) -> str:
    """The canonical JSON of review-inbox.ts ``canonicalJson``: compact, object keys sorted by code
    point at every depth, arrays in order, non-ASCII left as is, numbers as JavaScript writes them."""
    if value is None:
        return "null"
    if isinstance(value, (bool, int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(key, ensure_ascii=False)}:{_canonical_json(value[key])}" for key in sorted(value)
        ) + "}"
    raise ValueError(f"cannot write {type(value).__name__} as JSON")


def _scene_fingerprint(scene: Any) -> str:
    """sha256 hex of the scene's canonical JSON: the whole raw scene, answer keys included."""
    return _sha256(_canonical_json(scene).encode("utf-8"))


def _non_empty(value: Any) -> bool:
    # Same rule as review-inbox.ts: a blank string, an empty list or object, and null are empty.
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, dict)):
        return len(value) > 0
    return value is not None


def _js_truthy(value: Any) -> bool:
    # JavaScript truthiness: an empty list or object is truthy there, unlike in Python.
    if value is None or isinstance(value, (list, dict)):
        return value is not None
    if isinstance(value, (bool, int, float)):
        return bool(value) and not (isinstance(value, float) and math.isnan(value))
    return value != ""


def _scene_holds_key(scene: Any) -> bool:
    """A non-empty answer-bearing field, or a quiz choice marked correct (sceneHoldsKey)."""
    if not isinstance(scene, dict):
        return False
    if any(_non_empty(scene.get(field)) for field in KEY_HOLDING_SCENE_FIELDS):
        return True
    choices = scene.get("choices")
    return isinstance(choices, list) and any(
        isinstance(choice, dict) and choice.get("correct") is True for choice in choices
    )


def _scene_has_render_assets(scene: dict[str, Any]) -> bool:
    """What sceneRenderAssets looks at: render_assets, image_path, a rendered evidence.abs_asset,
    a reference_result that ran. A malformed render_assets makes the TypeScript call throw, which
    review-inbox.ts reads as no asset: only a non-empty list counts here."""
    render_assets = scene.get("render_assets")
    if isinstance(render_assets, list) and render_assets:
        return True
    if _js_truthy(scene.get("image_path")):
        return True
    evidence = scene.get("evidence")
    abs_asset = evidence.get("abs_asset") if isinstance(evidence, dict) else None
    if isinstance(abs_asset, dict) and abs_asset.get("asset_type") in RENDERED_ABS_ASSET_TYPES:
        return True
    reference = scene.get("reference_result")
    return isinstance(reference, dict) and _js_truthy(reference.get("ran"))


def _scene_id(scene: Any, index: int) -> str:
    scene_id = scene.get("id") if isinstance(scene, dict) else None
    return scene_id if isinstance(scene_id, str) else f"#{index}"


def _parse_opened(values: list[str] | None) -> list[str]:
    return [part.strip() for value in values or [] for part in value.split(",") if part.strip()]


def _review_receipt(
    *,
    bundle: dict[str, Any],
    bundle_bytes: bytes,
    bundle_path: Path,
    reviewer: str,
    decided_at: str,
    decision: str,
    opened: list[str],
    note: str | None,
) -> dict[str, Any]:
    """Build a v1 review receipt for the exact bytes reviewed; refuse an id that is not a scene.

    Consequence rule (the CLI's share of review-inbox.ts's): ``grading`` when the scene holds a
    key, else ``media`` when it has render assets, else ``wording``. ``blocks`` (a check fails) is
    written only for a returned lesson, for a scene with an unfilled placeholder: ``approve`` has
    already refused placeholders and lint ERRORs, so nothing blocks at approval time.
    """
    raw_scenes = bundle.get("scenes")
    scenes = raw_scenes if isinstance(raw_scenes, list) else []
    ids = [_scene_id(scene, index) for index, scene in enumerate(scenes)]
    unknown = sorted(set(opened) - set(ids))
    if unknown:
        raise PacketError(
            f"--opened names {len(unknown)} id(s) that are not scenes of this lesson: {', '.join(unknown)}"
        )
    blocked: set[int] = set()
    if decision == "returned":
        for path in placeholder_paths(bundle):
            match = _PLACEHOLDER_SCENE_PATH.match(path)
            if match:
                blocked.add(int(match.group(1)))
    items = []
    for index, (scene, scene_id) in enumerate(zip(scenes, ids)):
        record = scene if isinstance(scene, dict) else {}
        consequence = (
            "blocks" if index in blocked
            else "grading" if _scene_holds_key(scene)
            else "media" if _scene_has_render_assets(record)
            else "wording"
        )
        items.append(
            {
                "id": scene_id,
                "sha256": _scene_fingerprint(scene),
                "consequence": consequence,
                "opened": scene_id in opened,
            }
        )
    opened_count = sum(item["opened"] for item in items)
    bundle_id = bundle.get("bundle_id")
    receipt: dict[str, Any] = {
        "schema": REVIEW_RECEIPT_SCHEMA,
        "reviewer": reviewer,
        "decided_at": decided_at,
        "bundle_ref": bundle_id if isinstance(bundle_id, str) and bundle_id.strip() else bundle_path.parent.name,
        "bundle_sha256": _sha256(bundle_bytes),
        "decision": decision,
        "items": items,
        "opened": opened_count,
        "not_opened": len(items) - opened_count,
    }
    if note is not None:
        receipt["note"] = note
    return receipt


def _receipt_path(bundle_path: Path, decided_at: str, bundle_sha256: str) -> Path:
    # The name readLastReceipt accepts: <YYYY-MM-DD>-<hex>.json, next to lesson.json.
    return bundle_path.parent / "reviews" / f"{decided_at[:10]}-{bundle_sha256[:12]}.json"


def _refuse_existing_receipt(path: Path) -> None:
    if path.exists() or path.is_symlink():
        raise PacketError(
            f"review receipt already exists: {path}; the same lesson bytes were already decided on "
            "today, and a receipt is never overwritten"
        )


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:  # exclusive: never overwrite a receipt
        handle.write(_json_bytes(receipt))


def _receipt_summary(receipt_path: Path) -> list[str]:
    receipt, _ = _load_json(receipt_path, "review receipt")
    items = receipt.get("items") or []
    lines = [
        f"Review receipt ({receipt['decision']}): {receipt_path.resolve()}",
        f"opened {receipt['opened']} of {len(items)} items",
    ]
    if receipt["decision"] == "approved":
        unopened = [item["id"] for item in items if item["consequence"] == "grading" and not item["opened"]]
        if unopened:
            lines.append(
                f"warning: {len(unopened)} grading item(s) not opened before approval: {', '.join(unopened)}"
            )
    return lines


def record_review_receipt(
    *, bundle_path: Path, reviewer: str, decision: str, opened: list[str] | None = None, note: str | None = None
) -> Path:
    """Write a receipt alone, bound to the current bytes: a teacher who sends a lesson back."""
    if decision == "approved":
        raise PacketError("receipt records a returned lesson; to approve, use approve (it writes the receipt too)")
    if decision != "returned":
        raise PacketError(f"unknown decision {decision!r}")
    bundle_path = bundle_path.resolve()
    reviewer = reviewer.strip()
    if not reviewer:
        raise PacketError("--reviewer must not be empty")
    bundle, raw = _load_json(bundle_path, "LessonBundle")
    if not isinstance(bundle, dict):
        raise PacketError("LessonBundle root must be an object")
    decided_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    receipt = _review_receipt(
        bundle=bundle, bundle_bytes=raw, bundle_path=bundle_path, reviewer=reviewer,
        decided_at=decided_at, decision=decision, opened=opened or [], note=note,
    )
    path = _receipt_path(bundle_path, decided_at, receipt["bundle_sha256"])
    _refuse_existing_receipt(path)
    try:
        _write_receipt(path, receipt)
    except FileExistsError:
        _refuse_existing_receipt(path)
        raise
    except OSError as exc:
        raise PacketError(f"cannot write review receipt: {exc}") from exc
    return path


def _is_allowed_placeholder_id(value: str, key: str | None) -> bool:
    """Allow ``todo-*`` only in fields that are identifiers, never in visible prose."""
    is_identifier = key == "id" or bool(key and (key.endswith("_id") or key.endswith("_ids")))
    return is_identifier and value.lower().startswith("todo-")


def placeholder_paths(value: Any, path: str = "$", key: str | None = None) -> list[str]:
    """List learner-visible or grading strings that still carry a TODO placeholder."""
    if isinstance(value, dict):
        # `evidence` is quoted source text (excerpts are copied verbatim), never a field to fill;
        # tools/bundle_lint.mjs skips it the same way.
        return [
            found
            for child_key, child in value.items()
            if child_key != "evidence"
            for found in placeholder_paths(child, f"{path}.{child_key}", child_key)
        ]
    if isinstance(value, list):
        return [
            found
            for index, child in enumerate(value)
            for found in placeholder_paths(child, f"{path}[{index}]", key)
        ]
    if not isinstance(value, str) or _is_allowed_placeholder_id(value, key):
        return []
    return [path] if PLACEHOLDER_PATTERN.search(value.lstrip()) else []


def _load_json(path: Path, label: str) -> tuple[Any, bytes]:
    try:
        raw = path.read_bytes()
        return json.loads(raw), raw
    except (OSError, json.JSONDecodeError) as exc:
        raise PacketError(f"cannot read {label} JSON: {exc}") from exc


def _require_empty_directory(path: Path) -> None:
    """Refuse an output path that holds anything: a file, or a directory with entries."""
    if not path.exists():
        return
    if not path.is_dir() or any(path.iterdir()):
        raise PacketError(f"output directory already exists and is not empty: {path}")


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


def _source_record(passage: dict[str, Any], prefix: str) -> dict[str, Any]:
    record_sha = passage["sha256"]
    text_sha = _sha256(passage["text"].encode("utf-8"))
    return {
        "evidence_id": f"{prefix}{record_sha[:EVIDENCE_HASH_LENGTH]}",
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


def _source_records(normalized: dict[str, Any]) -> list[dict[str, Any]]:
    """Evidence records of a normalized envelope, ids prefixed by where the passages came from."""
    is_self_study = is_self_study_origin(normalized["origin"])
    prefix = SELF_STUDY_EVIDENCE_PREFIX if is_self_study else PERSPICACITE_EVIDENCE_PREFIX
    records = [_source_record(passage, prefix) for passage in normalized["passages"]]
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


def _render_author_task(evidence: dict[str, Any], template_name: str) -> str:
    template_path = ROOT / "tools" / "prompts" / template_name
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
    self_study: bool = False,
) -> Path:
    """Create a deterministic authoring packet from captured source JSON.

    Inputs are read as inert JSON. No model, capsule command, or source code is
    executed. ``output_dir`` must not exist or be an empty directory. The author brief
    is the self-study one when ``self_study`` is set or the envelope comes from
    ``passages`` (whose evidence ids are then prefixed ``passage:``).
    """
    output_dir = output_dir.resolve()
    _require_empty_directory(output_dir)
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
        "sources": _source_records(normalized),
        "asb_task": _asb_record(capsule_path, task_id) if capsule_path else None,
    }
    is_self_study = self_study or is_self_study_origin(normalized["origin"])
    author_task = _render_author_task(
        evidence, SELF_STUDY_AUTHOR_PROMPT if is_self_study else TEACHER_AUTHOR_PROMPT
    )
    response_schema = AuthorResponse.model_json_schema()
    output_dir.mkdir(parents=True, exist_ok=True)
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
    expected_sources = _source_records(normalized)
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


def _error(code: str, message: str, **location: Any) -> CheckFinding:
    """Build a blocking authoring finding with optional scene/link context."""
    return CheckFinding("ERROR", code, message, **location)


def _duplicates(values: list[str]) -> list[str]:
    """Return duplicate identifiers once, in their first repeated order."""
    counts = Counter(values)
    return list(dict.fromkeys(value for value in values if counts[value] > 1))


def _collect_plan_graph_findings(
    plan: LessonPlan, allowed_sources: set[str]
) -> list[CheckFinding]:
    findings: list[CheckFinding] = []
    objective_ids = [item.id for item in plan.learning_objectives]
    scene_ids = [item.id for item in plan.scene_outlines]
    concept_ids = [item.id for item in plan.concepts]
    for label, values in (
        ("objective", objective_ids),
        ("scene", scene_ids),
        ("concept", concept_ids),
    ):
        findings.extend(
            _error(f"duplicate_{label}", f"duplicate {label} ID {value!r}")
            for value in _duplicates(values)
        )
    objective_set, concept_set = set(objective_ids), set(concept_ids)
    for concept in plan.concepts:
        for unknown in sorted(set(concept.prerequisites) - concept_set):
            findings.append(
                _error(
                    "unknown_prerequisite",
                    f"concept {concept.id!r} references unknown prerequisite {unknown!r}",
                )
            )
    for scene in plan.scene_outlines:
        for unknown in sorted(set(scene.objective_refs) - objective_set):
            findings.append(
                _error(
                    "unknown_objective",
                    f"scene {scene.id!r} references unknown objective {unknown!r}",
                    scene_id=scene.id,
                )
            )
        for unknown in sorted(set(scene.concept_refs) - concept_set):
            findings.append(
                _error(
                    "unknown_concept",
                    f"scene {scene.id!r} references unknown concept {unknown!r}",
                    scene_id=scene.id,
                )
            )
        provenance = (scene.prov_derived_from or []) + (scene.dct_references or [])
        for unknown in sorted(set(provenance) - allowed_sources):
            findings.append(
                _error(
                    "unknown_evidence",
                    f"scene {scene.id!r} references unknown evidence {unknown!r}",
                    scene_id=scene.id,
                )
            )
    for unknown in sorted(set(plan.prov_derived_from or []) - allowed_sources):
        findings.append(_error("unknown_evidence", f"plan references unknown evidence {unknown!r}"))
    return findings


def _collect_corpus_findings(
    plan: LessonPlan,
    sources: dict[str, dict[str, Any]],
    asb_task: dict[str, Any] | None,
) -> list[CheckFinding]:
    findings: list[CheckFinding] = []
    for reference in plan.corpus_refs:
        try:
            source = sources.get(reference.ref_id)
            if source is not None:
                _validate_literature_corpus(reference, source)
            elif asb_task and reference.ref_id == asb_task["source_id"]:
                _validate_asb_corpus(reference, asb_task)
            else:
                raise PacketError(f"unknown corpus reference {reference.ref_id!r}")
        except PacketError as exc:
            findings.append(_error("invalid_corpus_reference", str(exc)))
    return findings


def _collect_asb_findings(
    plan: LessonPlan, asb_task: dict[str, Any] | None
) -> list[CheckFinding]:
    selected_id = asb_task.get("task_id") if asb_task else None
    findings: list[CheckFinding] = []
    for scene in plan.scene_outlines:
        task_ids = [scene.abs_task_card_id]
        task_ids.append(scene.evidence.abs_asset.abs_task_card_id if scene.evidence and scene.evidence.abs_asset else None)
        for task_id in task_ids:
            if task_id and task_id != selected_id:
                findings.append(
                    _error(
                        "unknown_asb_task",
                        f"scene {scene.id!r} references an unavailable ASB task",
                        scene_id=scene.id,
                    )
                )
    for reference in plan.corpus_refs:
        for task_id in reference.abs_task_card_ids or []:
            if task_id != selected_id:
                findings.append(
                    _error(
                        "unknown_asb_task",
                        f"corpus references an unavailable ASB task {task_id!r}",
                    )
                )
    return findings


def _collect_embedded_findings(
    plan: LessonPlan, sources: dict[str, dict[str, Any]]
) -> list[CheckFinding]:
    findings: list[CheckFinding] = []
    for scene in plan.scene_outlines:
        references = scene.evidence.bibliographic_refs if scene.evidence else None
        for reference in references or []:
            source = sources.get(reference.perspicacite_doc_id)
            problems: list[str] = []
            if source is None:
                problems.append("embeds unknown evidence")
            else:
                expected_title = source["title"] or "(untitled)"
                if reference.doi is not None and reference.doi != source["source_doi"]:
                    problems.append("bibliography DOI contradicts capture")
                if reference.title != expected_title:
                    problems.append("bibliography title contradicts capture")
                if reference.authors != source["authors"]:
                    problems.append("bibliography authors contradict capture")
                if reference.year != source["year"]:
                    problems.append("bibliography year contradicts capture")
                if source["score"] is None or reference.relevance_score != source["score"]:
                    problems.append("bibliography score contradicts capture")
                if reference.prov_derived_from != reference.perspicacite_doc_id:
                    problems.append("bibliography provenance contradicts capture")
                if not reference.excerpt or reference.excerpt not in source["text"]:
                    problems.append("embeds a non-exact evidence excerpt")
            findings.extend(
                _error(
                    "invalid_embedded_evidence",
                    f"scene {scene.id!r} {problem}",
                    scene_id=scene.id,
                )
                for problem in problems
            )
    return findings


def _normalize_typography(text: str) -> str:
    """Normalize comparison-only typography without weakening the exact quote gate."""
    translated = text.translate(str.maketrans({character: "'" for character in TYPOGRAPHIC_APOSTROPHES}))
    translated = translated.translate(str.maketrans({character: " " for character in NON_BREAKING_SPACES}))
    normalized = unicodedata.normalize("NFKC", translated)
    return re.sub(r"\s+", " ", normalized).strip()


def _typography_differences(quote: str, passage: str) -> list[str]:
    differences: list[str] = []
    quote_curly = any(character in quote for character in TYPOGRAPHIC_APOSTROPHES)
    passage_curly = any(character in passage for character in TYPOGRAPHIC_APOSTROPHES)
    if ("'" in quote and passage_curly) or (quote_curly and "'" in passage):
        differences.append("curly apostrophe (’) versus straight apostrophe (')")
    quote_nbsp = any(character in quote for character in NON_BREAKING_SPACES)
    passage_nbsp = any(character in passage for character in NON_BREAKING_SPACES)
    if quote_nbsp != passage_nbsp and " " in (quote if passage_nbsp else passage):
        differences.append("NBSP versus regular space")
    return differences


def _nearest_passage_hint(quote: str, source: dict[str, Any]) -> str:
    normalized_quote = _normalize_typography(quote)
    normalized_source = _normalize_typography(source["text"])
    start = normalized_source.find(normalized_quote)
    if start < 0:
        match = difflib.SequenceMatcher(
            None, normalized_quote, normalized_source, autojunk=False
        ).find_longest_match()
        start = max(0, match.b - match.a)
    excerpt = normalized_source[start : start + max(len(normalized_quote), 1)]
    similarity = difflib.SequenceMatcher(None, normalized_quote, excerpt).ratio()
    if len(excerpt) > 180:
        excerpt = excerpt[:177] + "…"
    differences = _typography_differences(quote, source["text"])
    detail = f" Typography difference: {', '.join(differences)}." if differences else ""
    return (
        f'Nearest passage in {source["evidence_id"]} after typographic normalization '
        f'({similarity:.0%} similar): "{excerpt}".{detail}'
    )


def _is_word_character(character: str) -> bool:
    return character.isalnum() or character in ("_-'" + TYPOGRAPHIC_APOSTROPHES)


def _quote_boundary_message(quote: str, passage: str) -> str | None:
    start = passage.find(quote)
    if start < 0:
        return None
    end = start + len(quote)
    boundaries: list[str] = []
    if start > 0 and _is_word_character(passage[start - 1]):
        boundaries.append("starts")
    if end < len(passage) and _is_word_character(passage[end]):
        boundaries.append("ends")
    if not boundaries:
        return None
    return f"quote {' and '.join(boundaries)} mid-word"


def _collect_link_findings(
    links: list[SourceLink], sources: dict[str, dict[str, Any]], scene_ids: set[str]
) -> list[CheckFinding]:
    findings: list[CheckFinding] = []
    seen: set[tuple[str, str, str]] = set()
    for link_index, link in enumerate(links, start=1):
        location = {
            "scene_id": link.scene_id,
            "link_index": link_index,
            "quote": link.quote,
        }
        if link.scene_id not in scene_ids:
            findings.append(
                _error(
                    "unknown_scene",
                    f"source link references unknown scene {link.scene_id!r}",
                    **location,
                )
            )
        source = sources.get(link.evidence_id)
        if source is None:
            findings.append(
                _error(
                    "unknown_evidence",
                    f"source link references unknown evidence {link.evidence_id!r}",
                    **location,
                )
            )
        elif link.quote not in source["text"]:
            findings.append(
                _error(
                    "quote_not_exact",
                    f"quote is not an exact substring of {link.evidence_id!r}",
                    hint=_nearest_passage_hint(link.quote, source),
                    **location,
                )
            )
        else:
            boundary = _quote_boundary_message(link.quote, source["text"])
            if boundary:
                findings.append(
                    CheckFinding("WARN", "quote_mid_word", boundary, **location)
                )
        identity = (link.scene_id, link.evidence_id, link.quote)
        if identity in seen:
            findings.append(_error("duplicate_source_link", "duplicate source link", **location))
        seen.add(identity)
    return findings


def _collect_viewer_findings(
    viewers: list[ViewerBrief], scene_ids: set[str], allowed_sources: set[str]
) -> list[CheckFinding]:
    findings = [
        _error("duplicate_viewer", f"duplicate viewer ID {viewer_id!r}")
        for viewer_id in _duplicates([viewer.id for viewer in viewers])
    ]
    for viewer in viewers:
        if viewer.scene_id not in scene_ids:
            findings.append(
                _error(
                    "unknown_scene",
                    f"viewer {viewer.id!r} references unknown scene",
                    scene_id=viewer.scene_id,
                )
            )
        for source_id in sorted(set(viewer.source_ids) - allowed_sources):
            findings.append(
                _error(
                    "unknown_source",
                    f"viewer {viewer.id!r} references unknown source {source_id!r}",
                    scene_id=viewer.scene_id,
                )
            )
    return findings


def _collect_check_findings(
    response: AuthorResponse,
    evidence: dict[str, Any],
    sources: dict[str, dict[str, Any]],
) -> list[CheckFinding]:
    plan = response.lesson_plan
    findings: list[CheckFinding] = []
    if plan.status != PlanStatus.draft:
        findings.append(_error("invalid_status", "lesson plan status must be draft"))
    if plan.validated_by is not None:
        findings.append(_error("premature_validation", "lesson plan validated_by must be null"))
    asb_value = evidence.get("asb_task")
    asb_task = asb_value if isinstance(asb_value, dict) else None
    allowed_sources = set(sources) | ({asb_task["source_id"]} if asb_task else set())
    findings.extend(_collect_plan_graph_findings(plan, allowed_sources))
    findings.extend(_collect_corpus_findings(plan, sources, asb_task))
    findings.extend(_collect_asb_findings(plan, asb_task))
    findings.extend(_collect_embedded_findings(plan, sources))
    scene_ids = {scene.id for scene in plan.scene_outlines}
    findings.extend(_collect_link_findings(response.source_links, sources, scene_ids))
    findings.extend(_collect_viewer_findings(response.viewers, scene_ids, allowed_sources))
    return findings


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
    retrieval = evidence.get("retrieval")
    self_study = isinstance(retrieval, dict) and is_self_study_origin(str(retrieval.get("origin", "")))
    labels = REVIEW_TEXT[_locale(response.lesson_plan.language)]
    lines = [
        labels["self_heading"] if self_study else labels["teacher_heading"],
        "",
        labels["status"],
        "",
        labels["checked_heading"],
        "",
        f"- {labels['links'].format(count=len(response.source_links))}",
        f"- {labels['viewers'].format(count=len(response.viewers))}",
        f"- {labels['references']}",
        f"- {labels['no_approval']}",
        "",
        labels["source_heading"],
        "",
    ]
    for link in response.source_links:
        quote = link.quote.replace("\n", " ")
        lines.append(f"- `{link.scene_id}` → `{link.evidence_id}`: “{quote}”")
    lines.extend(["", labels["attention_heading"], ""])
    lines.append(
        f"- {labels['unlinked'].format(scenes=', '.join(unlinked) or labels['none'])}"
    )
    asb_task = evidence.get("asb_task")
    if asb_task:
        lines.append(f"- {labels['asb'].format(task_id=asb_task['task_id'])}")
    lines.extend(
        [
            f"- {labels['quote_limit']}",
            f"- {labels['viewer_limit']}",
            f"- {labels['self_limit'] if self_study else labels['teacher_limit']}",
            "",
        ]
    )
    return "\n".join(lines)


def _validated_response(value: Any) -> AuthorResponse:
    if not isinstance(value, dict) or not isinstance(value.get("lesson_plan"), dict):
        raise AuthoringFindingsError(
            [_error("invalid_response", "response must contain a lesson_plan object")]
        )
    try:
        _reject_execution_claims(value["lesson_plan"])
        return AuthorResponse.model_validate(value)
    except PacketError as exc:
        raise AuthoringFindingsError([_error("unverified_execution", str(exc))]) from exc
    except ValidationError as exc:
        findings = [
            _error(
                "invalid_response",
                "response does not match response.schema.json at "
                f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}",
            )
            for error in exc.errors()
        ]
        raise AuthoringFindingsError(findings) from exc


def _check_response_report(
    *, packet_dir: Path, response_path: Path, output_dir: Path, force: bool = False
) -> CheckReport:
    """Validate a response once, collecting all independent authoring findings."""
    output_dir = output_dir.absolute()
    _require_output_permission(output_dir, force, "output directory")
    evidence, evidence_raw = _load_json(packet_dir / "evidence.json", "packet evidence")
    try:
        response_value, _ = _load_json(response_path, "author response")
    except PacketError as exc:
        raise AuthoringFindingsError([_error("invalid_response", str(exc))]) from exc
    sources = _validate_packet(evidence)
    response = _validated_response(response_value)
    findings = _collect_check_findings(response, evidence, sources)
    errors = [finding for finding in findings if finding.level == "ERROR"]
    if errors:
        raise AuthoringFindingsError(findings)
    plan = response.lesson_plan
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
    return CheckReport(output_dir, findings)


def check_response(
    *, packet_dir: Path, response_path: Path, output_dir: Path, force: bool = False
) -> Path:
    """Validate an external author response and emit teacher-review artifacts."""
    return _check_response_report(
        packet_dir=packet_dir,
        response_path=response_path,
        output_dir=output_dir,
        force=force,
    ).output_path


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


def _runtime_scene_type(scene: SceneOutline) -> str:
    """Return the LessonBundle scene type a plan scene is built as."""
    if scene.type.value == LEGACY_SIMULATION_TYPE:
        return LEGACY_SIMULATION_RUNTIME_TYPE
    return scene.type.value


def _key_class_part(name: str, scene_ids: list[str]) -> str:
    return f"{name}={len(scene_ids)} ({', '.join(scene_ids) or 'none'})"


def key_classes_line(scenes: list[tuple[str, str]]) -> str:
    """Summarise ``(scene_id, scene_type)`` pairs by who wrote the key each scene is graded against.

    Ids are listed for every class but ``ungraded``. A type missing from ``SCENE_KEY_CLASS``
    is counted in a trailing ``unknown`` bucket instead of failing.
    """
    grouped: dict[str, list[str]] = {}
    for scene_id, scene_type in scenes:
        grouped.setdefault(SCENE_KEY_CLASS.get(scene_type, UNKNOWN_KEY_CLASS), []).append(scene_id)
    parts = [_key_class_part(name, grouped.get(name, [])) for name in LISTED_KEY_CLASSES]
    parts.append(f"{UNGRADED_KEY_CLASS}={len(grouped.get(UNGRADED_KEY_CLASS, []))}")
    if UNKNOWN_KEY_CLASS in grouped:
        parts.append(_key_class_part(UNKNOWN_KEY_CLASS, grouped[UNKNOWN_KEY_CLASS]))
    return "Key classes: " + " ".join(parts)


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
        key_classes_line([(scene.id, _runtime_scene_type(scene)) for scene in plan.scene_outlines]),
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
    return texts or [_authoring_text(context.plan.language, "objective")]


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
            "cues": [_authoring_text(context.plan.language, "cue")],
        }
        for index, text in enumerate(texts, start=1)
    ]


def _placeholder_claims(
    scene: SceneOutline, context: _BundleContext, maximum: int
) -> list[dict[str, Any]]:
    return [
        {
            "id": f"todo-claim-{index}",
            "text": _authoring_text(context.plan.language, "claim", text=text),
            "flaws_expected": [_authoring_text(context.plan.language, "flaw")],
        }
        for index, text in enumerate(_objective_texts(scene, context)[:maximum], start=1)
    ]


def _source_context(scene_id: str, context: _BundleContext) -> str:
    links = context.links_by_scene.get(scene_id, [])
    if not links:
        return _authoring_text(context.plan.language, "source")
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
        f"{_authoring_text(context.plan.language, 'scene_content', title=scene.title)}\n\n"
        f"{_authoring_text(context.plan.language, 'source_heading')}\n"
        f"{_source_context(scene.id, context)}"
    )
    return {**base, "markdown": markdown}


def _build_quiz_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    language = context.plan.language
    return {
        **base,
        "question": scene.notes or _authoring_text(language, "quiz_question", title=scene.title),
        "choices": [
            {"id": "todo-correct", "text": _authoring_text(language, "correct_answer"), "correct": True},
            {"id": "todo-distractor", "text": _authoring_text(language, "distractor"), "correct": False},
        ],
        "feedback_correct": _authoring_text(language, "correct_feedback"),
        "feedback_incorrect": _authoring_text(language, "incorrect_feedback"),
        "hints": [],
    }


def _build_checkpoint_scene(
    base: dict[str, Any], _scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    language = context.plan.language
    return {
        **base,
        "pre_question": _authoring_text(language, "pre_question"),
        "post_question": _authoring_text(language, "post_question"),
        "scale_labels": [
            _authoring_text(language, "scale_level", level=level) for level in range(1, 6)
        ],
    }


def _build_reproduction_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    language = context.plan.language
    return {
        **base,
        "task_card_id": scene.abs_task_card_id or f"TODO:{scene.id}:task-card",
        "steps": [
            {
                "step_id": "todo-step-1",
                "instruction": _authoring_text(language, "reproduction_step"),
                "expected_input_schema": {"type": "object"},
                "expected_output": _authoring_text(language, "expected_output"),
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
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    language = context.plan.language
    return {
        **base,
        "topic": _authoring_text(language, "discussion_topic", title=scene.title),
        "seed_claim": _authoring_text(language, "seed_claim"),
        "target_signals": ["justification"],
        "max_turns": 4,
    }


def _build_spot_the_flaw_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "flawed_content": _authoring_text(context.plan.language, "flawed_content"),
        "claims": _placeholder_claims(scene, context, 5),
        # The reveal must NAME every expected flaw (tools/bundle_lint.mjs flaw_reveal_gap): a
        # skeleton that does not already satisfies that rule would fail the lint before the
        # teacher wrote a word, so the placeholder repeats the placeholder flaw.
        "model_correction": _authoring_text(context.plan.language, "model_correction"),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_explain_back_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "prompt": _authoring_text(context.plan.language, "explain_prompt", title=scene.title),
        "key_points": _placeholder_key_points(scene, context, 6),
        "model_explanation": _authoring_text(context.plan.language, "model_explanation"),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_comparison_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "prompt": _authoring_text(context.plan.language, "comparison_prompt"),
        "artifact_a": _authoring_text(context.plan.language, "artifact_a"),
        "artifact_b": _authoring_text(context.plan.language, "artifact_b"),
        "key_points": _placeholder_key_points(scene, context),
        "model_answer": _authoring_text(context.plan.language, "model_answer"),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_summary_audit_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "source_content": _source_context(scene.id, context),
        "ai_summary": _authoring_text(context.plan.language, "ai_summary"),
        "claims": _placeholder_claims(scene, context, 5),
        "model_correction": _authoring_text(context.plan.language, "corrected_summary"),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_prompt_practice_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "task": _authoring_text(context.plan.language, "prompt_task", title=scene.title),
        "starter_prompt": _authoring_text(context.plan.language, "starter_prompt"),
        "key_points": _placeholder_key_points(scene, context),
        "model_prompt": _authoring_text(context.plan.language, "model_prompt"),
        "rubric": dict(PLACEHOLDER_RUBRIC),
    }


def _build_communication_scene(
    base: dict[str, Any], scene: SceneOutline, context: _BundleContext
) -> dict[str, Any]:
    return {
        **base,
        "scenario": _authoring_text(
            context.plan.language, "communication_scenario", title=scene.title
        ),
        "prompt": _authoring_text(context.plan.language, "communication_prompt"),
        "key_points": _placeholder_key_points(scene, context),
        "model_response": _authoring_text(context.plan.language, "model_response"),
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
        base = _base_scene(scene, context, runtime_type=LEGACY_SIMULATION_RUNTIME_TYPE)
        return {
            **base,
            "markdown": (
                f"{_authoring_text(context.plan.language, 'legacy_simulation')}\n\n"
                f"{_authoring_text(context.plan.language, 'source_heading')}\n"
                f"{_source_context(scene.id, context)}"
            ),
        }
    base = _base_scene(scene, context)
    return _SCENE_BUILDERS[scene.type.value](base, scene, context)


def _bundle_id(plan_id: str) -> str:
    candidate = plan_id.removesuffix("-draft")
    return candidate or plan_id


def self_study_authoring(note: str | None = None) -> dict[str, Any]:
    """Return the ``metadata.authoring`` block of a lesson a learner wrote for themself."""
    authoring: dict[str, Any] = {"mode": SELF_STUDY_MODE, "author_is_learner": True}
    if note and note.strip():
        authoring["note"] = note.strip()
    return authoring


@dataclass(frozen=True)
class _BundleOptions:
    validated_by: str | None
    include_default_rules: bool
    authoring: dict[str, Any] | None

    def recorded_validator(self) -> str:
        """The caller's ``validated_by``, else the not-validated marker of this authoring mode."""
        is_self_study = bool(self.authoring) and self.authoring.get("mode") == SELF_STUDY_MODE
        default = SELF_STUDY_VALIDATED_BY if is_self_study else DEFAULT_VALIDATED_BY
        return (self.validated_by or default).strip() or default


def _is_draft_marker(validated_by: str) -> bool:
    return validated_by in {DEFAULT_VALIDATED_BY, SELF_STUDY_VALIDATED_BY}


def _bundle_metadata(plan: LessonPlan, authoring: dict[str, Any] | None) -> dict[str, Any]:
    subject = plan.metadata.subject if plan.metadata else None
    metadata: dict[str, Any] = {
        "title": plan.title,
        "target": plan.target,
        "duration_minutes": plan.duration_minutes,
        "language": plan.language,
        "discipline": subject or plan.dct_subject or _authoring_text(plan.language, "discipline"),
    }
    # Absent, not null, on teacher bundles: readers treat a missing block as "teacher".
    if authoring is not None:
        metadata["authoring"] = deepcopy(authoring)
    return metadata


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


def _default_replay_rule(language: str) -> dict[str, Any]:
    """Return the default replay rule with its learner-facing explanation localized."""
    rule = deepcopy(DEFAULT_REPLAY_RULE)
    if _locale(language) == "en":
        rule["explanation_short"] = ENGLISH_REPLAY_EXPLANATION
    return rule


def _bundle_payload(
    plan: LessonPlan, links: list[SourceLink], options: _BundleOptions
) -> dict[str, Any]:
    concepts = _bundle_concepts(plan)
    context = _bundle_context(plan, links)
    payload: dict[str, Any] = {
        "schema_version": "1.4",
        "bundle_id": _bundle_id(plan.id),
        "source_plan_id": plan.id,
        "metadata": _bundle_metadata(plan, options.authoring),
        "concepts": concepts,
        "scenes": [_build_bundle_scene(scene, context) for scene in plan.scene_outlines],
        "rules": [_default_replay_rule(plan.language)] if options.include_default_rules else [],
        "validated_by": options.recorded_validator(),
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


def _write_json_file(path: Path, value: Any, label: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_json_bytes(value))
    except OSError as exc:
        raise PacketError(f"cannot write {label}: {exc}") from exc


def build_lesson_bundle(
    *,
    course_dir: Path,
    output_path: Path,
    validated_by: str | None = None,
    force: bool = False,
    include_default_rules: bool = True,
    authoring: dict[str, Any] | None = None,
) -> Path:
    """Build a schema-valid LessonBundle 1.4 skeleton from a checked course.

    ``authoring`` (see ``self_study_authoring``) becomes ``metadata.authoring``; when it says
    ``self_study`` and no ``validated_by`` is given, the bundle records
    ``SELF_STUDY_VALIDATED_BY``. Without it the bundle carries no authoring block at all. A
    non-draft validator is refused until the skeleton is filled; teacher approval is recorded
    later with ``approve`` so regenerating the skeleton cannot erase authored content.
    """
    output_path = output_path.absolute()
    _require_output_permission(output_path, force, "output file")
    plan, _, _, links = _load_checked_course(course_dir)
    options = _BundleOptions(validated_by, include_default_rules, authoring)
    bundle = _validated_bundle_payload(_bundle_payload(plan, links, options))
    remaining = placeholder_paths(bundle)
    if remaining and not _is_draft_marker(options.recorded_validator()):
        raise PacketError(
            f"{len(remaining)} remaining placeholder(s); use approve after filling the lesson"
        )
    _remove_output(output_path, "output file")
    _write_json_file(output_path, bundle, "LessonBundle")
    return output_path


def capture_passages(capture: PassageCapture, output_path: Path, force: bool = False) -> Path:
    """Write the passage envelope of a learner-chosen reference for ``prepare --passages``.

    ``output_path`` must not exist unless ``force``; nothing is written when the reference
    cannot be read or yields no passage.
    """
    output_path = output_path.absolute()
    _require_output_permission(output_path, force, "output file")
    try:
        envelope = build_passage_envelope(capture)
    except PassageCaptureError as exc:
        raise PacketError(str(exc)) from exc
    _remove_output(output_path, "output file")
    _write_json_file(output_path, envelope, "passages")
    return output_path


def _parse_checklist(items: list[str]) -> dict[str, str]:
    """Parse repeatable ``key=value`` checklist entries without guessing value types."""
    checklist: dict[str, str] = {}
    for item in items:
        key, separator, value = item.partition("=")
        key = key.strip()
        if not separator or not key:
            raise PacketError(f"invalid checklist entry {item!r}; expected key=value")
        if key in checklist:
            raise PacketError(f"duplicate checklist key {key!r}")
        checklist[key] = value.strip()
    return checklist


def _bundle_lint_summary(bundle_path: Path) -> dict[str, int]:
    """Run the canonical Node linter and return its ERROR/WARN counts."""
    command = ["node", str(ROOT / "tools" / "bundle_lint.mjs"), str(bundle_path)]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise PacketError(f"cannot run bundle lint: {exc}") from exc
    lines = (result.stdout + "\n" + result.stderr).splitlines()
    summary = {
        "errors": sum(line.startswith("ERROR  ") for line in lines),
        "warnings": sum(line.startswith("WARN  ") for line in lines),
    }
    if result.returncode not in (0, 1) or (result.returncode and not summary["errors"]):
        detail = next((line.strip() for line in lines if line.strip()), "no diagnostic output")
        raise PacketError(f"bundle lint could not complete: {detail}")
    return summary


def approve_lesson_bundle(
    *,
    bundle_path: Path,
    validated_by: str,
    checklist: dict[str, str] | None = None,
    opened: list[str] | None = None,
    note: str | None = None,
) -> Path:
    """Record teacher approval for a finished bundle without rebuilding its content, and the review
    receipt (which scenes were opened) in ``reviews/`` next to it."""
    bundle_path = bundle_path.resolve()
    reviewer = validated_by.strip()
    if not reviewer:
        raise PacketError("--validated-by must not be empty")
    bundle, _ = _load_json(bundle_path, "LessonBundle")
    if not isinstance(bundle, dict):
        raise PacketError("LessonBundle root must be an object")
    metadata = bundle.get("metadata")
    authoring = metadata.get("authoring") if isinstance(metadata, dict) else None
    if isinstance(authoring, dict) and authoring.get("mode") == SELF_STUDY_MODE:
        raise PacketError(
            "self-study bundles cannot receive teacher approval; to approve this lesson for a class, "
            "rebuild it through prepare, check and bundle (the teacher route), fill it, then approve"
        )
    remaining = placeholder_paths(bundle)
    if remaining:
        raise PacketError(
            f"cannot approve: {len(remaining)} placeholder(s) remain ({remaining[0]})"
        )
    lint = _bundle_lint_summary(bundle_path)
    if lint["errors"]:
        raise PacketError(f"cannot approve: bundle lint reported {lint['errors']} ERROR finding(s)")
    reviewed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    bundle["validated_by"] = reviewer
    bundle["validated_at"] = reviewed_at
    final_bytes = _json_bytes(bundle)
    # Built before any write so an unknown --opened id or an existing receipt mutates nothing.
    receipt = _review_receipt(
        bundle=bundle, bundle_bytes=final_bytes, bundle_path=bundle_path, reviewer=reviewer,
        decided_at=reviewed_at, decision="approved", opened=opened or [], note=note,
    )
    receipt_path = _receipt_path(bundle_path, reviewed_at, receipt["bundle_sha256"])
    _refuse_existing_receipt(receipt_path)
    approval = {
        "schema": APPROVAL_SCHEMA,
        "bundle_sha256": _sha256(final_bytes),
        "reviewer": reviewer,
        "reviewed_at": reviewed_at,
        "checklist": checklist or {},
        "lint": lint,
        "tool": f"experience_packet.py approve {TOOL_VERSION}",
    }
    try:
        bundle_path.write_bytes(final_bytes)
    except OSError as exc:
        raise PacketError(f"cannot write approved LessonBundle: {exc}") from exc
    approval_path = bundle_path.parent / "approval.json"
    _write_json_file(approval_path, approval, "approval record")
    try:
        _write_receipt(receipt_path, receipt)
    except OSError as exc:
        raise PacketError(
            f"approval.json was written but the review receipt was not ({receipt_path}): {exc}"
        ) from exc
    return approval_path


def _voice_preview(name: str) -> list[str]:
    """The lesson's voice as learners read it on every screen (the host's voice line), so the teacher
    sees what --validated-by turns into; an e-mail address is noted, never refused."""
    lines = [f'learners read on every screen: « Leçon validée par {name} » / "validated by {name}"']
    if "@" in name:
        lines.append(
            'note: this is an e-mail address; learners will see it — prefer a name (--validated-by "Prénom Nom")'
        )
    return lines


def _approval_summary(approval_path: Path) -> list[str]:
    """What a teacher reads after ``approve``: who, which exact file, the lint counts, and the one
    rule that keeps the record honest (RT-7)."""
    approval, _ = _load_json(approval_path, "approval record")
    lint = approval.get("lint") or {}
    return [
        f"Approved by {approval['reviewer']} at {approval['reviewed_at']}",
        *_voice_preview(approval["reviewer"]),
        f"lesson.json SHA-256: {approval['bundle_sha256']}",
        f"lint: {lint.get('errors', 0)} error(s), {lint.get('warnings', 0)} warning(s)",
        "validated_by and validated_at were rewritten and the file normalized; "
        "any edit to lesson.json makes this approval stale (approve again after editing).",
        *_receipt_summary(_receipt_path(approval_path.parent / "lesson.json", approval["reviewed_at"], approval["bundle_sha256"])),
        "Approval record:",
    ]


def _add_prepare_parser(commands: Any) -> None:
    prepare = commands.add_parser("prepare", help="prepare an offline authoring packet")
    prepare.add_argument("--passages", type=Path, required=True)
    prepare.add_argument("--out", type=Path, required=True)
    prepare.add_argument("--title", required=True)
    prepare.add_argument("--target")
    prepare.add_argument("--capsule", type=Path)
    prepare.add_argument("--task-id")
    prepare.add_argument(
        "--self-study",
        action="store_true",
        help="write the self-study author brief (automatic for passages from the passages command)",
    )


def _add_check_parser(commands: Any) -> None:
    check = commands.add_parser("check", help="check an external author response")
    check.add_argument("--packet", type=Path, required=True)
    check.add_argument("--response", type=Path, required=True)
    check.add_argument("--out", type=Path, required=True)
    check.add_argument("--force", action="store_true", help="replace an existing output")
    output = check.add_mutually_exclusive_group()
    output.add_argument("--quiet", action="store_true", help="print only the output path")
    output.add_argument("--json", action="store_true", help="emit one machine-readable report")


def _add_bundle_parser(commands: Any) -> None:
    bundle = commands.add_parser(
        "bundle",
        help="build a playable LessonBundle skeleton",
        description=(
            "Build a draft LessonBundle skeleton and report its remaining placeholders."
        ),
        epilog=(
            "Flow: build the draft, fill the placeholders, run check/lint, then record teacher "
            "review with `approve --bundle lesson.json --validated-by NAME`."
        ),
    )
    bundle.add_argument("--course", type=Path, required=True)
    bundle.add_argument("--out", type=Path, required=True)
    bundle.add_argument("--validated-by")
    bundle.add_argument("--force", action="store_true", help="replace an existing output")
    bundle.add_argument(
        "--no-default-rules",
        action="store_true",
        help="omit the default two-error replay rule",
    )
    bundle.add_argument(
        "--self-study",
        action="store_true",
        help=(
            "the learner wrote this lesson for themself: record metadata.authoring and, "
            f"without --validated-by, validated_by={SELF_STUDY_VALIDATED_BY!r}"
        ),
    )
    bundle.add_argument(
        "--note", metavar="TEXT", help="free note kept in metadata.authoring (needs --self-study)"
    )


def _add_approve_parser(commands: Any) -> None:
    approve = commands.add_parser(
        "approve",
        help="record teacher approval for an already-filled LessonBundle",
        description=(
            "Approve a filled teacher bundle: refuse remaining TODO placeholders or bundle-lint "
            "errors, then write approval.json next to it, bound to the SHA-256 of the exact "
            "lesson.json bytes. The lesson's content is kept, but the file is rewritten: "
            "validated_by and validated_at are rewritten (your name, the time of approval) and "
            "the JSON is normalized (keys sorted, standard indentation), so its SHA-256 changes "
            "once. Any later edit to lesson.json makes the approval stale. Self-study bundles "
            "cannot be approved: rebuild them through prepare, check and bundle (the teacher route)."
        ),
    )
    approve.add_argument("--bundle", type=Path, required=True, metavar="LESSON_JSON")
    approve.add_argument("--validated-by", required=True, metavar="NAME")
    approve.add_argument(
        "--checklist",
        nargs="*",
        default=[],
        metavar="KEY=VALUE",
        help=(
            "optional review checklist entries recorded in approval.json, for example "
            "sources=read keys=checked scientific_accuracy=yes licence=checked level=fits"
        ),
    )
    _add_receipt_arguments(approve)


def _add_receipt_arguments(command: Any) -> None:
    command.add_argument(
        "--opened",
        action="append",
        metavar="ID[,ID...]",
        help=(
            "scene ids you opened and read (repeat or separate with commas); the review receipt in "
            "reviews/ marks them opened, the others not opened. An id that is not a scene is refused."
        ),
    )
    command.add_argument("--note", metavar="TEXT", help="free note kept in the review receipt")


def _add_receipt_parser(commands: Any) -> None:
    receipt = commands.add_parser(
        "receipt",
        help="record a review receipt for a lesson you send back",
        description=(
            "For a teacher who sends a lesson back to its author: write a review receipt "
            "(reviews/<date>-<sha>.json next to lesson.json, decision returned) bound to the "
            "current bytes, without approval.json and without rewriting the lesson. The teacher "
            "dashboard composes this command. To approve, use approve, which writes its own receipt."
        ),
    )
    receipt.add_argument("--bundle", type=Path, required=True, metavar="LESSON_JSON")
    receipt.add_argument("--reviewer", required=True, metavar="NAME")
    receipt.add_argument("--decision", required=True, choices=("returned", "approved"))
    _add_receipt_arguments(receipt)


def _add_passages_parser(commands: Any) -> None:
    passages = commands.add_parser(
        "passages", help="capture a learner-chosen URL, HTML page, PDF or text file as passages"
    )
    source = passages.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="an http(s) page or PDF, fetched once")
    source.add_argument("--html", type=Path, metavar="FILE", help="a saved HTML page (UTF-8)")
    source.add_argument("--pdf", type=Path, metavar="FILE", help="a PDF with a text layer")
    source.add_argument("--text", type=Path, metavar="FILE", help="a UTF-8 text file")
    passages.add_argument("--out", type=Path, required=True, metavar="FILE", help="passages.json to write")
    passages.add_argument(
        "--title", required=True, metavar="T", help="title of the reference, kept on every passage"
    )
    passages.add_argument(
        "--license",
        dest="license_id",
        default=DEFAULT_LICENSE_ID,
        metavar="ID",
        help=f"licence identifier (default: {DEFAULT_LICENSE_ID}, which check reports as a WARN)",
    )
    passages.add_argument(
        "--min-chars",
        type=int,
        default=DEFAULT_MIN_CHARS,
        metavar="N",
        help=(
            "join a paragraph shorter than N characters to a neighbouring passage, or drop it "
            f"and count it in dropped_short (default {DEFAULT_MIN_CHARS})"
        ),
    )
    passages.add_argument(
        "--max-chars",
        type=int,
        default=DEFAULT_MAX_CHARS,
        metavar="N",
        help=f"cut passages longer than N characters (default {DEFAULT_MAX_CHARS})",
    )
    passages.add_argument("--force", action="store_true", help="replace an existing output")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for add_command in (
        _add_passages_parser,
        _add_prepare_parser,
        _add_check_parser,
        _add_bundle_parser,
        _add_approve_parser,
        _add_receipt_parser,
    ):
        add_command(commands)
    return parser


def _run_prepare(args: argparse.Namespace) -> Path:
    return prepare_packet(
        passages_path=args.passages,
        output_dir=args.out,
        title=args.title,
        target=args.target,
        capsule_path=args.capsule,
        task_id=args.task_id,
        self_study=args.self_study,
    )


def _run_check(args: argparse.Namespace) -> CheckReport:
    return _check_response_report(
        packet_dir=args.packet,
        response_path=args.response,
        output_dir=args.out,
        force=args.force,
    )


def _run_bundle(args: argparse.Namespace) -> Path:
    if args.note is not None and not args.self_study:
        raise PacketError("--note requires --self-study")
    return build_lesson_bundle(
        course_dir=args.course,
        output_path=args.out,
        validated_by=args.validated_by,
        force=args.force,
        include_default_rules=not args.no_default_rules,
        authoring=self_study_authoring(args.note) if args.self_study else None,
    )


def _run_passages(args: argparse.Namespace) -> Path:
    # The parser makes --url/--html/--pdf/--text mutually exclusive and required.
    kind = next(kind for kind in REFERENCE_KINDS if getattr(args, kind) is not None)
    capture = PassageCapture(
        kind=kind,
        location=str(getattr(args, kind)),
        title=args.title,
        license_id=args.license_id,
        min_chars=args.min_chars,
        max_chars=args.max_chars,
    )
    return capture_passages(capture, args.out, force=args.force)


def _run_approve(args: argparse.Namespace) -> Path:
    return approve_lesson_bundle(
        bundle_path=args.bundle,
        validated_by=args.validated_by,
        checklist=_parse_checklist(args.checklist),
        opened=_parse_opened(args.opened),
        note=args.note,
    )


def _run_receipt(args: argparse.Namespace) -> Path:
    return record_review_receipt(
        bundle_path=args.bundle,
        reviewer=args.reviewer,
        decision=args.decision,
        opened=_parse_opened(args.opened),
        note=args.note,
    )


_COMMANDS = {
    "passages": _run_passages,
    "prepare": _run_prepare,
    "check": _run_check,
    "bundle": _run_bundle,
    "approve": _run_approve,
    "receipt": _run_receipt,
}


def _format_check_finding(finding: CheckFinding) -> str:
    location: list[str] = []
    if finding.scene_id is not None:
        location.append(f"scene {finding.scene_id!r}")
    if finding.link_index is not None:
        location.append(f"link {finding.link_index}")
    prefix = f"{finding.level} [{finding.code}]"
    if location:
        prefix += " " + ", ".join(location)
    parts = [f"{prefix}: {finding.message}"]
    if finding.quote is not None:
        parts.append(f"quote {json.dumps(finding.quote, ensure_ascii=False)}")
    if finding.hint is not None:
        parts.append(finding.hint)
    return "; ".join(parts)


def _print_check_json(
    *, ok: bool, findings: list[CheckFinding], output: Path | None, summary: list[str] | None = None
) -> None:
    report: dict[str, Any] = {
        "ok": ok,
        "findings": [finding.as_dict() for finding in findings],
        "output": str(output.resolve()) if output else None,
    }
    if summary is not None:
        report["summary"] = summary
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    """Run a packet command and return its process status."""
    args = _parser().parse_args(argv)
    try:
        output = _COMMANDS[args.command](args)
    except AuthoringFindingsError as exc:
        if args.command == "check" and args.json:
            _print_check_json(ok=False, findings=exc.findings, output=None)
        else:
            for finding in exc.findings:
                print(_format_check_finding(finding))
        return 1
    except SourceQuoteError as exc:
        print(f"ERROR: {exc}")
        return 1
    except PacketError as exc:
        if args.command == "check" and args.json:
            finding = _error("packet_error", str(exc))
            _print_check_json(ok=False, findings=[finding], output=None)
            return 2
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.command == "check":
        summary = check_summary_lines(output.output_path)
        if args.json:
            _print_check_json(
                ok=True,
                findings=output.findings,
                output=output.output_path,
                summary=summary,
            )
        elif args.quiet:
            print(output.output_path)
        else:
            for finding in output.findings:
                print(_format_check_finding(finding))
            print("\n".join(summary))
        return 0
    if args.command == "bundle":
        bundle, _ = _load_json(output, "generated LessonBundle")
        print(f"Remaining placeholders: {len(placeholder_paths(bundle))}")
    if args.command == "approve":
        print("\n".join(_approval_summary(output)))
    if args.command == "receipt":
        receipt, _ = _load_json(output, "review receipt")
        print(f"Returned by {receipt['reviewer']} at {receipt['decided_at']}")
        print(f"lesson.json SHA-256: {receipt['bundle_sha256']}")
        print("\n".join(_receipt_summary(output)[1:]))
        print("Review receipt:")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
