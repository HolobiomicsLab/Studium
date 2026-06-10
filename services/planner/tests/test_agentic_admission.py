from agentic.admission import admit, AdmissionResult


def _high(_c): return (0.9, [])
def _low(_c): return (0.2, ["no input artifact"])
def _mid(_c): return (0.5, ["generic verb"])


def test_high_score_admitted_clean():
    r = admit({}, heuristic=_high)
    assert isinstance(r, AdmissionResult)
    assert r.admitted is True and r.path == "heuristic" and r.flagged_for_review is False


def test_low_score_lenient_kept_with_flags():
    r = admit({}, heuristic=_low)  # lenient default
    assert r.admitted is True and r.flagged_for_review is True
    assert r.reasons == ["no input artifact"] and r.path == "fallback"


def test_low_score_strict_dropped():
    r = admit({}, heuristic=_low, strict=True)
    assert r.admitted is False and r.tier == "fail"


def test_mid_score_llm_rescue_admits():
    r = admit({}, heuristic=_mid, llm_judge=lambda _c: (True, "scope clarified"))
    assert r.admitted is True and r.path == "llm_rescue" and r.flagged_for_review is False


def test_mid_score_llm_reject_lenient_flags():
    r = admit({}, heuristic=_mid, llm_judge=lambda _c: (False, "still vague"))
    assert r.admitted is True and r.flagged_for_review is True and r.path == "llm_judge"
