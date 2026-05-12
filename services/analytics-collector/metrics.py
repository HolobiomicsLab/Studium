"""Pure aggregation functions over JSONL telemetry store.

All functions are read-only — they iterate JSONL files in `data_dir/<course>/`
and compute on the fly. No pre-aggregation, no caching: simplicity first
(ACD §4.3 §3.1).
"""

import json
from collections import defaultdict
from pathlib import Path
from typing import Iterator


def _iter_events(data_dir: Path, course: str) -> Iterator[dict]:
    """Yield JSON-decoded events from all JSONL files in data_dir/course/."""
    course_dir = data_dir / course
    if not course_dir.exists():
        return
    for f in sorted(course_dir.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def compute_progress(data_dir: Path, course: str) -> dict:
    """Completion rate by scene_id, with n_learners (distinct pseudonyms)."""
    completions: dict[str, list[bool]] = defaultdict(list)
    learners: dict[str, set[str]] = defaultdict(set)
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "scene_completed":
            continue
        sid = ev.get("scene_id")
        if sid is None:
            continue
        completions[sid].append(bool(ev.get("success", False)))
        pseudo = ev.get("learner_pseudonym")
        if pseudo:
            learners[sid].add(pseudo)
    return {
        "scenes": {
            sid: {
                "completion_rate": sum(1 for s in vals if s) / len(vals) if vals else 0.0,
                "n_learners": len(learners[sid]),
            }
            for sid, vals in completions.items()
        }
    }


def compute_calibration(data_dir: Path, course: str, learner: str | None = None) -> dict:
    """Brier score on quiz_answered events.

    Brier = mean((confidence - outcome)^2) where outcome = 1.0 if correct else 0.0.
    Lower is better-calibrated.
    """
    items = []
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "quiz_answered":
            continue
        if learner is not None and ev.get("learner_pseudonym") != learner:
            continue
        confidence = ev.get("confidence")
        correct = ev.get("correct")
        if confidence is None or correct is None:
            continue
        outcome = 1.0 if correct else 0.0
        items.append((float(confidence), outcome))
    if not items:
        return {"brier_score": None, "n_items": 0}
    brier = sum((c - o) ** 2 for c, o in items) / len(items)
    return {"brier_score": brier, "n_items": len(items)}


_REASONING_WEIGHTS: dict[str, float] = {
    "justification": 0.25,
    "hypothesis": 0.20,
    "counterexample": 0.20,
    "synthesis": 0.20,
    "question": 0.15,
}


def compute_reasoning_depth_score(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
    scene_id: str | None = None,
) -> dict:
    """Reasoning depth score (M5.2) — score [0, 1] par scène.

    Formule v1 (choix B — binarisé) :
        score = sum(weight[signal] for signal in signals_present_at_least_once)
        weights = {justification: 0.25, hypothesis: 0.20, counterexample: 0.20,
                   synthesis: 0.20, question: 0.15}

    Max théorique = 1.00 quand les 5 signaux sont présents au moins une fois
    pour la (scene_id, pseudonyme). Aucune normalisation par fréquence : la
    présence binaire suffit. Le ``breakdown`` retourné expose les proportions
    par signal pour permettre au frontend d'afficher une distribution.

    Si aucun event ``reasoning_signal`` n'a été reçu pour une scène, la scène
    n'apparaît simplement pas dans le résultat (score ne distingue pas une
    scène "pas jouée" d'une "jouée sans raisonner" côté collector — c'est au
    consommateur de croiser avec scene_entered/scene_completed s'il veut).

    Filtres optionnels : ``pseudonyme`` (1 étudiant) et ``scene_id`` (1 scène).
    """
    # counts[scene_id][signal] = count
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "reasoning_signal":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if scene_id is not None and sid != scene_id:
            continue
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        signal = ev.get("signal")
        if signal not in _REASONING_WEIGHTS:
            continue
        counts[sid][signal] += 1

    scenes: dict[str, dict] = {}
    for sid, by_signal in counts.items():
        total = sum(by_signal.values())
        if total == 0:
            scenes[sid] = {"score": None, "n_signals": 0, "breakdown": {}}
            continue
        # choix B (binarisé) : un signal présent au moins une fois compte 1 × weight.
        score = sum(
            weight for sig, weight in _REASONING_WEIGHTS.items() if by_signal.get(sig, 0) > 0
        )
        # clamp défensif (les poids somment exactement à 1.0 mais le clamp protège
        # toute évolution future de la formule).
        score = max(0.0, min(1.0, score))
        breakdown = {sig: by_signal.get(sig, 0) / total for sig in _REASONING_WEIGHTS}
        scenes[sid] = {
            "score": score,
            "n_signals": total,
            "breakdown": breakdown,
        }
    return {"scenes": scenes}


def compute_ai_audit_accuracy(
    data_dir: Path,
    course: str,
    pseudonyme: str | None = None,
) -> dict:
    """AI audit accuracy (M5.3) — score [0, 1] par scène ai_audit / ai_critique.

    Formule par scène :
        accuracy = max(0, (true_positives - false_positives) / planted_errors)
        - planted_errors == 0 → accuracy = None (impossible à scorer)
        - false_positives > true_positives → clampé à 0
        - clamp strict [0, 1]

    Overall = moyenne arithmétique des accuracies par scène (ignore les None).
    Si aucune scène n'est scorable → overall_accuracy = None.

    Filtre optionnel : ``pseudonyme`` (1 étudiant). Si plusieurs events
    ``ai_audit_result`` ciblent la même (scene_id, pseudonyme), on agrège en
    sommant les compteurs (TP/FP/planted/missed) avant de calculer l'accuracy.
    """
    # counters[scene_id] = {tp, fp, planted, missed}
    counters: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "fp": 0, "planted": 0, "missed": 0}
    )
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "ai_audit_result":
            continue
        sid = ev.get("scene_id")
        if not sid:
            continue
        if pseudonyme is not None and ev.get("learner_pseudonym") != pseudonyme:
            continue
        c = counters[sid]
        c["tp"] += int(ev.get("true_positives", 0))
        c["fp"] += int(ev.get("false_positives", 0))
        c["planted"] += int(ev.get("planted_errors", 0))
        c["missed"] += int(ev.get("missed", 0))

    per_scene: list[dict] = []
    scorable_accuracies: list[float] = []
    for sid, c in counters.items():
        planted = c["planted"]
        tp = c["tp"]
        fp = c["fp"]
        if planted == 0:
            accuracy: float | None = None
        else:
            raw = (tp - fp) / planted
            # clamp strict [0, 1]
            accuracy = max(0.0, min(1.0, raw))
            scorable_accuracies.append(accuracy)
        per_scene.append({
            "scene_id": sid,
            "accuracy": accuracy,
            "true_positives": tp,
            "false_positives": fp,
            "planted_errors": planted,
            "missed": c["missed"],
        })

    overall = (
        sum(scorable_accuracies) / len(scorable_accuracies)
        if scorable_accuracies
        else None
    )
    return {
        "overall_accuracy": overall,
        "n_scenes": len(per_scene),
        "per_scene": per_scene,
    }


def compute_autonomy(data_dir: Path, course: str) -> dict:
    """Anti-offloading metrics: autonomy_ratio + critique_completion_rate.

    - autonomy_ratio = n_critique_submitted / (n_critique_submitted + n_hints_applied)
    - critique_completion_rate = mean(completion_rate of critique_submitted events)
    """
    n_critique = 0
    sum_completion = 0.0
    n_hints = 0
    for ev in _iter_events(data_dir, course):
        t = ev.get("type")
        if t == "critique_submitted":
            n_critique += 1
            sum_completion += float(ev.get("completion_rate", 0))
        elif t == "adaptation_applied" and ev.get("signal") == "hint":
            n_hints += 1
    total = n_critique + n_hints
    return {
        "critique_completion_rate": (sum_completion / n_critique) if n_critique else 0.0,
        "autonomy_ratio": (n_critique / total) if total else 0.0,
        "n_critique": n_critique,
        "n_hints": n_hints,
    }
