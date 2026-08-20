"""Scene-level teaching-material judge: audits CONTENT, not runs.

The run auditor (audit.py) scores how a course behaves when driven; nothing in it
reads a quiz key or a planted flaw. This module closes that gap with an LLM judge
over every bundle scene, under four hard design rules learned in this project:

1. Discrete verdicts (pass / suspect / defect) with a REQUIRED failure_scenario on
   any non-pass — never a bare float that can quietly saturate.
2. Worst-case aggregation only, never a corpus mean (nine corpora once scored an
   identical 0.883 because near-constant dimensions were averaged).
3. Calibration is separation on deliberately corrupted scenes, not absolute score.
4. Offline or on any LLM failure, dimensions are SKIPPED and recorded as skipped —
   never fabricated (the planner critic once returned a hardcoded green 0.78 on
   every failure; that class of bug is banned here).

Verdicts are also emitted as ASTRA decisions (review/astra.yaml, ASB document
shape) so a review is an auditable, renderable artifact rather than a score.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .llm import ClaudeCli, LLMError
from .paths import EVAL_DIR, ensure_planner_importable

VERDICTS = ("pass", "suspect", "defect")
_SEVERITY = {v: i for i, v in enumerate(VERDICTS)}

# dimension -> (what the judge must establish, scene predicate)
DIMENSIONS: dict[str, tuple[str, Callable[[dict], bool]]] = {
    "key_correctness": (
        "Is the marked-correct choice factually right, and every unmarked choice wrong?",
        lambda s: s.get("type") == "quiz"),
    "distractor_quality": (
        "Is each distractor plausible (not eliminable without the target concept) and "
        "diagnostic of a distinct misconception, with exactly one defensible answer?",
        lambda s: s.get("type") == "quiz"),
    "flaw_veracity": (
        "Is each planted flaw actually FALSE given the scene's flawed_content and its "
        "reference material, and each sound claim actually true?",
        lambda s: s.get("type") == "spot_the_flaw"),
    "key_recall": (
        "Could a fully correct free-text answer miss every scoring cue? Cues must "
        "credit the concept, not one surface form.",
        lambda s: bool(s.get("key_points"))),
    "evidence_sufficiency": (
        "Is the scene answerable from what it shows the learner (units, values, "
        "context all present)?",
        lambda s: s.get("type") in ("spot_the_flaw", "reproduction")),
    "locale_consistency": (
        "Is the scene's language internally consistent and consistent with the "
        "bundle's declared language?",
        lambda s: True),
    "asset_congruence": (
        "Does each render asset depict what the surrounding text claims it depicts?",
        lambda s: bool(s.get("render_assets"))),
}


class SceneVerdict(BaseModel):
    """One judged dimension of one scene. failure_scenario is the concrete way a
    learner is harmed; required whenever the verdict is not `pass`."""
    model_config = ConfigDict(extra="forbid")

    scene_id: str
    dimension: str
    verdict: Literal["pass", "suspect", "defect"]
    failure_scenario: str = ""
    quote: str = ""
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)

    @model_validator(mode="after")
    def _non_pass_needs_failure(self) -> "SceneVerdict":
        if self.verdict != "pass" and not self.failure_scenario.strip():
            raise ValueError(f"{self.verdict} verdict on {self.dimension} needs a failure_scenario")
        if self.dimension not in DIMENSIONS:
            raise ValueError(f"unknown dimension {self.dimension}")
        return self


def applicable_dimensions(scene: dict) -> list[str]:
    """The dimensions this scene can be judged on, in declaration order."""
    return [d for d, (_, pred) in DIMENSIONS.items() if pred(scene)]


def worst(verdicts: list[str]) -> str:
    """Worst-case aggregate: defect > suspect > pass. Empty list is a pass."""
    return max(verdicts, key=lambda v: _SEVERITY[v]) if verdicts else "pass"


def _judge_prompt(scene: dict, dims: list[str], language: str) -> str:
    briefs = "\n".join(f"- {d}: {DIMENSIONS[d][0]}" for d in dims)
    return (
        "You are auditing one scene of a teaching bundle for content defects.\n"
        f"Bundle language: {language}. Scene JSON:\n{json.dumps(scene, ensure_ascii=False)}\n\n"
        f"Judge EXACTLY these dimensions:\n{briefs}\n\n"
        "Return a JSON array with one object per dimension:\n"
        '{"scene_id": str, "dimension": str, "verdict": "pass"|"suspect"|"defect", '
        '"failure_scenario": str, "quote": str, "confidence": 0..1}\n'
        "Rules: failure_scenario is REQUIRED (concrete learner harm) unless verdict is pass; "
        "quote the offending span verbatim in `quote`; judge the CONTENT shown, not style. "
        "VALID JSON ONLY."
    )


def judge_scene(scene: dict, llm: Any, language: str = "fr") -> list[SceneVerdict]:
    """Judge one scene on its applicable dimensions. Raises LLMError on an
    unusable reply (after one schema-guided retry) — it never fills in verdicts."""
    dims = applicable_dimensions(scene)
    prompt = _judge_prompt(scene, dims, language)
    raw = llm.complete_json(prompt)
    try:
        return _validate(raw, scene, dims)
    except (ValidationError, ValueError) as first:
        retry = llm.complete_json(prompt + f"\n\nYour previous reply was invalid: {first}. Fix it.")
        try:
            return _validate(retry, scene, dims)
        except (ValidationError, ValueError) as exc:
            raise LLMError(f"scene {scene.get('id')}: unusable judge reply: {exc}") from exc


def _validate(raw: Any, scene: dict, dims: list[str]) -> list[SceneVerdict]:
    if not isinstance(raw, list):
        raise ValueError("expected a JSON array of verdicts")
    verdicts = [SceneVerdict.model_validate({**v, "scene_id": scene.get("id", "")}) for v in raw]
    missing = set(dims) - {v.dimension for v in verdicts}
    if missing:
        raise ValueError(f"missing dimensions: {sorted(missing)}")
    return [v for v in verdicts if v.dimension in dims]


def judge_bundle(bundle: dict, llm: Any) -> dict:
    """Judge every scene; aggregate worst-case per dimension and per scene.
    A scene whose judgment fails is recorded under `skipped`, never invented."""
    language = bundle.get("language", "fr")
    scenes: dict[str, list[dict]] = {}
    skipped: dict[str, str] = {}
    for scene in bundle.get("scenes", []):
        sid = scene.get("id", "?")
        try:
            scenes[sid] = [v.model_dump() for v in judge_scene(scene, llm, language)]
        except LLMError as exc:
            skipped[sid] = str(exc)
    per_dim: dict[str, list[str]] = {}
    for vs in scenes.values():
        for v in vs:
            per_dim.setdefault(v["dimension"], []).append(v["verdict"])
    return {
        "bundle_id": bundle.get("bundle_id", "?"),
        "scenes": scenes,
        "skipped": skipped,
        "worst_case": {d: worst(vs) for d, vs in per_dim.items()},
        "defects": [v for vs in scenes.values() for v in vs if v["verdict"] == "defect"],
    }


# ---------------------------------------------------------------- calibration

def corrupt_scene(scene: dict) -> tuple[dict, str] | None:
    """Deterministically corrupt a scene into a KNOWN defect, or None if this
    scene type has no corruption. Returns (corrupted_scene, expected_dimension)."""
    if scene.get("type") == "quiz" and scene.get("choices"):
        bad = json.loads(json.dumps(scene))
        for c in bad["choices"]:
            c["correct"] = not c.get("correct", False)
        return bad, "key_correctness"
    if scene.get("type") == "spot_the_flaw" and scene.get("claims"):
        bad = json.loads(json.dumps(scene))
        for c in bad["claims"]:
            if c.get("is_flaw"):
                c["text"] = "Le résultat de référence est reproduit à l'identique."
        return bad, "flaw_veracity"
    return None


def calibrate(bundle: dict, llm: Any) -> dict:
    """Separation check: the judge must flag corrupted scenes and pass their clean
    originals. Reports counts + Cohen's kappa; gate on separation, not on score."""
    gold: list[bool] = []
    pred: list[bool] = []
    for scene in bundle.get("scenes", []):
        pair = corrupt_scene(scene)
        if pair is None:
            continue
        corrupted, dim = pair
        for candidate, is_corrupted in ((scene, False), (corrupted, True)):
            flagged = any(v.verdict != "pass" and v.dimension == dim
                          for v in judge_scene(candidate, llm, bundle.get("language", "fr")))
            gold.append(is_corrupted)
            pred.append(flagged)
    kappa = _binary_kappa(gold, pred) if gold else None
    return {"pairs": len(gold) // 2, "gold": gold, "pred": pred, "kappa": kappa,
            "separates": kappa is not None and kappa >= 0.6}


