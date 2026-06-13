import json, os
from eval.validity.bea_tutor.reveal_rule import reveals_answer

_FIX = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fixtures", "reveal_parity.json")

def test_python_matches_parity_fixture():
    with open(_FIX, encoding="utf-8") as fh:
        cases = json.load(fh)
    for c in cases:
        assert reveals_answer(c["text"], c["banned"]) is c["revealed"], c
