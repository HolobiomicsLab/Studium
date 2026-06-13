# tests/test_bea_deterministic.py
from eval.validity.bea_tutor.bea import score_revealing_answer, score_actionability

def test_revealing_answer_is_a_penalty_flag():
    bad = score_revealing_answer("la réponse est le peroxysome", ["le peroxysome"])
    assert bad["mode"] == "deterministic" and bad["penalty"] is True
    assert bad["revealed"] is True and bad["score"] == 1.0   # 1.0 = revealed = BAD
    good = score_revealing_answer("Qu'observerais-tu ?", ["le peroxysome"])
    assert good["revealed"] is False and good["score"] == 0.0

def test_actionability_detects_a_next_step():
    yes = score_actionability("Essaie de comparer les deux cas.")
    assert yes["mode"] == "deterministic" and yes["score"] == 1.0
    whatif = score_actionability("Et si la température montait ?")
    assert whatif["score"] == 1.0
    no = score_actionability("Intéressant.")
    assert no["score"] == 0.0