def _binary_kappa(gold: list[bool], pred: list[bool]) -> float:
    """Cohen's kappa via the validity harness (single implementation kept there)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bea_agreement", EVAL_DIR / "validity" / "bea_external" / "agreement.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.cohen_kappa(gold, pred)


# ---------------------------------------------------------------- ASTRA emission

def emit_review_astra(review: dict) -> dict:
    """The review as an ASTRA document (ASB shape): one Decision per judged
    (scene, dimension) whose selected option is the verdict, non-chosen verdicts
    excluded with the judge's reasoning; defects become findings with the quote."""
    ensure_planner_importable()
    from provenance.astra_emit import emit_astra

    decisions, findings = [], []
    for sid, vs in review["scenes"].items():
        for v in vs:
            reason = v["failure_scenario"] or "no failure found"
            decisions.append({
                "id": f"review:{sid}:{v['dimension']}",
                "label": f"{sid} — {v['dimension']}",
                "rationale": reason,
                "default": v["verdict"],
                "options": {o: ({"label": o} if o == v["verdict"] else
                                {"label": o, "excluded": True, "excluded_reason": reason})
                            for o in VERDICTS},
            })
            if v["verdict"] == "defect":
                findings.append({
                    "id": f"defect:{sid}:{v['dimension']}",
                    "claim": v["failure_scenario"],
                    "evidence": [{"artifact": f"lesson.json#{sid}", "quote": v["quote"]}],
                })
    return emit_astra(
        analysis_id=f"{review['bundle_id']}-scene-review", name=f"Scene review: {review['bundle_id']}",
        decisions=decisions, prior_insights=[], findings=findings,
        outputs=[{"id": "verdicts", "type": "data"}])


def write_review(review: dict, out_dir: Path) -> None:
    """Persist verdicts.json + astra.yaml under <out_dir>/review/."""
    ensure_planner_importable()
    import yaml
    rdir = out_dir / "review"
    rdir.mkdir(parents=True, exist_ok=True)
    (rdir / "verdicts.json").write_text(
        json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    with open(rdir / "astra.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(emit_review_astra(review), f, sort_keys=False, allow_unicode=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="LLM-judge review of a lesson bundle's content")
    ap.add_argument("bundle", help="path to lesson.json")
    ap.add_argument("--out", default=None, help="output dir (default: alongside the bundle)")
    ap.add_argument("--model", default=None)
    ap.add_argument("--calibrate", action="store_true", help="run the corrupted-scene separation check")
    args = ap.parse_args()
    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
    llm = ClaudeCli(model=args.model)
    review = judge_bundle(bundle, llm)
    if args.calibrate:
        review["calibration"] = calibrate(bundle, llm)
    out = Path(args.out) if args.out else Path(args.bundle).parent
    write_review(review, out)
    print(f"review: {len(review['defects'])} defect(s), "
          f"{len(review['skipped'])} skipped scene(s) -> {out / 'review'}")
    return 1 if review["defects"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
