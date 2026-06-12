"""test_analyze_handles_no_evidence.py — defensive: a bundle with no evidence
blocks (Perspicacite disabled) must not crash and must report 0 evidenced scenes.
"""

from eval.validity.grounding_relevance.analyze import analyze_bundle
from eval.validity.grounding_relevance.tests._synth import make_bundle, make_scene


def test_no_evidence_bundle_is_defensive():
    bundle = make_bundle([
        make_scene("s-intro", "intro", "Introduction — Eukaryotic Cells", "body text"),
        make_scene("s-concept", "concept", "Peroxisomes", "more body text"),
        make_scene("s-quiz", "quiz", "Quiz", ""),
    ])
    card = analyze_bundle(bundle)
    assert card["n_evidenced_scenes"] == 0
    assert card["irrelevant_scenes"] == []
    # no evidenced scenes -> nothing to grade; grade defaults to 1.0 (vacuously
    # relevant) and verdict is 'relevant' so a non-grounded bundle is not a failure.
    assert card["relevance_grade"] == 1.0
    assert card["verdict"] in ("relevant", "no_evidence")
    assert card["mean_best_relevance"] is None


def test_evidence_present_but_no_refs_is_defensive():
    # evidence block exists but bibliographic_refs is empty -> not an evidenced scene
    bundle = make_bundle([make_scene("s1", "concept", "Peroxisomes", "body", refs=[])])
    card = analyze_bundle(bundle)
    assert card["n_evidenced_scenes"] == 0


def test_empty_bundle_is_defensive():
    card = analyze_bundle({})
    assert card["n_evidenced_scenes"] == 0
    assert isinstance(card["irrelevant_scenes"], list)
