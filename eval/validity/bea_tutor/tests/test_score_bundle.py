# tests/test_score_bundle.py
from eval.validity.bea_tutor.bea import score_bundle


def test_score_bundle_aggregates_cards_and_reveal_rate():
    bundle = {"scenes": [{"id": "q1", "type": "quiz", "concept_refs": ["c1"], "question": "?",
        "choices": [{"id": "b", "text": "le peroxysome", "correct": True}],
        "feedback_correct": "Exact.", "feedback_incorrect": "Non, revois.",
        "hints": ["Pense à l'organite.", "le peroxysome est la réponse"]}]}
    rep = score_bundle(bundle)
    assert rep["n_moves"] == 4                       # 2 hints + fb_incorrect + fb_correct
    assert 0.0 <= rep["reveal_rate"] <= 1.0
    assert rep["reveal_rate"] > 0.0                  # the leaky hint reveals
    assert "note" in rep and rep["cards"]
