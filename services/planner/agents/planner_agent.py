"""PlannerAgent : génère un LessonPlan depuis un corpus manifest."""
from __future__ import annotations
import json
import sys
import os
import time
import uuid
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))

from agents.base import BaseAgent
from lesson_plan_schema import LessonPlan, CorpusRef, RefType, Concept


_BLOOM_URI_MAP = {
    "remember":   "urn:studium:bloom:remember",
    "understand": "urn:studium:bloom:understand",
    "apply":      "urn:studium:bloom:apply",
    "analyze":    "urn:studium:bloom:analyze",
    "evaluate":   "urn:studium:bloom:evaluate",
    "create":     "urn:studium:bloom:create",
}


class PlannerAgent(BaseAgent):
    alias = "studium/planner"
    system_prompt = (
        "Tu es un agent pédagogique. Génère un plan de cours structuré en JSON conforme au schéma lesson-plan-schema v1. "
        "Peuple les champs ontologiques optionnels (dct_subject, prov_derived_from, skos_concept_uri) "
        "quand le corpus le permet. Retourne uniquement le JSON, sans commentaire."
    )

    def generate(
        self,
        manifest: dict[str, Any],
        target: str,
        duration_minutes: int = 45,
    ) -> tuple[LessonPlan, dict[str, Any]]:
        run_id = self._run_id()
        prompt = self._build_prompt(manifest, target, duration_minutes)
        t0 = time.monotonic()
        raw: str | None = None
        last_exc: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            try:
                raw = self._call_llm(prompt)
                data = json.loads(raw)
                data["target"] = target
                if not data.get("corpus_refs"):
                    data["corpus_refs"] = manifest.get("corpus_refs", [])
                plan = LessonPlan(**data)
                plan = self._inject_prov(plan, manifest, run_id)
                plan = self._inject_bloom_uris(plan)
                plan = self._enrich_from_abs(manifest, plan)
                if not plan.concepts:
                    plan.concepts = [
                        Concept(
                            id=o.id,
                            title=o.description,
                            description=o.description,
                            bloom_level_target=o.bloom_level,
                        )
                        for o in plan.learning_objectives
                    ]
                audit = self._audit(attempt, "ok", time.monotonic() - t0)
                self._last_audit = audit
                return plan, audit
            except Exception as exc:
                last_exc = exc
                continue

        audit = self._audit(self.max_retries, "error", time.monotonic() - t0, str(last_exc))
        raise ValueError(f"PlannerAgent: failed after {self.max_retries} attempts. Last: {last_exc}\nRaw: {raw!r}")

    def _build_prompt(self, manifest: dict[str, Any], target: str, duration_minutes: int) -> str:
        refs = ", ".join(
            r.get("doi") or r.get("ref_id", "?")
            for r in manifest.get("corpus_refs", [])[:5]
        )
        preview = (manifest.get("text_preview") or "")[:300]
        return (
            f"Génère un plan pédagogique structuré pour un cours de niveau {target}.\n"
            f"Durée : {duration_minutes} minutes.\n"
            f"Références corpus : {refs or 'aucune'}.\n"
            f"Extrait : {preview}\n"
            f"Retourne uniquement un objet JSON conforme au schéma lesson-plan-schema v1."
        )

    def _inject_prov(self, plan: LessonPlan, manifest: dict[str, Any], run_id: str) -> LessonPlan:
        plan.prov_entity_uri = plan.prov_entity_uri or f"urn:studium:plan:{plan.id}"
        plan.prov_generated_by = f"urn:studium:activity:planner:{run_id}"
        if not plan.prov_derived_from:
            plan.prov_derived_from = [
                ref.prov_entity_uri or (f"doi:{ref.doi}" if ref.doi else f"urn:studium:ref:{ref.ref_id}")
                for ref in plan.corpus_refs
                if ref.doi or ref.prov_entity_uri
            ]
        # Injecter prov_entity_uri sur les CorpusRef si absent
        for ref in plan.corpus_refs:
            if not ref.prov_entity_uri:
                if ref.ref_type == RefType.doi and ref.doi:
                    ref.prov_entity_uri = f"doi:{ref.doi}"
                else:
                    ref.prov_entity_uri = f"urn:studium:ref:{ref.ref_id}"
        if not plan.dct_language:
            plan.dct_language = plan.language
        return plan

    def _inject_bloom_uris(self, plan: LessonPlan) -> LessonPlan:
        for obj in plan.learning_objectives:
            if not obj.bloom_uri:
                obj.bloom_uri = _BLOOM_URI_MAP.get(obj.bloom_level.value, f"urn:studium:bloom:{obj.bloom_level.value}")
        return plan

    def _enrich_from_abs(self, manifest: dict[str, Any], plan: "LessonPlan") -> "LessonPlan":
        """Si des CorpusRef de type abs_capsule sont présents, enrichit le plan."""
        import sys as _sys
        _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/ingest"))
        try:
            from abs_reader import ABSCapsuleReader
        except ImportError:
            return plan

        for ref in manifest.get("corpus_refs", []):
            if ref.get("ref_type") != "abs_capsule":
                continue
            capsule_path = ref.get("abs_capsule_path")
            if not capsule_path:
                continue
            task_card_ids = ref.get("abs_task_card_ids")
            reader = ABSCapsuleReader()
            capsule_data = reader.read(capsule_path, task_card_ids)

            # Ajouter scènes reproduction depuis task cards (en tête de liste). Avec
            # ``emit_judgment_scenes``, on émet AUSSI une scène de jugement capsule-ancrée
            # (spot_the_flaw) par task card : le composer exécute la capsule + attache le
            # reference_result réel. Opération réelle = véhicule ; jugement calibré = destination.
            from lesson_plan_schema import SceneOutline, SceneType
            emit_judgment = bool(manifest.get("emit_judgment_scenes"))
            block: list = []
            for card in capsule_data.task_cards:
                scene_id = f"sc-abs-{card.task_id}"
                if any(s.id == scene_id for s in plan.scene_outlines):
                    continue
                notes = (
                    f"Inputs: {', '.join(card.inputs[:3])}. "
                    f"Outputs: {', '.join(card.expected_outputs[:3])}. "
                    f"Tools: {', '.join(card.tools[:3])}."
                )
                block.append(SceneOutline(
                    id=scene_id,
                    type=SceneType.reproduction,
                    title=card.title,
                    objective_refs=[o.id for o in plan.learning_objectives[:1]],
                    notes=notes,
                    abs_task_card_id=card.task_id,
                ))
                judge_id = f"sc-judge-{card.task_id}"
                if emit_judgment and not any(s.id == judge_id for s in plan.scene_outlines):
                    block.append(SceneOutline(
                        id=judge_id,
                        type=SceneType.spot_the_flaw,
                        title=f"Auditer une lecture IA — {card.title}",
                        objective_refs=[o.id for o in plan.learning_objectives[:1]],
                        notes="Audite une lecture IA du résultat exécuté réel de cette "
                              "capsule (jugement calibré sur un résultat vérifié).",
                        abs_task_card_id=card.task_id,
                    ))
            # Insérer le bloc (reproduction [+ jugement]) avant les scènes de reproduction existantes
            first_repro_idx = next(
                (i for i, s in enumerate(plan.scene_outlines) if s.type == SceneType.reproduction),
                len(plan.scene_outlines),
            )
            for scene in reversed(block):
                plan.scene_outlines.insert(first_repro_idx, scene)

            # Enrichir objectives avec EDAM depuis skills
            for skill in capsule_data.skills:
                for obj in plan.learning_objectives:
                    if not obj.edam_operation and skill.edam_operation:
                        obj.edam_operation = skill.edam_operation
                    if not obj.edam_topics and skill.edam_topics:
                        obj.edam_topics = skill.edam_topics
                    if not obj.skos_concept_uri and skill.edam_topics:
                        obj.skos_concept_uri = skill.edam_topics[0]

            # Ajouter ro_crate_entity_uri dans prov_derived_from
            if capsule_data.ro_crate_entity_uri:
                if not plan.prov_derived_from:
                    plan.prov_derived_from = []
                if capsule_data.ro_crate_entity_uri not in plan.prov_derived_from:
                    plan.prov_derived_from.append(capsule_data.ro_crate_entity_uri)

        return plan

    def _mock_response(self, reason: str = "") -> str:
        import time as _time
        return json.dumps({
            "schema_version": "1.0",
            "id": f"plan-{uuid.uuid4().hex[:8]}",
            "title": "Introduction à la métabolomique (plan généré)",
            "language": "fr",
            "target": "L3",
            "duration_minutes": 45,
            "learning_objectives": [
                {"id": "obj-1", "description": "Comprendre les fondements de la métabolomique", "bloom_level": "understand"},
                {"id": "obj-2", "description": "Appliquer les techniques d'analyse LC-MS", "bloom_level": "apply"},
            ],
            "scene_outlines": [
                {"id": "sc-1", "type": "intro", "title": "Introduction au domaine", "objective_refs": ["obj-1"]},
                {"id": "sc-2", "type": "concept", "title": "Méthodes analytiques LC-MS", "objective_refs": ["obj-1", "obj-2"]},
                {"id": "sc-3", "type": "reproduction", "title": "TP : analyse d'un spectre de masse", "objective_refs": ["obj-2"]},
                {"id": "sc-4", "type": "quiz", "title": "Vérification des acquis", "objective_refs": ["obj-2"]},
            ],
            "corpus_refs": [],
            "status": "draft",
            "metadata": {
                "subject": "Métabolomique",
                "author": "system",
                "created": _time.strftime("%Y-%m-%d"),
                "tags": ["mock" if not reason else "mock-fallback"],
            },
        })
