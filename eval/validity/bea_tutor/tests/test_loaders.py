# tests/test_loaders.py
from eval.validity.bea_tutor.loaders import authored_scaffolding_moves


def _quiz(qid, concept, correct_text, fb_inc, hints):
    return {"id": qid, "type": "quiz", "concept_refs": [concept], "question": "?",
            "choices": [{"id": "a", "text": "wrong", "correct": False},
                        {"id": "b", "text": correct_text, "correct": True}],
            "feedback_correct": "Exact.", "feedback_incorrect": fb_inc, "hints": hints}


def test_extracts_hints_and_feedback_as_moves_with_banned_answers():
    bundle = {"scenes": [_quiz("q1", "c1", "le peroxysome", "Non, revois l'oxydation.",
                               ["Pense à l'organite.", "le peroxysome est la réponse"])]}
    moves = authored_scaffolding_moves(bundle)
    texts = [m.text for m in moves]
    assert "Pense à l'organite." in texts            # hint
    assert "Non, revois l'oxydation." in texts        # feedback_incorrect
    assert "Exact." in texts                          # feedback_correct
    # the 2nd hint states the answer -> its banned list contains the correct choice text
    leaky = next(m for m in moves if m.text == "le peroxysome est la réponse")
    assert "le peroxysome" in leaky.banned


def test_empty_or_nonquiz_bundle_yields_no_moves():
    assert authored_scaffolding_moves({"scenes": [{"id": "i", "type": "intro", "markdown": "x"}]}) == []
    assert authored_scaffolding_moves({}) == []
