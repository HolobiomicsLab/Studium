"""The `demo-fresh` bundle: what the E2E harnesses play, emitted rather than stored.

Three harnesses stage `/tmp/studium-e2e/demo-fresh.zip` — A.10
(`play-bundle-from-scene-synth.test.ts`), C.8 (`telemetry-end-to-end.spec.ts`) and M5
(`m5-end-to-end.spec.ts`) — and until now **nothing in the repository created it**, so all
three could only ever have failed at the library. Only the M6 demo staged a real file, from a
checked-in fixture.

What the missing bundle is, is not a free choice. A.10's own docstring says *"a bundle produced
by `services/scene-synth`"* and calls the missing step a fixture *bake*; the name is *fresh*.
So `demo-fresh` is the bundle the synthesis pipeline emits **at run time**, through the real
`SceneSynthOrchestrator` and the real `bundler`, not a zip committed beside them. A stored
fixture would answer the same selector while measuring nothing about the pipeline, which is
what those harnesses exist to exercise.

The scene JSON below is canned, and that is the point: the pipeline is real, the language model
is not. Live model runs are owner-gated in this repository, so a harness that needed one could
not run on CI or on a contributor's machine, and would not be reproducible if it did. Each
canned scene is keyed on a signature unique to its prompt template.

`services/scene-synth/tests/e2e/test_full_pipeline.py` imports this module rather than holding
its own copy: the bundle the test asserts about and the bundle the harnesses play are then the
same bundle by construction, instead of two definitions that agree until someone edits one.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from orchestrator import SceneSynthOrchestrator

REPO_ROOT = Path(__file__).resolve().parents[2]

#: The lesson plan's id, and so the stem of the ZIP the orchestrator emits.
LESSON_ID = "demo-e2e"

#: The file name the three harnesses hardcode. Changing it here changes nothing for them —
#: `tests/e2e/test_demo_fresh.py` pins that the two still agree.
STAGED_NAME = "demo-fresh.zip"

#: Where the harness scripts stage bundles; `tools/e2e-a10.sh` reads the same variable.
DEFAULT_BUNDLE_DIR = "/tmp/studium-e2e"

#: The six scene types the harnesses walk, in the order they walk them.
SCENE_TYPES: tuple[str, ...] = (
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
)

SCENE_FIXTURES: dict[str, str] = {
    "intro": json.dumps(
        {
            "id": "s_intro_1",
            "type": "intro",
            "title": "Introduction au sujet",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 60,
            "adaptation_hooks": [],
            "markdown": "Bienvenue dans cette leçon.",
        }
    ),
    "concept": json.dumps(
        {
            "id": "s_concept_1",
            "type": "concept",
            "title": "Concept principal",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 180,
            "adaptation_hooks": [],
            "markdown": "Le concept est défini comme suit...",
        }
    ),
    "quiz": json.dumps(
        {
            "id": "s_quiz_1",
            "type": "quiz",
            "title": "Vérifions",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 90,
            "adaptation_hooks": [],
            "question": "Lequel décrit le mieux X ?",
            "choices": [
                {"id": "a", "text": "Option A", "correct": True},
                {"id": "b", "text": "Option B", "correct": False},
            ],
            "feedback_correct": "Bien.",
            "feedback_incorrect": "Pas exactement, voici pourquoi…",
            "hints": ["Pensez à la définition vue plus haut."],
        }
    ),
    "meta_checkpoint": json.dumps(
        {
            "id": "s_meta_1",
            "type": "meta_checkpoint",
            "title": "Checkpoint méta",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 60,
            "adaptation_hooks": [],
            "pre_question": "Quelle est votre confiance ?",
            "post_question": "Et après cette section ?",
            "scale_labels": ["aucune", "faible", "moyenne", "bonne", "haute"],
        }
    ),
    "reproduction": json.dumps(
        {
            "id": "s_repro_1",
            "type": "reproduction",
            "title": "Reproduction de la tâche",
            "objective_refs": ["o2"],
            "concept_refs": ["c2"],
            "estimated_seconds": 240,
            "adaptation_hooks": [],
            "task_card_id": "task_001",
            "steps": [
                {
                    "step_id": "1",
                    "instruction": "Charger le fichier mzML",
                    "expected_input_schema": {"type": "string"},
                    "expected_output": "ok",
                }
            ],
        }
    ),
    "ai_critique": json.dumps(
        {
            "id": "s_critique_1",
            "type": "ai_critique",
            "title": "Critique du raisonnement",
            "objective_refs": ["o3"],
            "concept_refs": ["c3"],
            "estimated_seconds": 240,
            "adaptation_hooks": [],
            "claims": [
                {
                    "id": "claim_1",
                    "text": "Affirmation à critiquer",
                    "flaws_expected": ["bias_oversimplification"],
                }
            ],
            "rubric": {
                "completeness": 0.4,
                "evidence_quality": 0.4,
                "tone": 0.2,
            },
        }
    ),
}


class CannedLLM:
    """Returns canned JSON keyed on a signature unique to each prompt template.

    Matching on a unique header sentence rather than on a scene-type substring avoids false
    positives — the quiz prompt, for instance, mentions ``concept_id``.
    """

    SIGNATURES: list[tuple[str, str]] = [
        ("scène ``concept``", "concept"),
        ("scène ``quiz``", "quiz"),
        ("scène ``meta_checkpoint``", "meta_checkpoint"),
        ("scène d'introduction", "intro"),
        ("scène de reproduction expérimentale", "reproduction"),
        ("scène de critique pédagogique", "ai_critique"),
    ]

    def __init__(self, fixtures: dict[str, str] | None = None):
        self.fixtures = SCENE_FIXTURES if fixtures is None else fixtures
        self.calls: list[tuple[str, str]] = []

    def complete(self, prompt: str) -> str:
        for needle, stype in self.SIGNATURES:
            if needle in prompt:
                self.calls.append((stype, prompt[:80]))
                return self.fixtures[stype]
        raise AssertionError(f"CannedLLM: no signature matched prompt: {prompt[:200]!r}")


class PermissiveCritic:
    """Accepts every scene: the critic's judgement is exercised by its own tests, not here."""

    def review(self, scene: Any, plan_section: Any) -> Any:
        class _R:
            passed = True
            feedback = ""

        return _R()


