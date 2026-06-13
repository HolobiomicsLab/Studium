import json
from eval.validity.bea_external.run_llm_judge import run
from eval.validity.bea_external.judge import StubJudge
from eval.validity.bea_external.loader import TeacherTurn

def test_run_with_injected_stub_client_writes_no_report(tmp_path):
    turns = [TeacherTurn("how much?", "probing", True, qid="1"),
             TeacherTurn("Exactly.", "generic", False, qid="2")]
    rep = run(turns, client=StubJudge(yes_if_contains="?"), n_per_move=1, seed=0)
    assert rep["n"] == 2 and "llm_vs_gold" in rep
