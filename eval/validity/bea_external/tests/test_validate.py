# tests/test_validate.py
from eval.validity.bea_external.validate import validate_judge
from eval.validity.bea_external.judge import StubJudge
from eval.validity.bea_external.loader import TeacherTurn


def _turn(text, move):
    return TeacherTurn(text, move, move in {"probing", "focus"}, qid=text)


def test_validate_judge_compares_llm_and_deterministic_to_gold():
    turns = [_turn("how much is it?", "probing"), _turn("why is that?", "focus"),
             _turn("Exactly correct.", "generic"), _turn("The answer is 42.", "telling")]
    # StubJudge says 'yes' (guiding) for turns containing '?'
    rep = validate_judge(turns, StubJudge(yes_if_contains="?"), n_per_move=1, seed=0)
    assert rep["n"] == 4
    assert "llm_vs_gold" in rep and "deterministic_vs_gold" in rep
    assert 0.0 <= rep["llm_vs_gold"]["f1"] <= 1.0
    assert "qwk" in rep["llm_vs_gold"]
    assert rep["llm_vs_gold"]["f1"] == 1.0   # '?' perfectly separates guiding here
    assert "note" in rep
