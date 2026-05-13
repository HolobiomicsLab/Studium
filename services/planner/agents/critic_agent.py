"""CriticAgent : évalue un LessonPlan (score + cohérence Bloom + warnings ontologiques)."""
from __future__ import annotations
import json
import time
import uuid
from typing import TYPE_CHECKING

from agents.base import BaseAgent
from lesson_plan_schema import SceneType, BloomLevel, RefType

if TYPE_CHECKING:
    from lesson_plan_schema import LessonPlan

_APPLY_SCENE_TYPES = {SceneType.simulation, SceneType.reproduction}
_HIGH_BLOOM = {BloomLevel.apply, BloomLevel.analyze, BloomLevel.evaluate, BloomLevel.create}


class CriticAgent(BaseAgent):
    alias = "studium/critic"
    system_prompt = (
        "Tu es un agent critique pédagogique. Évalue le plan fourni et retourne JSON: "
        '{"score": float [0..1], "annotations": [string, ...]}. Uniquement du JSON.'
    )

    def review(self, plan: "LessonPlan") -> "CritiqueResult":  # noqa: F821
        from planner_schemas import CritiqueResult
        run_id = self._run_id()
        prov_uri = f"urn:studium:activity:critic:{run_id}"

        # Cohérence Bloom (déterministe, sans LLM)
        bloom_consistency, bloom_warnings = self._check_bloom_consistency(plan)
        ontology_warnings = bloom_warnings + self._check_ontology_warnings(plan)

        # Score LLM
        prompt = self._build_prompt(plan)
        t0 = time.monotonic()
        raw = None
        last_exc = None
        score = 0.75
        annotations: list[str] = []
        llm_used = False

        for attempt in range(1, self.max_retries + 1):
            try:
                raw = self._call_llm(prompt)
                data = json.loads(raw)
                score = float(data["score"])
                if not (0.0 <= score <= 1.0):
                    raise ValueError(f"score hors range: {score}")
                annotations = [str(a) for a in data.get("annotations", [])]
                llm_used = True
                break
            except Exception as exc:
                last_exc = exc

        evidence_planned = [
            s.id for s in plan.scene_outlines if self._evaluate_enrichment(s)
        ]

        return CritiqueResult(
            score=score,
            annotations=annotations,
            bloom_consistency=bloom_consistency,
            ontology_warnings=ontology_warnings,
            prov_activity_uri=prov_uri,
            evidence_planned_scene_ids=evidence_planned,
            llm_used=llm_used,
        )

    def _check_bloom_consistency(self, plan: "LessonPlan") -> tuple[bool, list[str]]:
        warnings: list[str] = []
        scene_types = {s.type for s in plan.scene_outlines}
        high_bloom_objs = [o for o in plan.learning_objectives if o.bloom_level in _HIGH_BLOOM]
        if high_bloom_objs and not (_APPLY_SCENE_TYPES & scene_types):
            levels = ", ".join(o.bloom_level.value for o in high_bloom_objs)
            warnings.append(
                f"Objectifs de niveau [{levels}] présents mais aucune scène 'reproduction' ou 'simulation'."
            )
            return False, warnings
        return True, warnings

    def _check_ontology_warnings(self, plan: "LessonPlan") -> list[str]:
        warnings: list[str] = []
        for ref in plan.corpus_refs:
            if ref.ref_type == RefType.doi and ref.doi and not ref.prov_entity_uri:
                warnings.append(f"CorpusRef '{ref.ref_id}' a un DOI mais prov_entity_uri est absent.")
        if not plan.dct_subject:
            warnings.append("LessonPlan.dct_subject absent — traçabilité disciplinaire limitée.")
        return warnings

    def _build_prompt(self, plan: "LessonPlan") -> str:
        scenes = ", ".join(f"{s.type.value}:{s.title}" for s in plan.scene_outlines)
        objectives = "; ".join(f"{o.bloom_level.value}:{o.description}" for o in plan.learning_objectives)
        return (
            f"Évalue ce plan pédagogique ({plan.target}, {plan.duration_minutes} min).\n"
            f"Objectifs : {objectives}\nScènes : {scenes}\n"
            f'Retourne uniquement JSON: {{"score": float, "annotations": [string, ...]}}'
        )

    def _evaluate_enrichment(self, scene) -> bool:
        """Décide si scene doit être enrichie post-critic (heuristique + override).

        ADR 014 : override 'force'/'skip' gagne sur heuristique ; sinon seuls
        intro/concept/simulation/reproduction sont éligibles.
        """
        from lesson_plan_schema import SceneType
        if scene.evidence_override == "force":
            return True
        if scene.evidence_override == "skip":
            return False
        return scene.type in {
            SceneType.intro,
            SceneType.concept,
            SceneType.simulation,
            SceneType.reproduction,
        }

    def _mock_response(self, reason: str = "") -> str:
        return json.dumps({
            "score": 0.78,
            "annotations": [
                "Le plan couvre bien les objectifs de niveau understand.",
                "Suggérer une scène simulation pour renforcer l'apply.",
                "Références corpus présentes et traçables.",
            ],
        })
