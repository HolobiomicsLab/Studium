# tests/test_reveal_rule.py
from eval.validity.bea_tutor.reveal_rule import tokenize, jaccard, reveals_answer

def test_tokenize_drops_short_and_stopwords_lowercases():
    assert tokenize("The Peroxisome breaks H2O2!") == {"peroxisome", "breaks", "h2o2"}
    assert tokenize(None) == set()

def test_jaccard():
    assert abs(jaccard({"a", "b"}, {"b", "c"}) - 1 / 3) < 1e-9
    assert jaccard(set(), set()) == 0.0

def test_reveals_answer_substring_and_overlap():
    assert reveals_answer("En fait, la réponse est le peroxysome.", ["le peroxysome"]) is True
    assert reveals_answer("peroxysome catalase oxydation", ["oxydation catalase peroxysome"]) is True
    assert reveals_answer("Qu'observerais-tu si c'était vrai ?", ["le peroxysome catalase"]) is False
