"""Base abstraite pour les agents de synthèse de scène (A2).

Pattern : LiteLLM call -> JSON parse -> Pydantic validation -> critic loop
-> max 3 attempts -> raise on failure.

Convention rule 002 : validation Pydantic stricte + retry sur erreur.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from jinja2 import Template
from pydantic import BaseModel, ValidationError


class SceneSynthError(Exception):
    """Erreur levée quand la synthèse échoue après 3 tentatives."""


class SceneAgent(ABC):
    """Agent abstrait de synthèse d'une scène typée.

    Sous-classes : ``IntroAgent``, ``ConceptAgent``, ``QuizAgent``,
    ``MetaCheckpointAgent``, ``ReproductionAgent``, ``AICritiqueAgent``.

    Chaque sous-classe déclare :
    - ``scene_type`` : le littéral du champ ``type`` Pydantic.
    - ``prompt_path`` : chemin vers le template Jinja2.
    - ``_validate(raw)`` : parse JSON brut -> instance Pydantic.
    """

    scene_type: str
    prompt_path: Path

    def __init__(self, llm_client, critic):
        self.llm = llm_client
        self.critic = critic
        self._template = Template(self.prompt_path.read_text())

    def synthesize(self, plan_section: dict, context: dict) -> BaseModel:
        last_error: str | None = None
        for _attempt in range(3):
            prompt = self._template.render(
                plan_section=plan_section, context=context, last_error=last_error
            )
            raw = self.llm.complete(prompt)
            try:
                scene = self._validate(raw)
            except ValidationError as e:
                last_error = str(e)
                continue
            review = self.critic.review(scene, plan_section)
            if review.passed:
                return self._attach_provenance(scene, plan_section)
            last_error = getattr(review, "feedback", "critic rejected")
        raise SceneSynthError(
            f"{self.scene_type}: failed after 3 attempts (last error: {last_error})"
        )

    @abstractmethod
    def _validate(self, raw: str) -> BaseModel: ...

    def _attach_provenance(self, scene: BaseModel, plan_section: dict) -> BaseModel:
        # Provenance attachée au niveau du bundler — pass-through ici.
        return scene
