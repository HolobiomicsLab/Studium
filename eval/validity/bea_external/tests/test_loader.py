# tests/test_loader.py
from eval.validity.bea_external.loader import parse_conversation, TeacherTurn

def test_parse_conversation_extracts_moves_and_is_guiding():
    conv = ("Teacher: (probing)So how much would she have?|EOM|Student: 54|EOM|"
            "Teacher: (telling)Re-calculate, that step is wrong.|EOM|"
            "Teacher: (focus)Look back at the second sentence.|EOM|"
            "Teacher: (generic)Exactly correct!")
    turns = parse_conversation(conv, banned=["54", "72"])
    assert [t.move for t in turns] == ["probing", "telling", "focus", "generic"]
    assert [t.is_guiding for t in turns] == [True, False, True, False]
    assert turns[0].text == "So how much would she have?"
    assert turns[0].banned == ["54", "72"]

def test_parse_conversation_ignores_unlabeled_and_student_turns():
    assert parse_conversation("Student: hi|EOM|Teacher: no move here", banned=[]) == []
