"""test_analyze_passes_ontopic.py — the SAME peroxisomes scene cited with a
topically-relevant paper must pass: not flagged, verdict 'relevant'.
"""

from eval.validity.grounding_relevance.analyze import analyze_bundle
from eval.validity.grounding_relevance.tests._synth import (
    make_bundle,
    make_ref,
    make_scene,
)


def _ontopic_bundle():
    scene = make_scene(
        "s-concept-peroxisomes",
        "concept",
        "Peroxisomes",
        "Peroxisomes are organelles that break down very long chain fatty acids "
        "and detoxify reactive oxygen species inside eukaryotic cells.",
        refs=[
            make_ref(
                "Peroxisome biology and function",
                excerpt="peroxisomes are organelles handling fatty acid oxidation and "
                "reactive oxygen species in eukaryotic cells",
                doi="10.0/peroxisome",
                relevance_score=0.8,
            )
        ],
    )
    return make_bundle([scene])


def test_ontopic_scene_not_flagged():
    card = analyze_bundle(_ontopic_bundle())
    assert card["n_evidenced_scenes"] == 1
    assert card["irrelevant_scenes"] == []


def test_ontopic_bundle_verdict_is_relevant():
    card = analyze_bundle(_ontopic_bundle())
    assert card["relevance_grade"] == 1.0
    assert card["verdict"] == "relevant"


def test_ontopic_mean_best_relevance_above_threshold():
    card = analyze_bundle(_ontopic_bundle())
    assert card["mean_best_relevance"] >= 0.06