def lesson_plan_six_types() -> dict:
    """A plan covering the six scene types the harnesses walk, in that order."""
    return {
        "id": LESSON_ID,
        "title": "E2E Test Lesson",
        "concepts": [
            {"id": "c1", "title": "Concept 1", "description": "desc", "bloom_level_target": "understand"},
            {"id": "c2", "title": "Concept 2", "description": "desc", "bloom_level_target": "apply"},
            {"id": "c3", "title": "Concept 3", "description": "desc", "bloom_level_target": "analyze"},
        ],
        "scene_outlines": [
            {
                "id": f"s_{stype}_outline",
                "type": stype,
                "title": f"Outline {stype}",
                **({"abs_task_card_id": "task_001"} if stype == "reproduction" else {}),
            }
            for stype in SCENE_TYPES
        ],
    }


def default_abs_capsule_root() -> Path:
    return REPO_ROOT / "fixtures" / "m2" / "abs_capsule_minimal"


def default_staged_path() -> Path:
    """`$BUNDLE_DIR/demo-fresh.zip`, the path the three harnesses hardcode."""
    return Path(os.environ.get("BUNDLE_DIR", DEFAULT_BUNDLE_DIR)) / STAGED_NAME


def synthesize(output_dir: Path, *, include_critique: bool = True) -> dict:
    """Run the real orchestrator over the six-type plan; return its result dictionary."""
    abs_capsule_root = default_abs_capsule_root()
    if not abs_capsule_root.exists():
        raise FileNotFoundError(f"ABS capsule fixture missing: {abs_capsule_root}")
    orch = SceneSynthOrchestrator(
        llm_client=CannedLLM(),
        critic=PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=Path(output_dir),
    )
    return orch.synthesize_lesson(
        lesson_plan_six_types(), options={"include_critique": include_critique}
    )


def bake(dest: Path | None = None, *, include_critique: bool = True) -> Path:
    """Emit the bundle and put it at `dest` (default: the harnesses' staged path).

    The orchestrator names its output `<lesson_id>-<uuid>.zip`, so synthesis happens in a
    temporary directory and exactly one file lands on `dest` — a bundles directory that
    accumulated a uuid-named zip per run would make the library screen list every past bake.
    """
    target = Path(dest) if dest is not None else default_staged_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="demo-fresh-") as tmp:
        result = synthesize(Path(tmp), include_critique=include_critique)
        produced = Path(str(result["bundle_uri"]).replace("file://", ""))
        if not produced.exists():
            raise FileNotFoundError(f"orchestrator reported {produced}, which does not exist")
        shutil.move(str(produced), str(target))
    return target
