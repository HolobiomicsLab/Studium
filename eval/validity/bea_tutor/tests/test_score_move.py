# tests/test_score_move.py
from eval.validity.bea_tutor.bea import TutorMoveRecord, score_move, BEA_DIMENSIONS

def test_score_move_returns_all_eight_verbatim_bea_dims():
    move = TutorMoveRecord(text="Essaie de tester ton hypothèse sur l'oxydation",
                           move_kind="invite_test", in_reply_to_signal="hypothesis",
                           learner_turn="je pense que l'oxydation produit de l'eau",
                           banned=["la réponse est le peroxysome"], source="authored")
    card = score_move(move)
    assert set(card["dims"].keys()) == set(BEA_DIMENSIONS)
    assert card["dims"]["revealing_answer"]["score"] == 0.0      # did not reveal
    assert card["dims"]["actionability"]["score"] == 1.0          # has a next step
    assert card["summative_safe"] is True                        # no reveal, no red-flag tone
    assert card["move_kind"] == "invite_test"

def test_score_move_flags_a_revealing_move_as_not_summative_safe():
    move = TutorMoveRecord(text="la réponse est le peroxysome", move_kind="invite_test",
                           in_reply_to_signal="hypothesis", learner_turn="je sais pas",
                           banned=["la réponse est le peroxysome"], source="authored")
    card = score_move(move)
    assert card["dims"]["revealing_answer"]["revealed"] is True
    assert card["summative_safe"] is False
