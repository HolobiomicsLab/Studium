# tests/test_bea_floors.py
from eval.validity.bea_tutor.bea import (
    score_mistake_identification, score_mistake_location,
    score_guidance, score_coherence, score_tone,
)

def test_mistake_identification_floor_needs_error_cue_and_overlap():
    hi = score_mistake_identification("Non, ta justification sur l'oxydation est incorrecte", "l'oxydation produit de l'eau")
    assert hi["mode"] == "llm_formative" and hi["gated"] == "EV-5"
    assert hi["floor"] == 0.5  # error cue + lexical overlap with the learner turn
    lo = score_mistake_identification("D'accord, continuons", "l'oxydation produit de l'eau")
    assert lo["floor"] == 0.0  # no error cue

def test_guidance_and_coherence_floors():
    g = score_guidance("Essaie de tester ton hypothèse", ["la réponse"])
    assert g["mode"] == "llm_formative" and g["floor"] == 0.5  # a strategy cue, not a reveal
    c = score_coherence("parle de l'oxydation et des électrons", "l'oxydation déplace des électrons")
    assert c["floor"] == 0.5  # engages the learner turn's vocabulary

def test_tone_red_flag_screen_gates_to_zero():
    bad = score_tone("C'est NUL, tu n'as rien compris IDIOT")
    assert bad["mode"] == "deterministic" and bad["score"] == 0.0
    ok = score_tone("Bonne piste, creusons un peu plus")
    assert ok["mode"] == "llm_formative" and ok["score"] is None  # positive tone needs the LLM
