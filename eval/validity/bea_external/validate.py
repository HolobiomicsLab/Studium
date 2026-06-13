# validate.py — validate the LLM guidance judge vs MathDial gold, vs the deterministic detector.
from __future__ import annotations

from typing import Dict, List

from eval.validity.bea_external.agreement import binary_scores, cohen_kappa, quadratic_weighted_kappa
from eval.validity.bea_external.judge import JudgeClient, judge_guidance
from eval.validity.bea_external.loader import TeacherTurn
from eval.validity.bea_external.sample import stratified_sample
from eval.validity.bea_tutor.bea import score_actionability  # the SHIPPED (improved) detector

_NOTE = (
    "LLM judge scores BEA 'providing guidance' (verbatim) on each turn -> {1,0.5,0}; binarised at "
    ">=0.5 and compared to MathDial's human guiding(probing/focus)-vs-direct(telling/generic) gold. "
    "Reported beside the shipped deterministic detector on the SAME sample. No circularity: MathDial "
    "turns are human-written. This is the EV-5 LLM-judge DRY-RUN on a silver standard; it does NOT "
    "replace the human study for non-mappable dims (mistake-id/location/coherence/tone/humanlikeness)."
)
_CATS = [0.0, 0.5, 1.0]


def validate_judge(turns: List[TeacherTurn], client: JudgeClient,
                   n_per_move: int = 25, seed: int = 0) -> Dict:
    sample = stratified_sample(turns, n_per_move=n_per_move, seed=seed)
    gold = [t.is_guiding for t in sample]
    gold_ord = [1.0 if g else 0.0 for g in gold]

    llm_scores: List[float] = []
    n_null = 0
    for t in sample:
        j = judge_guidance(t.text, client)
        if j is None:
            n_null += 1
            llm_scores.append(0.0)   # a missing judgment counts as 'no guidance'
        else:
            llm_scores.append(j["score"])
    llm_pred = [s >= 0.5 for s in llm_scores]

    det_pred = [score_actionability(t.text)["score"] == 1.0 for t in sample]

    llm = binary_scores(gold, llm_pred)
    llm["kappa"] = cohen_kappa(gold, llm_pred)
    llm["qwk"] = quadratic_weighted_kappa(gold_ord, llm_scores, _CATS)

    det = binary_scores(gold, det_pred)
    det["kappa"] = cohen_kappa(gold, det_pred)

    return {"n": len(sample), "n_null_judgments": n_null,
            "llm_vs_gold": llm, "deterministic_vs_gold": det, "note": _NOTE}
