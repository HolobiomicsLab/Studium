#!/usr/bin/env python3
"""Export and verify an interactive concept-map report for one lesson session.

Input: the record the MCP tool ``export_concept_map`` writes (``studium/concept-map-record/v1``):
the learner's concept map, each step of the session with who assessed the answer and how the
session routed after it, and what every scene rests on. Output, in a new directory: the record
(exact copy), an ASTRA document that declares it and the choices behind it, an ARA trace of the
session path, the MySTRA page, and ``index.html``, a self-contained page where a concept can be
opened to see its provenance, the learner's steps and, with ``--class-report``, the class figures.

Local only. The map states session facts; it certifies no learning and checks no source. ASTRA
describes the exported artifacts; the learner's results stay in the declared record, never in
custom ASTRA fields.

Usage:
    python tools/concept_map_report.py export RECORD.json NEW_DIR [--class-report CLASS.json]
    python tools/concept_map_report.py verify NEW_DIR
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from learner_report import (
    HASH_PATTERN,
    PLANNER,
    ReportError,
    StrictModel,
    _checked_path,
    _now,
    _sha256,
    _shared_theme,
    _validate_ara,
    _version,
    _write_json,
)
from learner_trace import read_json_payload

if str(PLANNER) not in sys.path:
    sys.path.insert(0, str(PLANNER))

from agentic.decision import make_decision, make_insight  # noqa: E402
from provenance.astra_contract import ASTRA_SCHEMA_VERSION  # noqa: E402
from provenance.astra_emit import emit_astra, write_astra_yaml  # noqa: E402
from provenance.astra_validate import run_astra_validate  # noqa: E402
from provenance.exploration_trace import build_exploration_tree, write_exploration_trace  # noqa: E402
from astra_render import render as render_mystra  # noqa: E402

RECORD_SCHEMA = "studium/concept-map-record/v1"
REPORT_SCHEMA = "studium/concept-map-report/v1"
CHECKS_SCHEMA = "studium/concept-map-report-checks/v1"
RECORD_PATH = "sources/concept-map-record.json"
CLASS_PATH = "sources/class-report.json"
ANALYSIS_ID = "learner_concept_map"

State = Literal["acquired", "to_review", "current", "seen", "upcoming"]
STATES: tuple[str, ...] = ("acquired", "to_review", "current", "seen", "upcoming")
STATE_SIGNS = {"acquired": "✓", "to_review": "↻", "current": "●", "seen": "◐", "upcoming": "○"}
DETOURS = ("remediate", "remediate_alt", "replay")


# --- the record (closed: an unknown field is refused) ---------------------------------------------

class MapQuestion(StrictModel):
    step: int
    scene_id: str
    result: Literal["correct", "wrong", "recorded"]


class MapNode(StrictModel):
    id: str
    title: str
    state: State
    questions: list[MapQuestion]
    requires: list[str]


class MapEdge(StrictModel):
    source: str = Field(alias="from")
    to: str
    travelled: bool


class MapPosition(StrictModel):
    source: str | None = Field(alias="from")
    at: str | None
    next: str | None


class ConceptMap(StrictModel):
    schema_id: Literal["studium/concept-map/v1"] = Field(alias="schema")
    moment: Literal["start", "new_concept", "detour", "detour_return", "synthesis", "complete", "on_request"]
    show: Literal["map", "line"]
    step: int
    nodes: list[MapNode] = Field(min_length=2, max_length=200)
    edges: list[MapEdge]
    position: MapPosition
    position_line: str
    mermaid: str
    display_markdown: str


class RecordSource(StrictModel):
    title: str
    origin: Literal["conversation", "web", "doi", "document"]
    url: str | None = Field(default=None, pattern=r"^https?://")
    license: str | None = None
    quote: str | None = None


class RecordScene(StrictModel):
    scene_id: str
    title: str
    type: str
    concept_ids: list[str]
    key_class: Literal["ungraded", "author_keyed", "production", "externally_grounded"] | None
    served: bool
    passages_released: bool
    sources: list[RecordSource]


class Navigation(StrictModel):
    kind: Literal["advance", "replay", "remediate_alt", "remediate", "gate_passed", "gate_released",
                  "gate_unassessable", "skip_mastered", "skip_concept", "calibration", "complete"]
    rule_id: str | None
    returns_to: str | None = None


class RecordStep(StrictModel):
    step: int
    scene_id: str
    concept_id: str | None
    answered: bool
    correct: bool | None
    assessed_by: Literal["key", "judge", "none"] | None
    navigation: Navigation | None


class LessonRecord(StrictModel):
    bundle_id: str
    title: str
    language: str
    lesson_sha256: str | None = Field(pattern=HASH_PATTERN)


class Approval(StrictModel):
    recorded: bool
    matches: bool


class Authoring(StrictModel):
    mode: str
    drafted_by: Literal["agent", "learner", "teacher"]
    validated: bool
    judge: bool
    approval: Approval
    from_conversation: bool


class SessionRecord(StrictModel):
    completed: bool
    steps: int


class ConceptMapRecord(StrictModel):
    """The record export_concept_map writes. No learner identifier, none of the learner's words."""

    schema_id: Literal[RECORD_SCHEMA] = Field(alias="schema")
    generated_at: str
    lesson: LessonRecord
    authoring: Authoring
    session: SessionRecord
    map: ConceptMap
    scenes: list[RecordScene] = Field(max_length=2000)
    path: list[RecordStep] = Field(max_length=5000)

    @model_validator(mode="after")
    def consistent(self) -> "ConceptMapRecord":
        """Every reference inside the record resolves; steps are numbered in order."""
        nodes = [node.id for node in self.map.nodes]
        if len(set(nodes)) != len(nodes):
            raise ValueError("duplicate concept id in the map")
        known = set(nodes)
        if any(edge.source not in known or edge.to not in known for edge in self.map.edges):
            raise ValueError("an edge names a concept the map does not hold")
        scenes = [scene.scene_id for scene in self.scenes]
        if len(set(scenes)) != len(scenes):
            raise ValueError("duplicate scene id")
        if any(step.scene_id not in set(scenes) for step in self.path):
            raise ValueError("a step names a scene the record does not hold")
        if [step.step for step in self.path] != list(range(1, len(self.path) + 1)):
            raise ValueError("steps are not numbered 1..n in order")
        if self.session.steps != len(self.path):
            raise ValueError("session.steps does not match the path")
        return self


# --- the class report (teacher tool class_report): only the figures shown are kept -----------------

