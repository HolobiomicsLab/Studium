# tests/test_judge.py
from eval.validity.bea_external.judge import (
    build_judge_prompt, parse_judgment, judge_guidance, StubJudge,
)


def test_build_prompt_includes_turn_and_verbatim_rubric():
    p = build_judge_prompt("So how much would she have?")
    assert "So how much would she have?" in p
    assert "guidance" in p.lower()
    assert "yes" in p.lower() and "no" in p.lower()  # the 3-point scale


def test_parse_judgment_maps_label_to_ordinal():
    assert parse_judgment({"guidance": "yes"}) == {"label": "yes", "score": 1.0}
    assert parse_judgment({"guidance": "to_some_extent"}) == {"label": "to_some_extent", "score": 0.5}
    assert parse_judgment({"guidance": "no"}) == {"label": "no", "score": 0.0}
    assert parse_judgment({"bad": "x"}) is None
    assert parse_judgment("not a dict") is None


def test_judge_guidance_uses_the_client_and_returns_score():
    # StubJudge returns "yes" for questions, "no" otherwise (keyword on '?')
    stub = StubJudge(yes_if_contains="?")
    assert judge_guidance("how much is it?", stub)["score"] == 1.0
    assert judge_guidance("Exactly correct.", stub)["score"] == 0.0


def test_judge_guidance_returns_none_on_bad_llm_output():
    class Broken:
        def complete_json(self, prompt, system=None):
            return {"unexpected": True}
    assert judge_guidance("x", Broken()) is None
