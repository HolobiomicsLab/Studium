"""Test support: build the whole ASTRA document set the planner and the scene judge emit.

Shared by tests/test_provenance_astra_validate_cli.py and tools/astra_validate_check.py
(INT-STUDIUM-010). The course set mirrors test_provenance_astra_conformance.py
(`_StubAgent`, `_plan()` on tests/fixtures/abs_capsule); that test keeps its private
copies on purpose, so its assertions never depend on shared support. This directory is
not a package: the module name is unique on sys.path (conftest.py puts it there under
pytest; tools/astra_validate_check.py inserts it by hand).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # tests -> planner -> services -> repo root
PLANNER_DIR = ROOT / "services" / "planner"
_FIXTURE = str(Path(__file__).resolve().parent / "fixtures" / "abs_capsule")

for _p in (
    PLANNER_DIR,
    ROOT / "packages" / "perspicacite-client" / "python",
    ROOT / "packages" / "learning-workflow-schema" / "python",
    ROOT / "packages" / "lesson-plan-schema" / "python",
    ROOT / "eval",
):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

CLOCK = "2026-06-11T00:00:00+00:00"


class StubAgent:
    """Proposes the single prerequisite edge the fixture plan supports."""

    def propose_prerequisites(self, concepts):
        return [{"source": "concept:obj-fft", "target": "concept:obj-fourier",
                 "rationale": "Fourier first"}]


def hostile_plan():
    """A plan whose ids are hostile to the ASTRA grammar (hyphens + colons)."""
    from lesson_plan_schema import CorpusRef, LearningObjective, LessonPlan, SceneOutline
    return LessonPlan(
        id="p1", title="Signal Processing", language="fr", target="L3",
        duration_minutes=45, source_manifest_id="sp-101",
        learning_objectives=[
            LearningObjective(id="obj-fourier", description="Fourier transform", bloom_level="understand"),
            LearningObjective(id="obj-fft", description="Apply the FFT", bloom_level="apply"),
        ],
        scene_outlines=[SceneOutline(id="s1", type="concept", title="Fourier basics",
                                     objective_refs=["obj-fourier"])],
        corpus_refs=[CorpusRef(ref_id="cap1", ref_type="abs_capsule",
                               abs_capsule_path=_FIXTURE, aligns_concept_ids=["obj-fourier"])],
    )


def build_course_set(out_dir) -> dict:
    """GraphBuilder -> emit_astra -> write_astra_set under `out_dir`, exactly as
    planner_app does. Returns the emitted analysis document."""
    from agentic.telemetry import InMemoryTelemetrySink
    from graph.builder import GraphBuilder
    from provenance.astra_emit import baseline_universe, emit_astra, write_astra_set
    from provenance.universes import pedagogical_decisions, remedial_universe

    res = GraphBuilder(graph_agent=StubAgent(), telemetry=InMemoryTelemetrySink(),
                       clock=lambda: CLOCK, asserted_by="urn:x").build(hostile_plan())
    ped = pedagogical_decisions()
    doc = emit_astra(
        analysis_id=f"{res.graph['course_id']}-analysis", name="Signal Processing",
        decisions=res.decisions + ped, prior_insights=[], findings=res.findings,
        outputs=[{"id": "lwg", "type": "data", "format": "json"}],
    )
    write_astra_set(doc, [baseline_universe(ped), remedial_universe(ped)], out_dir)
    return doc


def build_review_set(out_dir) -> dict:
    """Scene-judge review of a corrupted quiz (one defect finding) written under
    `out_dir`/review/ through write_review. Returns the review."""
    spec = importlib.util.spec_from_file_location(
        "scene_judge_fixtures", ROOT / "eval" / "tests" / "test_scene_judge.py")
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    from harness.scene_judge import corrupt_scene, judge_bundle, write_review

    corrupted, _dimension = corrupt_scene(fixtures.QUIZ)
    review = judge_bundle({"bundle_id": "b1", "language": "fr", "scenes": [corrupted]},
                          fixtures.FakeLLM())
    write_review(review, Path(out_dir))
    return review
