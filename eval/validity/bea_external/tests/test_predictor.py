# tests/test_predictor.py
from eval.validity.bea_external.predictor import predict_guiding, evaluate
from eval.validity.bea_external.loader import TeacherTurn

def test_predict_guiding_baseline_vs_with_interrogatives():
    q = "So how much would she have?"      # a probing question
    # baseline (bea_tutor _NEXT_STEP) misses bare interrogatives:
    assert predict_guiding(q, extra_terms=()) is False
    # with interrogative terms added, it fires:
    assert predict_guiding(q, extra_terms=("how", "?")) is True
    # an imperative next-step fires under baseline already:
    assert predict_guiding("Essaie de comparer les deux cas.", extra_terms=()) is True

def test_evaluate_returns_scores_against_is_guiding():
    turns = [TeacherTurn("how much is it?", "probing", True),
             TeacherTurn("Exactly correct!", "generic", False)]
    s = evaluate(turns, extra_terms=("how", "?"))
    assert s["f1"] > 0.0 and s["n"] == 2
