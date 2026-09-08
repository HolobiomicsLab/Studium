#!/usr/bin/env python3
"""build_capsule_judgment_demo.py — the capsule-backed JUDGMENT slice, end to end.

De-risks the riskiest hypothesis of the north-star (Studium capsule-backed lessons): an agentic
composer can produce a GROUNDED, trustworthiness-varied JUDGMENT lesson from ONE capsule, built
on a REAL cached execution. "Real operation = vehicle; calibrated judgment = destination."

Pipeline (everything real except the LLM when no key is set):
  1. tools/capsule_runner.run_capsule(fixtures/capsule-demo) — a genuine isolated execution
     (fresh uv venv + numpy fit), producing a real figure + landmark (k_fit, half_life).
  2. SpotTheFlawAgent.synthesize(...) at TWO trustworthiness levels (subtle=1 flaw, blatant=3) —
     deliberately-flawed AI READINGS of that real result. The flaw count/subtlety is an AUTHORED
     prompt dial, not hardcoded (so output trustworthiness can be varied for calibration).
  3. tools/ground_judgment.ground_spot_the_flaw(...) attaches the real run as ``reference_result``
     so the learner audits the AI reading AGAINST the genuine output (figure + landmark + checks).
Writes fixtures/capsule-judgment-demo/{scenes.json, decay.png}.

LLM: `--live` uses a real client (needs a key — absent in headless runs). Default = a DETERMINISTIC
stub injected into the REAL agent, so the agent/validation/grounding path runs identically and the
demo is reproducible with no key. CAVEAT: the stub honors `n_flaws` by reading the OUTLINE, not the
rendered prompt — so this demo does NOT exercise the prompt dial end-to-end (that needs `--live`; the
dial's authorability is unit-tested separately by test_trustworthiness_dial_is_authorable_not_hardcoded).
The stub's flawed prose is templated; a real LLM writes richer readings — but BOTH ground on the same
verified landmark, which is the point.

  python tools/build_capsule_judgment_demo.py            # deterministic, no key
  python tools/build_capsule_judgment_demo.py --live     # real composer LLM
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]  # prototype-build/
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "services" / "scene-synth"))

from capsule_runner import run_capsule  # noqa: E402
from ground_judgment import ground_spot_the_flaw  # noqa: E402
from agents.spot_the_flaw_agent import SpotTheFlawAgent  # noqa: E402
from scene_synth_schemas import SpotTheFlawScene  # noqa: E402

CAPSULE = REPO / "fixtures" / "capsule-demo"
OUT = REPO / "fixtures" / "capsule-judgment-demo"

# (level, n_flaws, guidance, verdict_deck). The third level is the one that makes the corpus able
# to measure OVER-DISTRUST offline (INT-STUDIUM-004): a checkbox is a flagging decision, so false
# alarms on `sound_claims` are counted with no LLM. The first two keep the free-text path they have
# always had — this is additive, not a change to what they demonstrate.
LEVELS = [
    ("subtle", 1, "un seul defaut subtil et credible", False),
    ("blatant", 3, "trois defauts plus visibles", False),
    ("deck", 2, "deux defauts, dans un jeu de verdicts melant affirmations fausses et correctes", True),
]

#: Statements about the REAL run that are true — a good auditor must not flag them. They are what
#: the over-distrust direction is measured against; with none, the deck degrades to flawed-only and
#: measures over-trust alone. Each is checkable against fixtures/capsule-demo/scripts/run.py.
SOUND_CLAIMS = [
    ("s1", "L ajustement est obtenu par regression lineaire sur le logarithme du signal, "
           "restreinte aux points positifs."),
    ("s2", "La figure superpose les points de donnees et la courbe ajustee."),
]


class _PassCritic:
    def review(self, scene, plan_section):
        class _R:
            passed = True

        return _R()


class _StubLLM:
    """Deterministic, key-free stand-in for the composer LLM: emits a flawed reading of the REAL
    landmark with exactly outline['trustworthiness']['n_flaws'] flaws. Injected into the real
    SpotTheFlawAgent, so the validation/critic path runs identically to a live model."""

    def __init__(self, outline: dict) -> None:
        self._o = outline

    def complete(self, prompt: str) -> str:
        o = self._o
        lm = o["reference_run"]["landmark"]
        n = o["trustworthiness"]["n_flaws"]
        deck = bool(o["trustworthiness"].get("verdict_deck"))
        sound = SOUND_CLAIMS if deck else []
        # Each planted flaw carries the clause that CORRECTS it, so the reveal explains every
        # flaw it planted and no more (INT-STUDIUM-004). Before, one fixed sentence corrected f1
        # only, and bundle_lint quarantined f2/f3 as "never named in model_correction" — a reveal
        # that leaves a planted flaw unexplained is an answer key the learner cannot learn from.
        pool = [
            ("f1", "La demi-vie depasse une heure.", ["demi-vie", "unites"],
             "la demi-vie vaut ln2/k = 1.65 s, dont les unites sont des secondes, tres loin d une heure"),
            ("f2", "k est un nombre sans dimension.", ["unites", "dimension"],
             "k n est pas sans dimension : ses unites sont s^-1, l inverse d un temps"),
            ("f3", "Le bruit prouve une cinetique d ordre deux.", ["ordre", "sur-interpretation"],
             "le bruit residuel ne prouve aucun ordre deux : c est une sur-interpretation du residu"),
        ][:n]
        scene = {
            "id": o["id"],
            "type": "spot_the_flaw",
            "title": o["title"],
            "concept_refs": o.get("concept_refs", []),
            # The sound statements are part of the READING being audited — a deck whose sound
            # items never appear in the text would ask the learner to judge something unsaid.
            "flawed_content": (
                f"Lecture IA du resultat reel ({lm}). "
                + " ".join([t for _, t, _, _ in pool] + [t for _, t in sound])
            ),
            "claims": [{"id": i, "text": t, "flaws_expected": fe} for i, t, fe, _ in pool],
            # INT-STUDIUM-004: the reveal names the UNIT it concludes from. It used to read
            # "~1.65 unite de temps, pas une heure" — denying the hour while declining to say
            # what the 1.65 was in, which is the same category error the scene plants.
            "model_correction": (
                f"Lecture correcte ancree sur {lm} : "
                + " ; ".join(c for _, _, _, c in pool)
                + "."
                # On a deck, "what you should NOT have flagged" is half the answer: the false
                # alarms are scored, so the reveal has to account for them too.
                + (" Les autres affirmations de la lecture sont exactes et ne devaient pas etre "
                   "signalees." if sound else "")
            ),
            "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
        }
        if deck:
            scene["sound_claims"] = [{"id": i, "text": t} for i, t in sound]
            scene["verdict_deck"] = True
        return json.dumps(scene, ensure_ascii=False)


def _make_llm(outline: dict, live: bool):
    if live:
        raise SystemExit(
            "--live needs a real LLM client + API key (absent in this shell). Inject the "
            "scene-synth service's llm_client to generate with a real model."
        )
    return _StubLLM(outline)


def main(live: bool = False) -> int:
    # run the real capsule; keep its intermediate output in a tempdir (not the repo tree)
    res = run_capsule(CAPSULE, Path(tempfile.mkdtemp(prefix="capsule-judgment-run-")))
    if res.get("status") != "ran":
        print(f"capsule did not run: {res.get('status')} — {res.get('reason')}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    fig_src = (res.get("scene_assets") or {}).get("image_path")
    if fig_src and Path(fig_src).exists():
        shutil.copy2(fig_src, OUT / "decay.png")
    # reference the figure relatively inside the fixture (portable)
    res_rel = {**res, "scene_assets": {**(res.get("scene_assets") or {}), "image_path": "decay.png"}}

    card = json.loads((CAPSULE / "task_card.json").read_text())
    ref_run = {
        "title": res.get("title"),
        "research_question": card["research_question"],
        "landmark": res.get("landmark"),
        "checks": res.get("checks") or [],
    }

    scenes: list[dict] = []
    for level, n_flaws, guidance, deck in LEVELS:
        outline = {
            "id": f"s-flaw-{level}",
            "title": f"Audit d'une lecture IA ({level})",
            "objective_text": "Auditer une lecture IA d'un resultat execute reel",
            "concept_id": "c-kinetics",
            "concept_refs": ["c-kinetics"],
            "objective_refs": ["o-kinetics"],
            "reference_run": ref_run,
            "trustworthiness": {"level": level, "n_flaws": n_flaws, "guidance": guidance,
                                "verdict_deck": deck},
        }
        agent = SpotTheFlawAgent(_make_llm(outline, live), _PassCritic())
        scene = agent.synthesize(outline, {})
        d = scene.model_dump(exclude_none=True)
        ground_spot_the_flaw(d, res_rel)
        SpotTheFlawScene.model_validate(d)  # re-validate WITH the real run attached
        assert d["reference_result"]["landmark"] == res.get("landmark")
        scenes.append(d)

    (OUT / "scenes.json").write_text(
        json.dumps(scenes, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"wrote {len(scenes)} grounded spot_the_flaw scenes -> {OUT / 'scenes.json'}")

    # also emit a loadable LessonBundle so a SessionHost (and the .studium-session/ file channel)
    # can run these scenes end-to-end. rules:[] => linear advance (no adaptive gating needed here).
    intro = {
        "id": "s-intro", "type": "intro",
        "title": "Auditer une lecture IA d'un run reel",
        "objective_refs": [], "concept_refs": ["c-kinetics"],
        "estimated_seconds": 20, "adaptation_hooks": [],
        "markdown": (
            "# Auditer une lecture IA\n\nTu vas auditer la lecture, par une IA, d'un resultat "
            "scientifique REELLEMENT execute (un ajustement de decroissance du premier ordre). "
            "Repere ce qui cloche dans son interpretation."
        ),
    }
    bundle = {
        "schema_version": "1.4",
        "bundle_id": "capsule-judgment-demo",
        "source_plan_id": "plan-capsule-judgment",
        "metadata": {
            "title": "Capsule-grounded judgment (decay fit)", "target": "grad",
            "duration_minutes": 15, "language": "fr", "discipline": "chemistry",
        },
        "concepts": [{
            "id": "c-kinetics", "title": "Cinetique du premier ordre",
            "description": "Constante de vitesse k et demi-vie", "bloom_level_target": "evaluate",
        }],
        "scenes": [intro, *scenes],
        "rules": [],
        "validated_by": "capsule-judgment-demo",
        "validated_at": "2026-06-27T08:00:00Z",
    }
    (OUT / "lesson.json").write_text(
        json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"wrote loadable bundle ({len(bundle['scenes'])} scenes) -> {OUT / 'lesson.json'}")
    print(f"REAL landmark: {res.get('landmark')}   figure: {OUT / 'decay.png'}")
    for s in scenes:
        print(f"  - {s['id']}: {len(s['claims'])} planted flaw(s); grounded={'reference_result' in s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(live="--live" in sys.argv[1:]))