class Figures(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cohort_band: str
    n_attempts: int
    n_measured: int
    accuracy: float | None
    hint_reliance: float | None
    calibration_gap: float | None
    mean_time_s: float | None


class ClassConcept(Figures):
    concept: str
    title: str | None


class ClassScene(Figures):
    scene_id: str
    title: str | None
    type: str | None
    concept: str


class ClassReport(BaseModel):
    """class_report with status ok. Its figures are already withheld under the learner floor."""

    model_config = ConfigDict(extra="ignore")
    status: Literal["ok"]
    course_id: str
    bundle_id: str
    min_learners: int
    cohort_band: str
    completion_rate: float | None
    scenes: list[ClassScene]
    concepts: list[ClassConcept]
    withheld_below_floor: bool
    reteach_priority: list[str]


class SourceRecord(StrictModel):
    id: Literal["concept_map_record", "class_report"]
    path: str
    sha256: str = Field(pattern=HASH_PATTERN)
    origin: Literal["server_export_selected_for_this_report", "teacher_tool_aggregate_figures_only"]


class MapReport(StrictModel):
    """Machine-readable summary of the export, derived from its selected sources only."""

    schema_id: Literal[REPORT_SCHEMA] = Field(alias="schema")
    generated_at: str
    language: Literal["fr", "en"]
    lesson: LessonRecord
    authoring: Authoring
    session: SessionRecord
    sources: list[SourceRecord]
    lenses: list[Literal["learner", "teacher"]]
    class_aggregates: Literal["included_above_floor", "not_included"]
    state_rule: Literal["session_facts"]
    passage_rule: Literal["quoted_after_scene_left"]
    learning_certification: Literal["not_performed"]
    source_verification: Literal["not_performed"]
    states: dict[str, int]
    counts: dict[str, int]


class MapChecks(StrictModel):
    schema_id: Literal[CHECKS_SCHEMA] = Field(alias="schema")
    generated_at: str
    astra: dict[str, str]
    artifacts: dict[str, str]


# --- words -------------------------------------------------------------------------------------------

WORDS: dict[str, dict[str, Any]] = {
    "fr": {
        "page_title": "Carte des notions", "kicker": "Studium · export local",
        "summary": "La carte d'une séance : où en est chaque notion, par quelles questions tu es passé, et sur quoi repose ce qui t'a été enseigné.",
        "notice": "Les états viennent des faits de la séance : position, réponses évaluées, prérequis crédités. « Acquise » veut dire que la dernière réponse évaluée est juste ou que le prérequis a été crédité. Ce n'est pas une certification, et cette page ne vérifie pas les sources.",
        "drafted": {"agent": "Leçon rédigée par l'IA à partir des sources fournies", "learner": "Leçon rédigée par l'apprenant",
                    "teacher": "Leçon rédigée par un enseignant"},
        "validated": {True: "relue et validée par un enseignant", False: "non relue par un enseignant"},
        "judge": {True: "réponses écrites évaluées par un modèle juge", False: "réponses écrites non évaluées par un juge"},
        "conversation": "Des passages viennent d'une conversation avec un assistant IA : ce que l'assistant y affirme n'a pas été vérifié.",
        "lens": "Point de vue", "learner": "Apprenant", "teacher": "Enseignant", "filter": "Notions affichées",
        "states": {"acquired": "acquise", "to_review": "à revoir", "current": "en cours", "seen": "vue, pas encore évaluée",
                   "upcoming": "à venir"},
        "graph": "Graphe des notions et de leurs prérequis",
        "legend": "La flèche va du prérequis vers la notion qui en dépend.",
        "legend_path": "Trait plein : chemin parcouru ; pointillé : pas encore parcouru.",
        "open": "Ouvrir la notion", "path": "Parcours de la séance",
        "path_help": "Chaque étape servie, dans l'ordre. Une étape ouvre sa notion.",
        "path_empty": "Aucune étape servie pour l'instant.", "step": "Étape", "concept": "Notion",
        "requires": "Demande", "leads_to": "Mène à", "none": "aucune",
        "answers": "Tes passages sur cette notion", "no_answers": "Pas encore de passage sur cette notion.",
        "cols": ["Étape", "Scène", "Résultat", "Évalué par", "Ensuite"],
        "result": {"correct": "juste", "wrong": "faux", "recorded": "enregistrée, non évaluée", "read": "lue"},
        "assessed": {"key": "clé de l'auteur", "judge": "modèle juge", "none": "personne", None: "—"},
        "nav": {"advance": "suite de la leçon", "replay": "même question reposée", "remediate_alt": "question de remplacement",
                "remediate": "détour par un prérequis", "gate_passed": "prérequis de la scène suivante crédité",
                "gate_released": "porte relâchée (détours épuisés)", "gate_unassessable": "prérequis non évaluable",
                "skip_mastered": "scènes déjà maîtrisées sautées", "skip_concept": "notion sautée",
                "calibration": "point de calibration", "complete": "fin de la leçon", None: "—"},
        "rests": "Ce sur quoi elle repose",
        "key_class": {"ungraded": "non notée", "author_keyed": "clé écrite par l'auteur",
                      "production": "production, comparée à une référence", "externally_grounded": "ancrée par une exécution",
                      None: "sans classe de clé"},
        "origin": {"conversation": "conversation avec un assistant", "web": "page web", "doi": "publication (DOI)",
                   "document": "document fourni"},
        "withheld": "Passage affiché une fois la question quittée.", "no_sources": "Aucun passage cité pour cette notion.",
        "not_served": "pas encore servie", "served": "servie",
        "class": "Classe (agrégats)", "class_none": "Aucun rapport de classe n'est joint à cet export.",
        "class_absent": "Cette notion n'a pas de ligne dans le rapport de classe.",
        "class_cols": ["Apprenants", "Réponses", "Réussite", "Recours aux indices", "Écart de calibration", "Temps moyen"],
        "class_floor": "Les chiffres retenus sous le plancher de {n} apprenants ne sont pas affichés. Aucun chiffre individuel.",
        "withheld_figure": "non affiché", "reteach": "à reprendre en priorité", "accuracy": "réussite",
        "scenes_n": "{n} scène(s)", "sources_n": "{n} source(s)", "answers_n": "{n} rép.",
        "trace": "Nœuds de la trace ARA", "provenance": "Provenance de cette page",
        "files": [
            ("astra.yaml", "ASTRA : ce que ce paquet contient, d'où il vient et les choix faits (règle d'état, passages cités)."),
            ("trace/exploration_tree.yaml", "Trace ARA : le parcours de la séance, étape par étape, détours compris."),
            ("course_provenance.myst.md", "MySTRA : la même provenance en page lisible."),
            (RECORD_PATH, "L'enregistrement exporté par le serveur, copié à l'identique."),
            ("report.json", "Le résumé de cet export et ses limites."),
            ("checks.json", "Les empreintes de chaque fichier et le résultat du validateur ASTRA."),
        ],
        "myst_source": "Source MySTRA", "skip": "Aller au contenu", "seconds": "s", "colon": "\u00a0: ", "list": "\u00a0; ",
    },
    "en": {
        "page_title": "Concept map", "kicker": "Studium · local export",
        "summary": "The map of one session: where each concept stands, which questions you went through, and what the teaching rests on.",
        "notice": "States come from session facts: position, assessed answers, credited prerequisites. “Acquired” means the latest assessed answer is right or the prerequisite was credited. It is not a certification, and this page checks no source.",
        "drafted": {"agent": "Lesson drafted by the AI from the sources supplied", "learner": "Lesson drafted by the learner",
                    "teacher": "Lesson drafted by a teacher"},
        "validated": {True: "reviewed and validated by a teacher", False: "not reviewed by a teacher"},
        "judge": {True: "written answers assessed by a judge model", False: "written answers not assessed by a judge"},
        "conversation": "Some passages are excerpts of a conversation with an AI assistant: what the assistant asserted there was not checked.",
        "lens": "Viewpoint", "learner": "Learner", "teacher": "Teacher", "filter": "Concepts shown",
        "states": {"acquired": "acquired", "to_review": "to review", "current": "current", "seen": "seen, not yet assessed",
                   "upcoming": "upcoming"},
        "graph": "Graph of the concepts and their prerequisites",
        "legend": "An arrow goes from a prerequisite to the concept that needs it.",
        "legend_path": "Solid: travelled; dashed: not yet travelled.",
        "open": "Open the concept", "path": "Session path",
        "path_help": "Each step served, in order. A step opens its concept.",
        "path_empty": "No step served yet.", "step": "Step", "concept": "Concept",
        "requires": "Requires", "leads_to": "Leads to", "none": "none",
        "answers": "Your steps on this concept", "no_answers": "No step on this concept yet.",
        "cols": ["Step", "Scene", "Result", "Assessed by", "Then"],
        "result": {"correct": "right", "wrong": "wrong", "recorded": "recorded, not assessed", "read": "read"},
        "assessed": {"key": "author's key", "judge": "judge model", "none": "nobody", None: "—"},
        "nav": {"advance": "lesson continues", "replay": "same question again", "remediate_alt": "replacement question",
                "remediate": "detour through a prerequisite", "gate_passed": "next scene's prerequisite credited",
                "gate_released": "gate released (detours used up)", "gate_unassessable": "prerequisite not assessable",
                "skip_mastered": "mastered scenes skipped", "skip_concept": "concept skipped",
                "calibration": "calibration checkpoint", "complete": "end of the lesson", None: "—"},
        "rests": "What it rests on",
        "key_class": {"ungraded": "not graded", "author_keyed": "key written by the author",
                      "production": "production, compared with a reference", "externally_grounded": "grounded by a run",
                      None: "no key class"},
        "origin": {"conversation": "conversation with an assistant", "web": "web page", "doi": "publication (DOI)",
                   "document": "supplied document"},
        "withheld": "Passage shown once the question is left.", "no_sources": "No passage cited for this concept.",
        "not_served": "not served yet", "served": "served",
        "class": "Class (aggregates)", "class_none": "No class report is attached to this export.",
        "class_absent": "This concept has no row in the class report.",
        "class_cols": ["Learners", "Answers", "Success", "Hint reliance", "Calibration gap", "Mean time"],
        "class_floor": "Figures held back under the floor of {n} learners are not shown. No individual figure.",
        "withheld_figure": "not shown", "reteach": "reteach first", "accuracy": "success",
        "scenes_n": "{n} scene(s)", "sources_n": "{n} source(s)", "answers_n": "{n} ans.",
        "trace": "ARA trace nodes", "provenance": "Provenance of this page",
        "files": [
            ("astra.yaml", "ASTRA: what this package holds, where it comes from and the choices made (state rule, passages quoted)."),
            ("trace/exploration_tree.yaml", "ARA trace: the session path, step by step, detours included."),
            ("course_provenance.myst.md", "MySTRA: the same provenance as a readable page."),
            (RECORD_PATH, "The record the server exported, copied unchanged."),
            ("report.json", "The summary of this export and its limits."),
            ("checks.json", "The digest of every file and the ASTRA validator's result."),
        ],
        "myst_source": "MySTRA source", "skip": "Skip to content", "seconds": "s", "colon": ": ", "list": "; ",
    },
}


def _french_spacing(value: Any) -> Any:
    """A no-break space before : ; ? ! and inside « », so a French sentence never wraps on its punctuation."""
    if isinstance(value, str):
        return re.sub(r"«\s", "«\u00a0", re.sub(r"(?<=\S) (?=[:;?!»])", "\u00a0", value))
    if isinstance(value, dict):
        return {key: _french_spacing(item) for key, item in value.items()}
    if isinstance(value, tuple):     # (path, text): the path stays as it is
        return (value[0], _french_spacing(value[1]))
    if isinstance(value, list):
        return [_french_spacing(item) for item in value]
    return value


WORDS["fr"] = _french_spacing(WORDS["fr"])


def _language(record: ConceptMapRecord, override: str | None) -> str:
    return "fr" if (override or record.lesson.language).lower().startswith("fr") else "en"


def _compact(value: str, limit: int = 500) -> str:
    """One line, bounded: lesson wording may appear in a title without shaping MyST or Mermaid."""
    text = " ".join(value.split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


# --- report summary, ASTRA and ARA -------------------------------------------------------------------

def _source_records(directory: Path, with_class: bool) -> list[dict[str, str]]:
    sources = [{"id": "concept_map_record", "path": RECORD_PATH, "sha256": _sha256(directory / RECORD_PATH),
                "origin": "server_export_selected_for_this_report"}]
    if with_class:
        sources.append({"id": "class_report", "path": CLASS_PATH, "sha256": _sha256(directory / CLASS_PATH),
                        "origin": "teacher_tool_aggregate_figures_only"})
    return sources


def _report_value(record: ConceptMapRecord, sources: list[dict[str, str]], language: str, generated_at: str) -> dict:
    with_class = any(source["id"] == "class_report" for source in sources)
    quoted = sum(1 for scene in record.scenes for source in scene.sources if source.quote)
    return {
        "schema": REPORT_SCHEMA, "generated_at": generated_at, "language": language,
        "lesson": record.lesson.model_dump(mode="json"), "authoring": record.authoring.model_dump(mode="json"),
        "session": record.session.model_dump(mode="json"), "sources": sources,
        "lenses": ["learner", "teacher"],
        "class_aggregates": "included_above_floor" if with_class else "not_included",
        "state_rule": "session_facts", "passage_rule": "quoted_after_scene_left",
        "learning_certification": "not_performed", "source_verification": "not_performed",
        "states": {state: sum(1 for node in record.map.nodes if node.state == state) for state in STATES},
        "counts": {
            "concepts": len(record.map.nodes), "scenes": len(record.scenes), "steps": len(record.path),
            "assessed_answers": sum(1 for step in record.path if step.correct is not None),
            "detours": sum(1 for step in record.path if step.navigation and step.navigation.kind in DETOURS),
            "scenes_with_sources": sum(1 for scene in record.scenes if scene.sources), "passages_quoted": quoted,
        },
    }


def _decisions(report: MapReport) -> list[dict]:
    return [
        make_decision(
            decision_id="concept_state_rule", label="Concept state shown on the map",
            rationale="A learner-facing map must say where the learner is. Posterior mastery stays under its threshold long after a prerequisite gate was passed.",
            options=[
                {"id": "session_facts", "label": "Session facts: position, assessed answers, credited prerequisites"},
                {"id": "posterior_mastery", "label": "Posterior mastery alone", "excluded": True,
                 "excluded_reason": "On a measured session it reported the first concept as current and every other as locked, the one being studied included."},
            ], default="session_facts"),
        make_decision(
            decision_id="passage_release", label="Cited passages quoted in the export",
            rationale="A cited passage can state the key of the question that cites it.",
            options=[
                {"id": "quoted_after_scene_left", "label": "Quoted once the learner has left the scene"},
                {"id": "all_passages", "label": "Every passage quoted", "excluded": True,
                 "excluded_reason": "It would show the key of questions not yet answered."},
            ], default="quoted_after_scene_left"),
        make_decision(
            decision_id="class_lens", label="Class figures on the teacher viewpoint",
            rationale="Class figures are aggregates; under the learner floor a figure is withheld, and no individual figure is produced.",
            options=[{"id": "not_included", "label": "No class report attached"},
                     {"id": "included_above_floor", "label": "Class report attached, figures above the floor only"}],
            default=report.class_aggregates),
    ]


def _findings(report: MapReport) -> list[dict]:
    counts, authoring = report.counts, report.authoring
    findings = [
        make_insight(
            insight_id="map_states_from_session_facts",
            claim=(f"The record holds {counts['concepts']} concepts and {counts['steps']} served step(s), "
                   f"{counts['assessed_answers']} of them answers a key or a judge assessed. Concept states follow the "
                   "session-facts rule; they state what happened in the session and certify no learning."),
            created_at=report.generated_at, evidence=[{"artifact": "concept_map_record"}], derived=True),
        make_insight(
            insight_id="lesson_authoring",
            claim=(f"The lesson was drafted by: {authoring.drafted_by}. Validated by a teacher: {'yes' if authoring.validated else 'no'}. "
                   f"Written answers assessed by a judge model: {'yes' if authoring.judge else 'no'}. "
                   f"{counts['scenes_with_sources']} scene(s) cite a source; {counts['passages_quoted']} passage(s) are quoted."),
            created_at=report.generated_at, evidence=[{"artifact": "concept_map_record"}], derived=True),
    ]
    if authoring.from_conversation:
        findings.append(make_insight(
            insight_id="conversation_sources_unverified",
            claim="At least one cited passage is an excerpt of a conversation with an AI assistant; what the assistant asserted there was not checked.",
            created_at=report.generated_at, evidence=[{"artifact": "concept_map_record"}], derived=True))
    if report.class_aggregates == "included_above_floor":
        findings.append(make_insight(
            insight_id="class_figures_are_aggregates",
            claim="The attached class figures are aggregates produced by class_report; figures under its learner floor are withheld and no individual figure is included.",
            created_at=report.generated_at, evidence=[{"artifact": "class_report"}], derived=True))
    return findings


def _report_astra(report: MapReport) -> dict:
    """An ASTRA envelope that declares the record and the artifacts rendered from it."""
    outputs = [{"id": source.id, "type": "data", "format": "json",
                "description": f"{source.path}: {source.origin.replace('_', ' ')}; SHA-256 {source.sha256}."}
               for source in report.sources]
    outputs += [
        {"id": "map_report", "type": "data", "format": "json", "description": "report.json: summary of the export and its limits."},
        {"id": "ara_trace", "type": "data", "format": "yaml", "description": "trace/exploration_tree.yaml: the session path, detours included."},
        {"id": "mystra_report", "type": "report", "format": "md", "description": "course_provenance.myst.md rendered by the shared MySTRA renderer, with the map."},
        {"id": "browser_map", "type": "report", "format": "html", "description": "index.html: the interactive concept map, self-contained."},
        {"id": "report_checks", "type": "data", "format": "json", "description": "checks.json: file digests and the ASTRA validator's result."},
    ]
    document = emit_astra(
        analysis_id=ANALYSIS_ID, name=f"Concept map — {_compact(report.lesson.title, 120)}",
        decisions=_decisions(report), prior_insights=[], findings=_findings(report), outputs=outputs,
        inputs=[{"id": f"{source.id}_input", "type": "data", "description": f"Selected source {source.path}."}
                for source in report.sources],
    )
    for root_output, output in zip(document["outputs"], outputs):
        root_output["id"] = f"{ANALYSIS_ID}_{output['id']}_result"
    document["description"] = ("Concept map of one lesson session with the provenance of what was taught. "
                               "It states session facts; it certifies no learning and checks no source.")
    return document


def _step_result(step: RecordStep) -> str:
    if not step.answered:
        outcome = "scene acknowledged"
    elif step.correct is None:
        outcome = "answer recorded, assessed by nobody"
    else:
        outcome = f"answer {'right' if step.correct else 'wrong'}, assessed by {step.assessed_by or 'unknown'}"
    routed = f"; then: {step.navigation.kind.replace('_', ' ')}" if step.navigation else ""
    return outcome + routed


def _report_trace(document: dict, record: ConceptMapRecord) -> tuple[dict, dict[int, list[str]]]:
    """The session path as an ARA branch: one experiment per step, one pivot per detour. Returns the
    tree and, per step, the ids of its nodes (the page links a concept to them)."""
    tree = build_exploration_tree(document)
    root = tree["nodes"][0]
    root["title"] = "How did this session move through the lesson's concepts, and what does each concept rest on?"
    used: list[int] = []

    def collect(nodes: list[dict]) -> None:
        for node in nodes:
            used.append(int(node["id"][1:]))
            collect(node.get("children") or [])

    collect(tree["nodes"])
    counter = max(used)

    def node_id() -> str:
        nonlocal counter
        counter += 1
        return f"N{counter:02d}"

    titles = {node.id: node.title for node in record.map.nodes}
    scene_types = {scene.scene_id: scene.type for scene in record.scenes}
    branch = {"id": node_id(), "type": "question", "title": "Session path: the steps served, in order",
              "support_level": "explicit", "source_refs": [f"{RECORD_PATH}#/path"], "children": []}
    step_nodes: dict[int, list[str]] = {}
    for index, step in enumerate(record.path):
        reference = f"{RECORD_PATH}#/path/{index}"
        concept = f"concept «{titles[step.concept_id]}» ({step.concept_id})" if step.concept_id in titles else "no concept"
        identifier = node_id()
        step_nodes[step.step] = [identifier]
        branch["children"].append({
            "id": identifier, "type": "experiment",
            "title": _compact(f"Step {step.step} · {concept} · scene {step.scene_id} ({scene_types[step.scene_id]})"),
            "support_level": "explicit", "source_refs": [reference],
            "result": _step_result(step) + ". A session fact, not a learning outcome.", "evidence": [reference],
        })
        if step.navigation and step.navigation.kind in DETOURS:
            following = record.path[index + 1].scene_id if index + 1 < len(record.path) else "the scene on screen when the record was exported"
            rule = step.navigation.rule_id or "no named rule"
            back = f"; returns to {step.navigation.returns_to}" if step.navigation.returns_to else ""
            identifier = node_id()
            step_nodes[step.step].append(identifier)
            branch["children"].append({
                "id": identifier, "type": "pivot",
                "title": _compact(f"After step {step.step}: {step.navigation.kind.replace('_', ' ')}"),
                "support_level": "explicit", "source_refs": [reference],
                "from": step.scene_id, "to": following, "trigger": f"{rule}{back}",
            })
    root["children"].append(branch)
    return tree, step_nodes


# --- MySTRA section ------------------------------------------------------------------------------------

def _cell(value: str) -> str:
    return _compact(value, 200).replace("|", "\\|")


def _map_myst(record: ConceptMapRecord, words: dict[str, Any]) -> str:
    """The map as a MyST section appended to the shared rendering: a Mermaid graph and one row per concept."""
    keys = {node.id: f"c{index}" for index, node in enumerate(record.map.nodes)}
    lines = ["", f"## {words['page_title']}", "", "```{mermaid}", "flowchart TD"]
    for node in record.map.nodes:
        label = _compact(f"{node.title} · {words['states'][node.state]}", 120).replace('"', "'")
        lines.append(f'  {keys[node.id]}["{label}"]')
    for edge in record.map.edges:
        lines.append(f"  {keys[edge.source]} {'-->' if edge.travelled else '-.->'} {keys[edge.to]}")
    lines += ["```", "", f"| {words['concept']} | {words['filter']} | {words['rests']} | {words['answers']} |", "|---|---|---|---|"]
    for node in record.map.nodes:
        scenes = [scene for scene in record.scenes if node.id in scene.concept_ids]
        titles = sorted({source.title for scene in scenes for source in scene.sources})
        answers = ", ".join(f"{q.step}: {words['result'][q.result]}" for q in node.questions) or "—"
        lines.append(f"| {_cell(node.title)} | {words['states'][node.state]} | {_cell('; '.join(titles)) or '—'} | {answers} |")
    return "\n".join(lines) + "\n"


# --- the page ----------------------------------------------------------------------------------------

NODE_W, NODE_H, GAP_X, GAP_Y, PAD, ROW_MAX = 214, 64, 26, 54, 40, 4
E = html.escape


def _layout(record: ConceptMapRecord) -> tuple[dict[str, tuple[float, float]], float, float]:
    """Layered positions: a concept sits below its prerequisites; a wide layer wraps at ROW_MAX."""
    ids = [node.id for node in record.map.nodes]
    prerequisites: dict[str, list[str]] = {identifier: [] for identifier in ids}
    for edge in record.map.edges:
        prerequisites[edge.to].append(edge.source)
    layer: dict[str, int] = {}

    def depth(identifier: str, stack: tuple[str, ...]) -> int:
        if identifier in layer:
            return layer[identifier]
        if identifier in stack:   # a cycle: stop here
            return 0
        above = [depth(parent, (*stack, identifier)) for parent in prerequisites[identifier]]
        layer[identifier] = 1 + max(above) if above else 0
        return layer[identifier]

    for identifier in ids:
        depth(identifier, ())
    rows: list[list[str]] = []
    for level in sorted(set(layer.values())):
        members = [identifier for identifier in ids if layer[identifier] == level]
        rows += [members[start:start + ROW_MAX] for start in range(0, len(members), ROW_MAX)]
    widest = max(len(row) for row in rows)
    width = 2 * PAD + widest * NODE_W + (widest - 1) * GAP_X
    positions: dict[str, tuple[float, float]] = {}
    for index, row in enumerate(rows):
        row_width = len(row) * NODE_W + (len(row) - 1) * GAP_X
        left = (width - row_width) / 2
        for column, identifier in enumerate(row):
            positions[identifier] = (left + column * (NODE_W + GAP_X), PAD + index * (NODE_H + GAP_Y))
    return positions, width, 2 * PAD + len(rows) * NODE_H + (len(rows) - 1) * GAP_Y


def _edge_path(source: tuple[float, float], target: tuple[float, float], positions: dict[str, tuple[float, float]],
               width: float, lanes: dict[str, int]) -> str:
    """From the bottom of a prerequisite to the top of the concept that needs it. An edge that would
    cross a concept of a row in between goes round by a lane in the side margin."""
    (x1, y1), (x2, y2) = source, target
    sx, sy, tx, ty = x1 + NODE_W / 2, y1 + NODE_H, x2 + NODE_W / 2, y2
    if ty <= sy:   # same row or above (a wrapped layer): join the sides
        sy, ty = y1 + NODE_H / 2, y2 + NODE_H / 2
        return f"M{sx:g} {sy:g}C{sx:g} {sy + 40:g} {tx:g} {ty + 40:g} {tx:g} {ty:g}"
    low, high = min(sx, tx) - 6, max(sx, tx) + 6
    blocked = any(sy < y < ty and x < high and x + NODE_W > low for x, y in positions.values())
    if not blocked:
        middle = (sy + ty) / 2
        return f"M{sx:g} {sy:g}C{sx:g} {middle:g} {tx:g} {middle:g} {tx:g} {ty - 2:g}"
    side = "right" if sx >= width / 2 else "left"
    offset = 10 + 8 * lanes[side]
    lanes[side] += 1
    lane = width - offset if side == "right" else offset
    return (f"M{sx:g} {sy:g}C{sx:g} {sy + 26:g} {lane:g} {sy + 8:g} {lane:g} {sy + 40:g}"
            f"L{lane:g} {ty - 40:g}C{lane:g} {ty - 12:g} {tx:g} {ty - 30:g} {tx:g} {ty - 2:g}")


def _wrap(title: str, width: int = 25, lines: int = 2) -> list[str]:
    out: list[str] = []
    current = ""
    for word in " ".join(title.split()).split(" "):
        candidate = f"{current} {word}".strip()
        if len(candidate) <= width or not current:
            current = candidate
        else:
            out.append(current)
            current = word
    out.append(current)
    if len(out) > lines:
        out = out[:lines]
        out[-1] = out[-1][: width - 1].rstrip() + "…"
    return [line if len(line) <= width + 6 else line[: width + 5] + "…" for line in out]


def _percent(value: float | None, words: dict[str, Any], measured: bool) -> str:
    if value is None:
        return words["withheld_figure"] if measured else "—"
    return f"{round(value * 100)} %"


def _teacher_line(node: MapNode, record: ConceptMapRecord, klass: ClassReport | None, words: dict[str, Any]) -> str:
    scenes = [scene for scene in record.scenes if node.id in scene.concept_ids]
    row = next((row for row in klass.concepts if row.concept == node.id), None) if klass else None
    if row is not None:
        return f"{words['accuracy']}{words['colon']}{_percent(row.accuracy, words, row.n_measured > 0)} · {words['answers_n'].format(n=row.n_attempts)}"
    return f"{words['scenes_n'].format(n=len(scenes))} · {words['sources_n'].format(n=sum(len(s.sources) for s in scenes))}"


def _svg(record: ConceptMapRecord, klass: ClassReport | None, words: dict[str, Any]) -> str:
    positions, width, height = _layout(record)
    reteach = set(klass.reteach_priority) if klass else set()
    parts = [
        f'<svg class="map" viewBox="0 0 {width:g} {height:g}" width="{width:g}" height="{height:g}" role="group" aria-label="{E(words["graph"])}">',
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0 0L10 5L0 10z" class="arrowhead"/></marker></defs>',
    ]
    lanes = {"left": 0, "right": 0}
    for edge in record.map.edges:
        parts.append(f'<path class="edge{" travelled" if edge.travelled else ""}" marker-end="url(#arrow)" '
                     f'd="{_edge_path(positions[edge.source], positions[edge.to], positions, width, lanes)}"/>')
    for node in record.map.nodes:
        x, y = positions[node.id]
        state = words["states"][node.state]
        lines = _wrap(node.title)
        first = y + (25 if len(lines) == 1 else 19)
        text = "".join(f'<text class="node-title" x="{x + 12:g}" y="{first + 16 * index:g}">{E(line)}</text>'
                       for index, line in enumerate(lines))
        classes = f"node state-{node.state}" + (" reteach" if node.id in reteach else "")
        parts.append(
            f'<g class="{classes}" data-concept="{E(node.id)}" data-state="{node.state}" tabindex="0" role="button" '
            f'aria-pressed="false" aria-label="{E(words["open"])}{E(words["colon"])}{E(node.title)} ({E(state)})">'
            f"<title>{E(node.title)}</title>"
            f'<rect x="{x:g}" y="{y:g}" width="{NODE_W}" height="{NODE_H}" rx="10"/>{text}'
            f'<text class="node-sub lens-learner" x="{x + 12:g}" y="{y + NODE_H - 9:g}">{STATE_SIGNS[node.state]} {E(state)}</text>'
            f'<text class="node-sub lens-teacher" x="{x + 12:g}" y="{y + NODE_H - 9:g}">{E(_teacher_line(node, record, klass, words))}</text>'
            "</g>")
    return "".join(parts) + "</svg>"


def _chips(ids: list[str], titles: dict[str, str], words: dict[str, Any]) -> str:
    if not ids:
        return E(words["none"])
    return " ".join(f'<button type="button" class="chip" data-goto="{E(i)}">{E(titles[i])}</button>' for i in ids)


def _sources_html(scene: RecordScene, words: dict[str, Any]) -> str:
    items = []
    for source in scene.sources:
        title = (f'<a href="{E(source.url)}" rel="noopener noreferrer">{E(source.title)}</a>' if source.url else E(source.title))
        licence = f" · {E(source.license)}" if source.license else ""
        quote = (f"<blockquote>{E(source.quote)}</blockquote>" if source.quote
                 else (f'<p class="quiet">{E(words["withheld"])}</p>' if not scene.passages_released else ""))
        items.append(f'<li>{title} <span class="badge origin-{source.origin}">{E(words["origin"][source.origin])}</span>{licence}{quote}</li>')
    return f'<ul class="sources">{"".join(items)}</ul>'


def _figure_cells(row: Figures, words: dict[str, Any]) -> str:
    measured = row.n_measured > 0
    gap = "—" if row.calibration_gap is None else f"{row.calibration_gap:+.2f}"
    time = "—" if row.mean_time_s is None else f"{round(row.mean_time_s)} {words['seconds']}"
    cells = [row.cohort_band, str(row.n_attempts), _percent(row.accuracy, words, measured),
             _percent(row.hint_reliance, words, row.n_attempts > 0), gap, time]
    return "".join(f"<td>{E(cell)}</td>" for cell in cells)


def _class_html(node: MapNode, scenes: list[RecordScene], klass: ClassReport | None, words: dict[str, Any]) -> str:
    if klass is None:
        return f'<p class="quiet">{E(words["class_none"])}</p>'
    row = next((row for row in klass.concepts if row.concept == node.id), None)
    if row is None:
        return f'<p class="quiet">{E(words["class_absent"])}</p>'
    head = "".join(f"<th>{E(column)}</th>" for column in ["", *words["class_cols"]])
    rows = [f'<tr><th scope="row">{E(words["concept"])}</th>{_figure_cells(row, words)}</tr>']
    wanted = {scene.scene_id for scene in scenes}
    rows += [f'<tr><th scope="row">{E(scene.title or scene.scene_id)}</th>{_figure_cells(scene, words)}</tr>'
             for scene in klass.scenes if scene.scene_id in wanted]
    flag = f'<p class="badge reteach-badge">{E(words["reteach"])}</p>' if node.id in klass.reteach_priority else ""
    return (f'{flag}<div class="table-scroll" tabindex="0" role="region" aria-label="{E(words["class"])}">'
            f'<table class="figures"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
            f'<p class="quiet">{E(words["class_floor"].format(n=klass.min_learners))}</p>')


def _detail(node: MapNode, record: ConceptMapRecord, klass: ClassReport | None, step_nodes: dict[int, list[str]],
            words: dict[str, Any]) -> str:
    titles = {item.id: item.title for item in record.map.nodes}
    scenes = [scene for scene in record.scenes if node.id in scene.concept_ids]
    scene_titles = {scene.scene_id: scene.title for scene in record.scenes}
    requires = [edge.source for edge in record.map.edges if edge.to == node.id]
    leads = [edge.to for edge in record.map.edges if edge.source == node.id]
    steps = [step for step in record.path if step.concept_id == node.id]
    if steps:
        rows = []
        for step in steps:
            result = words["result"]["read"] if not step.answered else words["result"][
                "recorded" if step.correct is None else ("correct" if step.correct else "wrong")]
            kind = step.navigation.kind if step.navigation else None
            mark = "ok" if step.correct else ("no" if step.correct is False else "na")
            rows.append(f'<tr data-step-row="{step.step}"><td>{step.step}</td><td>{E(scene_titles[step.scene_id])}</td>'
                        f'<td><span class="result result-{mark}">{E(result)}</span></td>'
                        f'<td>{E(words["assessed"][step.assessed_by] if step.answered else "—")}</td><td>{E(words["nav"][kind])}</td></tr>')
        head = "".join(f"<th>{E(column)}</th>" for column in words["cols"])
        answers = (f'<div class="table-scroll" tabindex="0" role="region" aria-label="{E(words["answers"])}"><table><thead><tr>{head}</tr></thead>'
                   f'<tbody>{"".join(rows)}</tbody></table></div>')
        trace = ", ".join(f"<code>{E(identifier)}</code>" for step in steps for identifier in step_nodes.get(step.step, []))
        answers += f'<p class="quiet">{E(words["trace"])}{E(words["colon"])}{trace} (<a href="trace/exploration_tree.yaml">trace/exploration_tree.yaml</a>)</p>'
    else:
        answers = f'<p class="quiet">{E(words["no_answers"])}</p>'
    rests = "".join(
        f'<li><strong>{E(scene.title)}</strong> <span class="quiet">{E(scene.type)} · {E(words["key_class"][scene.key_class])}'
        f'<span class="lens-learner"> · {E(words["served"] if scene.served else words["not_served"])}</span></span>'
        f'{_sources_html(scene, words) if scene.sources else ""}</li>'
        for scene in scenes)
    if rests:
        rests = f'<ul class="scenes">{rests}</ul>'
        if not any(scene.sources for scene in scenes):
            rests += f'<p class="quiet">{E(words["no_sources"])}</p>'
    return (
        f'<section class="concept-detail" data-detail="{E(node.id)}" aria-labelledby="h-{E(node.id)}">'
        f'<h3 id="h-{E(node.id)}">{E(node.title)}</h3>'
        f'<p class="lens-learner"><span class="badge state-badge state-{node.state}">{STATE_SIGNS[node.state]} {E(words["states"][node.state])}</span></p>'
        f'<dl class="links"><dt>{E(words["requires"])}</dt><dd>{_chips(requires, titles, words)}</dd>'
        f'<dt>{E(words["leads_to"])}</dt><dd>{_chips(leads, titles, words)}</dd></dl>'
        f'<div class="lens-learner"><h4>{E(words["answers"])}</h4>{answers}</div>'
        f'<h4>{E(words["rests"])}</h4>{rests or f"""<p class="quiet">{E(words["no_sources"])}</p>"""}'
        f'<div class="lens-teacher"><h4>{E(words["class"])}</h4>{_class_html(node, scenes, klass, words)}</div>'
        "</section>")


def _path_strip(record: ConceptMapRecord, words: dict[str, Any]) -> str:
    if not record.path:
        return f'<p class="quiet">{E(words["path_empty"])}</p>'
    titles = {scene.scene_id: scene.title for scene in record.scenes}
    buttons = []
    for step in record.path:
        mark = "ok" if step.correct else ("no" if step.correct is False else "na")
        detour = " detour" if step.navigation and step.navigation.kind in DETOURS else ""
        label = f'{words["step"]} {step.step} · {titles[step.scene_id]}'
        target = f' data-goto="{E(step.concept_id)}" data-step="{step.step}"' if step.concept_id else " disabled"
        buttons.append(f'<li><button type="button" class="step step-{mark}{detour}" data-step-button="{step.step}"{target} '
                       f'title="{E(label)}" aria-label="{E(label)}">{step.step}</button></li>')
    return f'<ol class="steps">{"".join(buttons)}</ol>'


PAGE_CSS = """
html{scroll-behavior:smooth}.skip-link{position:fixed;z-index:100;top:.5rem;left:.5rem;transform:translateY(-180%);padding:.65rem 1rem;background:#193039;color:#fff;border-radius:.25rem}.skip-link:focus{transform:translateY(0)}
.viewer-header>div:first-child{max-width:78ch}.viewer-header .viewer-summary{padding:0;border:0;background:transparent}
.toolbar{display:flex;flex-wrap:wrap;gap:.75rem 2rem;align-items:center;margin:0 0 1rem}.toolbar fieldset{border:0;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem .9rem;align-items:center}.toolbar legend{float:left;margin-right:.6rem;font-weight:600;padding:0}
.toolbar label{display:inline-flex;gap:.35rem;align-items:center;min-height:32px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,460px);gap:1.25rem;align-items:start}.layout>*{min-width:0}
.studium-viewer .detail .table-scroll table{min-width:0;width:100%;font-size:.88rem}.studium-viewer .detail th,.studium-viewer .detail td{padding:.45rem .5rem;overflow-wrap:normal;word-break:normal}.studium-viewer .detail .table-scroll table.figures{min-width:560px}
.studium-viewer h1{max-width:40ch;overflow-wrap:anywhere}.toolbar,.card{min-width:0}
.graph-scroll{overflow:auto;border:1px solid var(--studium-rule);border-radius:var(--studium-radius);background:var(--studium-surface);padding:.5rem;max-height:80vh}
.map{display:block;margin:0 auto;font-family:var(--studium-font)}
.edge{fill:none;stroke:var(--studium-muted);stroke-width:1.6;stroke-dasharray:5 4}.edge.travelled{stroke:var(--studium-accent);stroke-width:2.4;stroke-dasharray:none}.arrowhead{fill:var(--studium-muted)}
.node{cursor:pointer}.node rect{fill:var(--studium-surface);stroke:var(--studium-rule);stroke-width:1.6}.node:focus{outline:none}.node:focus rect,.node[aria-pressed="true"] rect{stroke-width:3.6}
.node-title{font-size:13.5px;font-weight:600;fill:var(--studium-ink)}.node-sub{font-size:12px;fill:var(--studium-muted)}
body[data-lens="learner"] .state-acquired rect{fill:var(--studium-accent-soft);stroke:var(--studium-accent)}
body[data-lens="learner"] .state-to_review rect{fill:var(--studium-warning-soft);stroke:var(--studium-warning)}
body[data-lens="learner"] .state-current rect{stroke:var(--studium-accent-strong);stroke-width:3}
body[data-lens="learner"] .state-seen rect{stroke:var(--studium-muted)}
body[data-lens="learner"] .state-upcoming rect{fill:var(--studium-canvas);stroke-dasharray:5 4}
body[data-lens="learner"] .node.dim{opacity:.22}
body[data-lens="teacher"] .edge{stroke:var(--studium-muted);stroke-width:1.6;stroke-dasharray:none}body[data-lens="teacher"] .node.reteach rect{fill:var(--studium-warning-soft);stroke:var(--studium-warning)}
body[data-lens="learner"] .lens-teacher,body[data-lens="teacher"] .lens-learner{display:none}
.detail{border:1px solid var(--studium-rule);border-radius:var(--studium-radius);background:var(--studium-surface);padding:1rem 1.1rem}.detail:focus{outline:2px solid var(--studium-accent);outline-offset:2px}
.concept-detail+.concept-detail{margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--studium-rule)}body[data-js="on"] .concept-detail+.concept-detail{margin-top:0;padding-top:0;border-top:0}
.concept-detail h3{margin:.1rem 0 .5rem}.concept-detail h4{margin:1.1rem 0 .4rem;font-size:1rem}.concept-detail h5{margin:.7rem 0 .1rem;font-size:.95rem}
.links{display:grid;grid-template-columns:max-content 1fr;gap:.3rem .8rem;margin:.4rem 0}.links dt{font-weight:600}.links dd{margin:0}
.studium-viewer .chip{font:inherit;font-weight:500;min-height:0;padding:.15rem .65rem;margin:.1rem 0;border:1px solid var(--studium-rule);border-radius:999px;background:var(--studium-canvas);color:var(--studium-ink);cursor:pointer}.studium-viewer .chip:hover,.studium-viewer .chip:focus{border-color:var(--studium-accent);background:var(--studium-accent-soft);color:var(--studium-ink)}
.badge{display:inline-block;padding:.05rem .5rem;border-radius:999px;border:1px solid var(--studium-rule);font-size:.82rem;color:var(--studium-muted);background:var(--studium-canvas)}
.state-badge.state-acquired{background:var(--studium-accent-soft);border-color:var(--studium-accent);color:var(--studium-accent-strong)}.state-badge.state-to_review,.reteach-badge{background:var(--studium-warning-soft);border-color:var(--studium-warning);color:var(--studium-warning)}.state-badge.state-current{border-color:var(--studium-accent-strong);color:var(--studium-accent-strong)}
.origin-conversation{border-color:var(--studium-warning);color:var(--studium-warning)}
.quiet{color:var(--studium-muted);font-size:.9rem;margin:.3rem 0}.scenes{margin:.3rem 0;padding-left:1.1rem}.scenes>li{margin:.45rem 0}.scenes .quiet{font-size:.85rem}.sources{margin:.3rem 0;padding-left:1.1rem}.sources li{margin:.35rem 0}.sources blockquote{margin:.35rem 0 .2rem;padding:.35rem .7rem;border-left:3px solid var(--studium-accent);background:var(--studium-accent-soft);white-space:pre-wrap;overflow-wrap:anywhere}
.result-ok{color:var(--studium-accent-strong);font-weight:600}.result-no{color:var(--studium-danger);font-weight:600}.result-na{color:var(--studium-muted)}tr.is-step td{background:var(--studium-accent-soft)}
.steps{list-style:none;display:flex;flex-wrap:wrap;gap:.3rem;margin:.4rem 0;padding:0}.studium-viewer .step{font:inherit;font-weight:600;min-width:2.2rem;min-height:2.2rem;padding:0 .3rem;border-radius:6px;border:1.5px solid var(--studium-rule);background:var(--studium-surface);color:var(--studium-ink);cursor:pointer}
.studium-viewer .step:hover{background:var(--studium-canvas);color:var(--studium-ink);border-color:var(--studium-accent-strong)}.studium-viewer .step-ok{background:var(--studium-accent-soft);border-color:var(--studium-accent)}.studium-viewer .step-no{background:var(--studium-warning-soft);border-color:var(--studium-danger)}.studium-viewer .step.detour{border-style:dashed}.studium-viewer .step[aria-current="step"]{outline:2px solid var(--studium-accent-strong);outline-offset:1px}.studium-viewer .step:disabled{opacity:.5;cursor:default}
.legend{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin:.5rem 0;padding:0;list-style:none;font-size:.9rem}.resource-links{display:flex;gap:.4rem 1rem;flex-wrap:wrap}
.files{margin:.3rem 0;padding-left:1.1rem}.report-section{margin:0 0 1.6rem}
@media(max-width:900px){.layout{grid-template-columns:1fr}.graph-scroll{max-height:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{.skip-link,.toolbar{display:none}.layout{grid-template-columns:1fr}.graph-scroll{max-height:none;overflow:visible}}
"""

PAGE_JS = """(function () {
  var body = document.body;
  var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-concept]"));
  var details = Array.prototype.slice.call(document.querySelectorAll(".concept-detail"));
  var steps = Array.prototype.slice.call(document.querySelectorAll("[data-step-button]"));
  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-step-row]"));
  function select(id, step, focus) {
    if (!details.some(function (d) { return d.dataset.detail === id; })) return;
    details.forEach(function (d) { d.hidden = d.dataset.detail !== id; });
    nodes.forEach(function (n) { n.setAttribute("aria-pressed", n.dataset.concept === id ? "true" : "false"); });
    steps.forEach(function (b) { b.setAttribute("aria-current", step && b.dataset.stepButton === String(step) ? "step" : "false"); });
    rows.forEach(function (r) { r.classList.toggle("is-step", !!step && r.dataset.stepRow === String(step)); });
    try { history.replaceState(null, "", "#" + encodeURIComponent(id)); } catch (e) { /* file: pages may refuse */ }
    if (focus) { var panel = document.getElementById("detail"); if (panel) panel.focus(); }
  }
  nodes.forEach(function (n) {
    n.addEventListener("click", function () { select(n.dataset.concept, null, false); });
    n.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(n.dataset.concept, null, true); }
    });
  });
  document.addEventListener("click", function (e) {
    var target = e.target && e.target.closest ? e.target.closest("[data-goto]") : null;
    if (target) select(target.dataset.goto, target.dataset.step || null, false);
  });
  Array.prototype.forEach.call(document.querySelectorAll("input[name=lens]"), function (radio) {
    radio.addEventListener("change", function () { if (radio.checked) body.dataset.lens = radio.value; });
  });
  Array.prototype.forEach.call(document.querySelectorAll("input[data-state-filter]"), function (box) {
    box.addEventListener("change", function () {
      nodes.forEach(function (n) { if (n.dataset.state === box.dataset.stateFilter) n.classList.toggle("dim", !box.checked); });
    });
  });
  body.dataset.js = "on";
  var wanted = "";
  try { wanted = decodeURIComponent((location.hash || "").slice(1)); } catch (e) { wanted = ""; }
  select(details.some(function (d) { return d.dataset.detail === wanted; }) ? wanted : body.dataset.initial, null, false);
})();"""


def _render_html(report: MapReport, record: ConceptMapRecord, klass: ClassReport | None,
                 step_nodes: dict[int, list[str]], myst: str) -> str:
    """The self-contained page. Every concept's detail is in the HTML; the script only shows one at a
    time, switches viewpoint and filters. Without scripts the details read one under the other."""
    words = WORDS[report.language]
    authoring = record.authoring
    initial = record.map.position.at or next((node.id for node in record.map.nodes if node.state != "upcoming"), record.map.nodes[0].id)
    facts = [words["drafted"][authoring.drafted_by], words["validated"][authoring.validated], words["judge"][authoring.judge]]
    conversation = f'<p class="notice">{E(words["conversation"])}</p>' if authoring.from_conversation else ""
    filters = "".join(
        f'<label><input type="checkbox" data-state-filter="{state}" checked> {STATE_SIGNS[state]} {E(words["states"][state])}</label>'
        for state in STATES)
    details = "".join(_detail(node, record, klass, step_nodes, words) for node in record.map.nodes)
    files = "".join(f'<li><a href="{E(path)}">{E(path)}</a> — {E(text)}</li>' for path, text in words["files"])
    if klass is not None:
        files += f'<li><a href="{CLASS_PATH}">{CLASS_PATH}</a> — class_report</li>'
    digest = base64.b64encode(hashlib.sha256(PAGE_JS.encode("utf-8")).digest()).decode("ascii")
    return f"""<!doctype html>
<html lang="{report.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-{digest}'">
<title>{E(words["page_title"])} — {E(record.lesson.title)}</title>
<style id="studium-theme">
{_shared_theme()}
</style>
<style id="map-layout">{PAGE_CSS}</style></head>
<body class="studium-viewer" data-viewer="concept-map" data-lens="learner" data-initial="{E(initial)}">
<a class="skip-link" href="#main">{E(words["skip"])}</a>
<header class="viewer-header"><div><p class="viewer-kicker">{E(words["kicker"])}</p><h1>{E(words["page_title"])} — {E(record.lesson.title)}</h1>
<p class="viewer-summary">{E(words["summary"])}</p></div></header>
<main id="main">
<section class="report-section card" id="overview"><p class="notice">{E(words["notice"])}</p>
<p>{E(words["list"].join(facts))}.</p>{conversation}
<div class="toolbar"><fieldset><legend>{E(words["lens"])}</legend>
<label><input type="radio" name="lens" value="learner" checked> {E(words["learner"])}</label>
<label><input type="radio" name="lens" value="teacher"> {E(words["teacher"])}</label></fieldset>
<fieldset class="lens-learner"><legend>{E(words["filter"])}</legend>{filters}</fieldset></div>
<p class="quiet">{E(words["legend"])} <span class="lens-learner">{E(words["legend_path"])}</span></p></section>
<div class="layout">
<section class="report-section" id="graph" aria-label="{E(words["graph"])}"><div class="graph-scroll" tabindex="0">{_svg(record, klass, words)}</div>
<div class="lens-learner"><h2>{E(words["path"])}</h2><p class="quiet">{E(words["path_help"])}</p>{_path_strip(record, words)}</div></section>
<section class="report-section detail" id="detail" tabindex="-1" aria-live="polite" aria-label="{E(words["concept"])}">{details}</section>
</div>
<section class="report-section card" id="provenance"><h2>{E(words["provenance"])}</h2><ul class="files">{files}</ul>
<details><summary>{E(words["myst_source"])}</summary><pre>{E(myst)}</pre></details></section>
</main>
<script>{PAGE_JS}</script>
</body></html>
"""


# --- export and verify -------------------------------------------------------------------------------

def _read_record(path: Path) -> ConceptMapRecord:
    return ConceptMapRecord.model_validate(read_json_payload(path))


def _read_class(path: Path, record: ConceptMapRecord) -> ClassReport:
    value = read_json_payload(path)
    if isinstance(value, dict) and value.get("status") in ("suppressed", "no_data"):
        raise ReportError(f"the class report holds no publishable figure (status {value['status']}); export without it")
    klass = ClassReport.model_validate(value)
    if klass.bundle_id != record.lesson.bundle_id:
        raise ReportError("the class report is for another lesson (bundle_id differs)")
    return klass


def _artifact_names(directory: Path) -> list[str]:
    names = ["report.json", "astra.yaml", "trace/exploration_tree.yaml", "course_provenance.myst.md", "index.html"]
    return names + [str(path.relative_to(directory)) for path in sorted((directory / "sources").glob("*.json"))]


def _rendered(directory: Path, report: MapReport, record: ConceptMapRecord, klass: ClassReport | None,
              step_nodes: dict[int, list[str]]) -> tuple[str, str]:
    """The MyST page and the browser page as this version renders them from the directory."""
    myst = render_mystra(directory) + _map_myst(record, WORDS[report.language])
    return myst, _render_html(report, record, klass, step_nodes, myst)


def _build(directory: Path, record_bytes: bytes, record: ConceptMapRecord, klass: ClassReport | None, language: str) -> None:
    generated_at = _now()
    (directory / "sources").mkdir(parents=True)
    (directory / RECORD_PATH).write_bytes(record_bytes)
    if klass is not None:
        _write_json(directory / CLASS_PATH, klass.model_dump(mode="json"))
    report = MapReport.model_validate(_report_value(record, _source_records(directory, klass is not None), language, generated_at))
    _write_json(directory / "report.json", report.model_dump(mode="json", by_alias=True))
    document = _report_astra(report)
    write_astra_yaml(document, str(directory))
    tree, step_nodes = _report_trace(document, record)
    _validate_ara(tree)
    write_exploration_trace(tree, str(directory))
    validation = run_astra_validate(directory)
    if not validation.ok:
        raise ReportError(f"generated ASTRA failed astra-tools validation: {validation.output.strip()}")
    myst, page = _rendered(directory, report, record, klass, step_nodes)
    (directory / "course_provenance.myst.md").write_text(myst, encoding="utf-8")
    (directory / "index.html").write_text(page, encoding="utf-8")
    checks = {
        "schema": CHECKS_SCHEMA, "generated_at": generated_at,
        "astra": {"validator": "astra-tools", "astra_spec": ASTRA_SCHEMA_VERSION, "evidence_resolution": "skipped", "status": "passed"},
        "artifacts": {name: _sha256(directory / name) for name in _artifact_names(directory)},
    }
    _write_json(directory / "checks.json", MapChecks.model_validate(checks).model_dump(mode="json", by_alias=True))


def export_concept_map_report(record_path: Path, output_dir: Path, *, class_report_path: Path | None = None,
                              expect_sha256: str | None = None, language: str | None = None) -> Path:
    """Export a record (and optionally a class report) to a new, verified directory."""
    try:
        record_bytes = Path(record_path).read_bytes()
        digest = hashlib.sha256(record_bytes).hexdigest()
        if expect_sha256 is not None and digest != expect_sha256.lower():
            raise ReportError(f"the record's SHA-256 is {digest}, not the expected {expect_sha256}: it is not the file the server wrote")
        record = _read_record(Path(record_path))
        klass = _read_class(Path(class_report_path), record) if class_report_path else None
    except ReportError:
        raise
    except (OSError, ValueError, ValidationError) as exc:
        raise ReportError(f"invalid concept-map record or class report: {exc}") from exc
    output_dir = Path(output_dir).resolve()
    if output_dir.exists():
        raise ReportError(f"output directory already exists: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_root = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    staging = temporary_root / output_dir.name
    staging.mkdir()
    try:
        _build(staging, record_bytes, record, klass, _language(record, language))
        staging.replace(output_dir)
        temporary_root.rmdir()
    except Exception:
        shutil.rmtree(temporary_root, ignore_errors=True)
        raise
    return output_dir


def verify_concept_map_report(directory: Path) -> dict[str, Any]:
    """Recheck digests, the record, the report summary, ARA, ASTRA, MySTRA and the page."""
    import yaml
    directory = Path(directory).resolve()
    try:
        checks = MapChecks.model_validate(read_json_payload(directory / "checks.json"))
        report = MapReport.model_validate(read_json_payload(directory / "report.json"))
        if (directory / "sources").is_symlink():
            raise ReportError("sources directory must not be a symbolic link")
        if set(checks.artifacts) != set(_artifact_names(directory)):
            raise ReportError("checks manifest does not cover the exact report artifacts")
        for relative, expected in checks.artifacts.items():
            if _sha256(_checked_path(directory, relative)) != expected:
                raise ReportError(f"artifact hash mismatch: {relative}")
        record = _read_record(directory / RECORD_PATH)
        with_class = (directory / CLASS_PATH).exists()
        klass = _read_class(directory / CLASS_PATH, record) if with_class else None
        expected_report = MapReport.model_validate(_report_value(
            record, _source_records(directory, with_class), report.language, report.generated_at))
        if expected_report != report:
            raise ReportError("report summary does not match its selected sources")
        expected_astra = _report_astra(report)
        if yaml.safe_load((directory / "astra.yaml").read_text(encoding="utf-8")) != expected_astra:
            raise ReportError("ASTRA document does not match the selected sources")
        tree = yaml.safe_load((directory / "trace/exploration_tree.yaml").read_text(encoding="utf-8"))
        _validate_ara(tree)
        expected_tree, step_nodes = _report_trace(expected_astra, record)
        if tree != expected_tree:
            raise ReportError("ARA trace does not match the record's path")
        validation = run_astra_validate(directory)
        if not validation.ok:
            raise ReportError(f"ASTRA validation failed: {validation.output.strip()}")
        myst, page = _rendered(directory, report, record, klass, step_nodes)
        if myst != (directory / "course_provenance.myst.md").read_text(encoding="utf-8"):
            raise ReportError("MySTRA rendering is stale")
        if page != (directory / "index.html").read_text(encoding="utf-8"):
            raise ReportError("browser rendering is stale")
        return {"ok": True, "astra_validator": "astra-tools", "artifacts": len(checks.artifacts),
                "record_sha256": report.sources[0].sha256}
    except ReportError:
        raise
    except (OSError, ValueError, ValidationError) as exc:
        raise ReportError(f"invalid concept-map report: {exc}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="export a concept-map record to a new directory")
    export.add_argument("record", type=Path, help="the file export_concept_map wrote")
    export.add_argument("output", type=Path, help="a directory that does not exist yet")
    export.add_argument("--class-report", type=Path, help="the JSON class_report returned (teacher viewpoint)")
    export.add_argument("--expect-sha256", help="the sha256 export_concept_map returned for the record")
    export.add_argument("--language", choices=["fr", "en"], help="language of the page (default: the lesson's)")
    verify = commands.add_parser("verify", help="verify an exported report")
    verify.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            path = export_concept_map_report(args.record, args.output, class_report_path=args.class_report,
                                             expect_sha256=args.expect_sha256, language=args.language)
            print(path / "index.html")
        else:
            print(json.dumps(verify_concept_map_report(args.directory), sort_keys=True))
        print(f"astra-spec {_version('astra-spec')} / astra-tools {_version('astra-tools')}")
        return 0
    except (OSError, ValueError, ValidationError) as exc:
        print(f"concept map report: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
